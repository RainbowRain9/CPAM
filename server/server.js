const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
const usageDb = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 7940);
const DEV_MODE = process.env.NODE_ENV !== 'production' && !fs.existsSync(path.join(__dirname, '..', 'dist', 'index.html'));

// usage 实时更新推送（SSE）
const usageStreamClients = new Set();

function broadcastUsageUpdate(payload = {}) {
  const message = `data: ${JSON.stringify({ type: 'usage-updated', timestamp: new Date().toISOString(), ...payload })}\n\n`;
  for (const client of usageStreamClients) {
    try {
      client.write(message);
    } catch (e) {
      usageStreamClients.delete(client);
    }
  }
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// 加载/保存设置
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('加载设置失败:', e);
  }
  return null;
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

// 获取CLI-Proxy配置（动态）
function getCliProxyConfig() {
  const settings = loadSettings();
  if (!settings) return null;
  return {
    baseUrl: settings.cliProxyUrl || 'http://localhost:8317',
    apiKey: settings.cliProxyKey || 'cli-proxy-admin',
    configPath: settings.cliProxyConfigPath || ''
  };
}

// CLI-Proxy API 配置（动态）
let CLI_PROXY_API = '';
let CLI_PROXY_KEY = '';

function updateCliProxyVars() {
  const config = getCliProxyConfig();
  if (config) {
    CLI_PROXY_API = `${config.baseUrl}/v0/management`;
    CLI_PROXY_KEY = config.apiKey;
  }
}
updateCliProxyVars();
// 动态获取同步间隔
function getSyncInterval() {
  const settings = loadSettings();
  const minutes = settings?.syncInterval || 5;
  return minutes * 60 * 1000;
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'dist')));

app.get('/api/usage/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  usageStreamClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch (e) {
      clearInterval(heartbeat);
      usageStreamClients.delete(res);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    usageStreamClients.delete(res);
  });
});

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 设置相关 API
app.get('/api/settings', (req, res) => {
  const settings = loadSettings();
  if (!settings) {
    return res.json({ configured: false });
  }
  res.json({ 
    configured: true,
    cliProxyUrl: settings.cliProxyUrl,
    cliProxyConfigPath: settings.cliProxyConfigPath,
    openCodeConfigPath: settings.openCodeConfigPath || '',
    syncInterval: settings.syncInterval || 5
  });
});

app.post('/api/settings', (req, res) => {
  const { cliProxyUrl, cliProxyKey, cliProxyConfigPath, syncInterval } = req.body;
  if (!cliProxyUrl || !cliProxyKey) {
    return res.status(400).json({ error: 'CLI-Proxy 地址和密码不能为空' });
  }
  
  const settings = loadSettings() || {};
  settings.cliProxyUrl = cliProxyUrl;
  settings.cliProxyKey = cliProxyKey;
  settings.cliProxyConfigPath = cliProxyConfigPath || '';
  if (req.body.openCodeConfigPath !== undefined) {
    settings.openCodeConfigPath = req.body.openCodeConfigPath;
  }
  if (syncInterval !== undefined) {
    settings.syncInterval = syncInterval;
  }
  
  saveSettings(settings);
  updateCliProxyVars();
  
  res.json({ success: true });
});

app.delete('/api/settings', (req, res) => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      fs.unlinkSync(SETTINGS_FILE);
    }
    CLI_PROXY_API = '';
    CLI_PROXY_KEY = '';
    res.json({ success: true });
  } catch (e) {
    console.error('删除设置失败:', e);
    res.status(500).json({ error: '删除设置失败' });
  }
});

// 从API构建 source -> provider 映射（仅API Key）
async function buildSourceProviderMap() {
  const map = {};
  try {
    const response = await fetch(`${CLI_PROXY_API}/openai-compatibility`, {
      headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
    });
    if (!response.ok) {
      console.error('Failed to fetch openai-compatibility:', response.status);
      return map;
    }
    const data = await response.json();
    const sites = data['openai-compatibility'] || data.items || data.data || data || [];
    
    (Array.isArray(sites) ? sites : []).forEach(site => {
      const providerName = site.name;
      if (site['api-key-entries']) {
        site['api-key-entries'].forEach(entry => {
          if (entry['api-key']) {
            map[entry['api-key']] = { provider: providerName, channel: 'api-key' };
          }
        });
      }
    });
  } catch (e) {
    console.error('Error building source-provider map:', e);
  }
  return map;
}

// 从 cli-proxy 管理 API 获取 auth_index 到渠道的映射
async function fetchAuthIndexMap() {
  try {
    const response = await fetch(`${CLI_PROXY_API}/auth-files`, {
      headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
    });
    
    if (!response.ok) {
      console.error('Failed to fetch auth-files:', response.status);
      return {};
    }
    
    const data = await response.json();
    const files = data.files || data || [];
    const map = {};
    
    files.forEach(file => {
      if (file.auth_index) {
        map[file.auth_index] = {
          email: file.email || file.account,
          type: file.type || file.provider,
          name: file.name || file.id,
          label: file.label
        };
      }
    });
    
    return map;
  } catch (e) {
    console.error('Error fetching auth-files:', e);
    return {};
  }
}

// 批量更新缓存：处理usage数据中的所有source和auth_index
async function updateKeyProviderCacheFromUsage(usage) {
  if (!usage?.apis) return;
  
  const cache = usageDb.getKeyProviderCache();
  const configMap = await buildSourceProviderMap();
  const authIndexMap = await fetchAuthIndexMap();
  let updated = false;
  
  Object.values(usage.apis).forEach(api => {
    if (api.models) {
      Object.values(api.models).forEach(modelData => {
        if (modelData.details) {
          modelData.details.forEach(detail => {
            const source = detail.source;
            const authIndex = detail.auth_index;
            if (!source) return;
            
            const cacheKey = authIndex || source;
            
            // 如果缓存中已有完整信息，跳过
            if (cache[cacheKey] && cache[cacheKey].provider && cache[cacheKey].channel) {
              return;
            }
            
            // 优先从 auth-files API 获取精确的渠道信息
            if (authIndex && authIndexMap[authIndex]) {
              const authInfo = authIndexMap[authIndex];
              usageDb.upsertKeyProvider(cacheKey, {
                provider: authInfo.type ? authInfo.type.toUpperCase() : 'UNKNOWN',
                channel: authInfo.type || 'unknown',
                email: authInfo.email,
                source: source
              });
              updated = true;
              return;
            }
            
            // 检查是否是API Key（从config映射）
            if (configMap[source]) {
              usageDb.upsertKeyProvider(cacheKey, {
                ...configMap[source],
                source: source
              });
              updated = true;
              return;
            }
          });
        }
      });
    }
  });
  
  if (updated) {
    console.log('[Cache] Key-Provider 缓存已更新');
  }
}

async function exportUsageFromCliProxy() {
  // 检查 CLI-Proxy 是否已配置
  if (!CLI_PROXY_API) {
    console.log('[Usage] CLI-Proxy 未配置，跳过同步（请在 Web 界面配置后自动启用）');
    return null;
  }
  
  try {
    const response = await fetch(`${CLI_PROXY_API}/usage/export`, {
      headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
    });
    
    if (!response.ok) {
      console.error('Failed to export usage:', response.status);
      return null;
    }
    
    const data = await response.json();
    return data;
  } catch (e) {
    console.error('[Usage] 同步失败:', e.message || e);
    return null;
  }
}

// 从 CLI-Proxy 数据中提取记录并转换为数据库格式
function extractUsageRecords(usage) {
  const records = [];
  if (!usage?.apis) return records;
  
  Object.entries(usage.apis).forEach(([apiPath, apiData]) => {
    if (apiData.models) {
      Object.entries(apiData.models).forEach(([model, modelData]) => {
        if (modelData.details) {
          modelData.details.forEach((detail, idx) => {
            // 提取 token 数据（CLI-Proxy 的结构是 detail.tokens.xxx）
            const tokens = detail.tokens || {};
            const inputTokens = tokens.input_tokens || 0;
            const outputTokens = tokens.output_tokens || 0;
            const totalTokens = tokens.total_tokens || (inputTokens + outputTokens);
            
            // 生成唯一ID：使用 api_path + model + auth_index/source + 时间戳 + tokens
            const timestamp = detail.timestamp || '';
            const requestId = `${apiPath}:${model}:${detail.auth_index || detail.source || 'unknown'}:${timestamp}:${inputTokens}:${outputTokens}`;
            
            records.push({
              request_id: requestId,
              api_path: apiPath,
              model: model,
              source: detail.source,
              auth_index: detail.auth_index,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              total_tokens: totalTokens,
              cached_tokens: tokens.cached_tokens || 0,
              reasoning_tokens: tokens.reasoning_tokens || 0,
              success: !detail.failed,  // CLI-Proxy 用 failed 字段
              request_time: timestamp || null
            });
          });
        }
      });
    }
  });
  
  return records;
}

async function autoExportUsage() {
  const exportData = await exportUsageFromCliProxy();
  
  // 如果未配置或同步失败，静默返回
  if (!exportData || !exportData.usage) {
    return;
  }
  
  // 提取记录并增量插入数据库
  const records = extractUsageRecords(exportData.usage);
  
  if (records.length > 0) {
    const inserted = usageDb.insertUsageBatch(records);
    console.log(`[Usage] 插入 ${inserted} 条新记录（总共 ${records.length} 条）`);
  }
  
  // 更新同步状态
  usageDb.updateSyncState(new Date().toISOString(), exportData.exported_at);
  
  // 更新 key-provider 缓存
  await updateKeyProviderCacheFromUsage(exportData.usage);

  // 通知前端有新数据（无需手动刷新）
  broadcastUsageUpdate({ inserted: records.length });
  
  console.log('[Usage] 同步完成');
}

// 启动定时同步
function startUsageExportScheduler() {
  // 启动时立即同步一次
  autoExportUsage();
  
  // 使用递归 setTimeout 支持动态间隔
  function scheduleNext() {
    const interval = getSyncInterval();
    setTimeout(() => {
      autoExportUsage();
      scheduleNext();
    }, interval);
  }
  scheduleNext();
  
  const interval = getSyncInterval();
  const config = getCliProxyConfig();
  if (config && config.baseUrl) {
    console.log(`[Usage] 定时同步已启动，间隔: ${interval / 1000}秒，目标: ${config.baseUrl}`);
  } else {
    console.log(`[Usage] 定时同步已就绪（间隔: ${interval / 1000}秒），等待 CLI-Proxy 配置...`);
  }
}

// 模型计费 API
app.get('/api/pricing', (req, res) => {
  const pricing = usageDb.getModelPricing();
  res.json(pricing);
});

app.post('/api/pricing', (req, res) => {
  const { model, inputPrice, outputPrice } = req.body;
  if (!model) {
    return res.status(400).json({ error: '模型名称不能为空' });
  }
  usageDb.upsertModelPricing(model, parseFloat(inputPrice) || 0, parseFloat(outputPrice) || 0);
  const pricing = usageDb.getModelPricing();
  res.json({ success: true, pricing });
});

app.delete('/api/pricing/:model', (req, res) => {
  const { model } = req.params;
  usageDb.deleteModelPricing(model);
  res.json({ success: true });
});

// 使用记录 API
app.get('/api/usage', (req, res) => {
  const syncState = usageDb.getSyncState();
  const usage = usageDb.getUsageStats();
  const keyProviderCache = usageDb.getKeyProviderCache();
  const modelPricing = usageDb.getModelPricing();
  res.json({
    lastExport: syncState?.last_sync,
    usage: usage,
    keyProviderCache: keyProviderCache,
    modelPricing: modelPricing
  });
});

app.get('/api/usage/history', (req, res) => {
  const syncState = usageDb.getSyncState();
  // 数据库模式下不再保存历史快照，返回空数组
  res.json({ exports: [], lastExport: syncState?.last_sync });
});

app.post('/api/usage/export-now', async (req, res) => {
  try {
    await autoExportUsage();
    const syncState = usageDb.getSyncState();
    const usage = usageDb.getUsageStats();
    broadcastUsageUpdate({ manual: true });
    res.json({ 
      success: true, 
      lastExport: syncState?.last_sync,
      usage: usage
    });
  } catch (e) {
    console.error('手动同步失败:', e);
    res.status(500).json({ error: e?.message || '手动同步失败' });
  }
});

// CodeX 账号管理 API（从 auth-files 中获取 type=codex 的账号）
app.get('/api/codex/accounts', async (req, res) => {
  try {
    const response = await fetch(`${CLI_PROXY_API}/auth-files`, {
      headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: '获取CodeX账号失败' });
    }
    const data = await response.json();
    const files = data.files || data || [];
    // 过滤出 type=codex 的账号
    const codexAccounts = (Array.isArray(files) ? files : [])
      .filter(f => f.type === 'codex' || f.provider === 'codex')
      .map(a => ({
        email: a.email || a.account,
        authIndex: a.auth_index,
        status: a.status,
        disabled: a.disabled,
        planType: a.id_token?.plan_type,
        label: a.label
      }));
    res.json(codexAccounts);
  } catch (e) {
    console.error('获取CodeX账号失败:', e);
    res.status(500).json({ error: e.message });
  }
});

// 检查单个CodeX账号有效性
async function probeCodexAccount(authIndex, chatgptAccountId) {
  const userAgent = 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal';
  const payload = {
    authIndex,
    method: 'GET',
    url: 'https://chatgpt.com/backend-api/wham/usage',
    header: {
      'Authorization': 'Bearer $TOKEN$',
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
      ...(chatgptAccountId ? { 'Chatgpt-Account-Id': chatgptAccountId } : {})
    }
  };

  try {
    const response = await fetch(`${CLI_PROXY_API}/api-call`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLI_PROXY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return { valid: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const statusCode = data.status_code || data.statusCode;
    
    if (statusCode === 401) {
      return { valid: false, statusCode, error: 'unauthorized' };
    }
    if (statusCode >= 200 && statusCode < 300) {
      return { valid: true, statusCode };
    }
    return { valid: false, statusCode, error: `status ${statusCode}` };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

app.post('/api/codex/check', async (req, res) => {
  try {
    // 获取所有CodeX账号
    const getRes = await fetch(`${CLI_PROXY_API}/auth-files`, {
      headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
    });
    if (!getRes.ok) {
      return res.status(getRes.status).json({ error: '获取账号失败' });
    }
    const data = await getRes.json();
    const files = data.files || data || [];
    
    // 过滤出CodeX账号
    const codexAccounts = (Array.isArray(files) ? files : [])
      .filter(f => f.type === 'codex' || f.provider === 'codex');
    
    let valid = 0;
    let invalid = 0;
    const invalidAccounts = [];
    
    // 并发检查（限制并发数）
    const concurrency = 20;
    for (let i = 0; i < codexAccounts.length; i += concurrency) {
      const batch = codexAccounts.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async (account) => {
          const authIndex = account.auth_index;
          const chatgptAccountId = account.id_token?.chatgpt_account_id;
          if (!authIndex) return { account, result: { valid: false, error: 'no auth_index' } };
          
          const result = await probeCodexAccount(authIndex, chatgptAccountId);
          return { account, result };
        })
      );
      
      for (const { account, result } of results) {
        if (result.valid) {
          valid++;
        } else {
          invalid++;
          invalidAccounts.push({
            email: account.email || account.account,
            name: account.name || account.id,
            error: result.error
          });
        }
      }
    }
    
    res.json({ valid, invalid, total: codexAccounts.length, invalidAccounts });
  } catch (e) {
    console.error('检查CodeX账号失败:', e);
    res.status(500).json({ error: e.message });
  }
});

const CODEX_FIVE_HOUR_WINDOW_SECONDS = 5 * 60 * 60;
const CODEX_WEEKLY_WINDOW_SECONDS = 7 * 24 * 60 * 60;

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeCodexQuotaWindow(window, source, fallbackDurationSeconds = null) {
  if (!window || typeof window !== 'object') return null;

  const usedPercentValue = toFiniteNumber(
    window.used_percent ??
    window.usedPercent ??
    window.percent_used ??
    window.percentUsed
  );

  if (usedPercentValue === null) {
    return null;
  }

  const durationSeconds =
    toFiniteNumber(
      window.duration_seconds ??
      window.durationSeconds ??
      window.window_seconds ??
      window.windowSeconds ??
      window.window_size_seconds ??
      window.windowSizeSeconds ??
      window.interval_seconds ??
      window.intervalSeconds
    ) ?? fallbackDurationSeconds;

  const resetAt = toFiniteNumber(window.reset_at ?? window.resetAt);
  const usedPercent = Math.max(0, Math.min(100, usedPercentValue));

  return {
    source,
    durationSeconds,
    usedPercent,
    remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    resetAt
  };
}

function extractCodexQuotaWindows(rateLimit) {
  const normalizedWindows = [];

  if (rateLimit?.primary_window) {
    const primaryWindow = normalizeCodexQuotaWindow(
      rateLimit.primary_window,
      'primary',
      CODEX_FIVE_HOUR_WINDOW_SECONDS
    );
    if (primaryWindow) {
      normalizedWindows.push(primaryWindow);
    }
  }

  if (rateLimit?.secondary_window) {
    const secondaryWindow = normalizeCodexQuotaWindow(
      rateLimit.secondary_window,
      'secondary',
      CODEX_WEEKLY_WINDOW_SECONDS
    );
    if (secondaryWindow) {
      normalizedWindows.push(secondaryWindow);
    }
  }

  if (Array.isArray(rateLimit?.windows)) {
    rateLimit.windows.forEach((window, index) => {
      const normalizedWindow = normalizeCodexQuotaWindow(window, `windows[${index}]`);
      if (normalizedWindow) {
        normalizedWindows.push(normalizedWindow);
      }
    });
  }

  const sortedByDuration = [...normalizedWindows].sort((a, b) => {
    const durationA = a.durationSeconds ?? Number.MAX_SAFE_INTEGER;
    const durationB = b.durationSeconds ?? Number.MAX_SAFE_INTEGER;
    return durationA - durationB;
  });

  const sortedByDurationDesc = [...sortedByDuration].reverse();

  const fiveHourWindow =
    normalizedWindows.find(window => window.durationSeconds === CODEX_FIVE_HOUR_WINDOW_SECONDS) ||
    normalizedWindows.find(window => window.source === 'primary') ||
    sortedByDuration[0] ||
    null;

  const weeklyWindow =
    normalizedWindows.find(window => window.durationSeconds === CODEX_WEEKLY_WINDOW_SECONDS) ||
    normalizedWindows.find(window => window.source === 'secondary') ||
    sortedByDurationDesc.find(window => window !== fiveHourWindow) ||
    null;

  return {
    fiveHourWindow,
    weeklyWindow
  };
}

// 检查单个CodeX账号配额
async function probeCodexQuota(authIndex, chatgptAccountId) {
  const userAgent = 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal';
  const payload = {
    auth_index: authIndex,
    method: 'GET',
    url: 'https://chatgpt.com/backend-api/wham/usage',
    header: {
      'Authorization': 'Bearer $TOKEN$',
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
      ...(chatgptAccountId ? { 'Chatgpt-Account-Id': chatgptAccountId } : {})
    }
  };

  try {
    const response = await fetch(`${CLI_PROXY_API}/api-call`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLI_PROXY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const statusCode = data.status_code || data.statusCode;
    
    if (statusCode === 401) {
      return { error: 'unauthorized', statusCode };
    }
    
    // 解析响应体中的配额信息
    const body = data.body || data.response_body;
    if (body) {
      try {
        const usageData = typeof body === 'string' ? JSON.parse(body) : body;
        // rate_limit = 代码补全配额
        const rateLimit = usageData.rate_limit;
        const { fiveHourWindow, weeklyWindow } = extractCodexQuotaWindows(rateLimit);
        if (fiveHourWindow || weeklyWindow) {
          return { 
            completionQuota: fiveHourWindow?.remainingPercent,
            usedPercent: fiveHourWindow?.usedPercent,
            resetAt: fiveHourWindow?.resetAt,
            fiveHourWindow,
            weeklyWindow,
            statusCode 
          };
        }
      } catch (e) {
        // 解析失败
      }
    }
    
    return { statusCode, error: 'no quota data' };
  } catch (e) {
    return { error: e.message };
  }
}

app.post('/api/codex/quota', async (req, res) => {
  try {
    const { authIndexes } = req.body || {};
    
    // 获取所有CodeX账号
    const getRes = await fetch(`${CLI_PROXY_API}/auth-files`, {
      headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
    });
    if (!getRes.ok) {
      return res.status(getRes.status).json({ error: '获取账号失败' });
    }
    const data = await getRes.json();
    const files = data.files || data || [];
    
    // 过滤出CodeX账号
    let codexAccounts = (Array.isArray(files) ? files : [])
      .filter(f => f.type === 'codex' || f.provider === 'codex');
    
    // 如果指定了 authIndexes，只检查这些账号
    if (authIndexes && Array.isArray(authIndexes) && authIndexes.length > 0) {
      const indexSet = new Set(authIndexes);
      codexAccounts = codexAccounts.filter(a => indexSet.has(a.auth_index));
    }
    
    const quotas = [];
    
    // 并发检查配额（限制并发数）
    const concurrency = 20;
    for (let i = 0; i < codexAccounts.length; i += concurrency) {
      const batch = codexAccounts.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async (account) => {
          const authIndex = account.auth_index;
          const chatgptAccountId = account.id_token?.chatgpt_account_id;
          if (!authIndex) return null;
          
          const result = await probeCodexQuota(authIndex, chatgptAccountId);
          if (result.completionQuota !== undefined || result.fiveHourWindow || result.weeklyWindow) {
            return {
              authIndex,
              email: account.email || account.account,
              completionQuota: result.completionQuota,
              usedPercent: result.usedPercent,
              resetAt: result.resetAt,
              fiveHourWindow: result.fiveHourWindow || null,
              weeklyWindow: result.weeklyWindow || null
            };
          }
          return null;
        })
      );
      
      quotas.push(...results.filter(Boolean));
    }
    
    res.json({ total: codexAccounts.length, checked: quotas.length, quotas });
  } catch (e) {
    console.error('检查CodeX配额失败:', e);
    res.status(500).json({ error: e.message });
  }
});

// 通过authIndex删除CodeX账号
app.post('/api/codex/delete-by-auth', async (req, res) => {
  try {
    const { authIndexes } = req.body || {};
    if (!authIndexes || !Array.isArray(authIndexes) || authIndexes.length === 0) {
      return res.status(400).json({ error: '没有要删除的账号' });
    }
    
    // 先获取所有账号，找到对应的name
    const getRes = await fetch(`${CLI_PROXY_API}/auth-files`, {
      headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
    });
    if (!getRes.ok) {
      return res.status(getRes.status).json({ error: '获取账号失败' });
    }
    const data = await getRes.json();
    const files = data.files || data || [];
    
    const indexSet = new Set(authIndexes);
    const toDelete = (Array.isArray(files) ? files : [])
      .filter(f => indexSet.has(f.auth_index))
      .map(f => f.name || f.id);
    
    let deleted = 0;
    let failed = 0;
    
    for (const name of toDelete) {
      if (!name) { failed++; continue; }
      try {
        const encodedName = encodeURIComponent(name);
        const response = await fetch(`${CLI_PROXY_API}/auth-files?name=${encodedName}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
        });
        
        if (response.ok) {
          deleted++;
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }
    }
    
    res.json({ deleted, failed, total: toDelete.length });
  } catch (e) {
    console.error('删除CodeX账号失败:', e);
    res.status(500).json({ error: e.message });
  }
});

// 删除CodeX账号
app.post('/api/codex/delete', async (req, res) => {
  try {
    const { names } = req.body || {};
    if (!names || !Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ error: '没有要删除的账号' });
    }
    
    let deleted = 0;
    let failed = 0;
    
    for (const name of names) {
      try {
        const encodedName = encodeURIComponent(name);
        const response = await fetch(`${CLI_PROXY_API}/auth-files?name=${encodedName}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
        });
        
        if (response.ok) {
          deleted++;
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }
    }
    
    res.json({ deleted, failed, total: names.length });
  } catch (e) {
    console.error('删除CodeX账号失败:', e);
    res.status(500).json({ error: e.message });
  }
});

// OpenCode 配置管理 API
app.get('/api/opencode/config', (req, res) => {
  const settings = loadSettings();
  const configPath = settings?.openCodeConfigPath;
  if (!configPath) {
    return res.status(400).json({ error: '未配置 OpenCode 路径' });
  }
  const filePath = path.join(configPath, 'opencode.json');
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '配置文件不存在: ' + filePath });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json(JSON.parse(content));
  } catch (e) {
    res.status(500).json({ error: '读取配置失败: ' + e.message });
  }
});

app.put('/api/opencode/config', (req, res) => {
  const settings = loadSettings();
  const configPath = settings?.openCodeConfigPath;
  if (!configPath) {
    return res.status(400).json({ error: '未配置 OpenCode 路径' });
  }
  const filePath = path.join(configPath, 'opencode.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '保存配置失败: ' + e.message });
  }
});

// Oh My OpenCode 配置管理 API
app.get('/api/opencode/oh-my', (req, res) => {
  const settings = loadSettings();
  const configPath = settings?.openCodeConfigPath;
  if (!configPath) {
    return res.status(400).json({ error: '未配置 OpenCode 路径' });
  }
  const filePath = path.join(configPath, 'oh-my-opencode.json');
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '配置文件不存在: ' + filePath });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json(JSON.parse(content));
  } catch (e) {
    res.status(500).json({ error: '读取配置失败: ' + e.message });
  }
});

app.put('/api/opencode/oh-my', (req, res) => {
  const settings = loadSettings();
  const configPath = settings?.openCodeConfigPath;
  if (!configPath) {
    return res.status(400).json({ error: '未配置 OpenCode 路径' });
  }
  const filePath = path.join(configPath, 'oh-my-opencode.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '保存配置失败: ' + e.message });
  }
});

// 开发模式：代理到 Vite 开发服务器
if (DEV_MODE) {
  console.log('开发模式：代理前端请求到 Vite (localhost:5173)');
  app.use('/', createProxyMiddleware({
    target: 'http://localhost:5173',
    changeOrigin: true,
    ws: true, // 支持 WebSocket (HMR)
    filter: (req) => !req.path.startsWith('/api')
  }));
} else {
  // 生产模式：提供静态文件
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`API Center 服务运行在 http://localhost:${PORT}`);
  if (DEV_MODE) {
    console.log('开发模式：请先运行 npm run dev 启动 Vite，然后访问 http://localhost:7940');
  }
  const settings = loadSettings();
  if (settings) {
    console.log(`CLI-Proxy API: ${settings.cliProxyUrl}`);
  } else {
    console.log('未配置 CLI-Proxy，请访问页面进行初始设置');
  }
  
  // 启动使用记录定时导出
  startUsageExportScheduler();
});
