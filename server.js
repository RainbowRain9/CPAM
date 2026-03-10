const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { createProxyMiddleware } = require('http-proxy-middleware');
const usageDb = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 7940);
const DEV_MODE = process.env.NODE_ENV !== 'production' && !fs.existsSync(path.join(__dirname, 'dist', 'index.html'));

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

const DATA_DIR = path.join(__dirname, 'data');
const STATUS_FILE = path.join(DATA_DIR, 'checkin-status.json');
const SITES_FILE = path.join(DATA_DIR, 'managed-sites.json');
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
app.use(express.static(path.join(__dirname, 'dist')));

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

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function loadStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
      if (data.date !== getTodayDate()) {
        return { date: getTodayDate(), checkins: {} };
      }
      return data;
    }
  } catch (e) {
    console.error('Error loading status:', e);
  }
  return { date: getTodayDate(), checkins: {} };
}

function saveStatus(status) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
}

function loadManagedSites() {
  try {
    if (fs.existsSync(SITES_FILE)) {
      return JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Error loading managed sites:', e);
  }
  return [];
}

function saveManagedSites(sites) {
  fs.writeFileSync(SITES_FILE, JSON.stringify(sites, null, 2));
}

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
    console.error('Error exporting usage from cli-proxy:', e);
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
  console.log('[Usage] 开始自动同步使用记录...');
  const exportData = await exportUsageFromCliProxy();
  
  if (exportData && exportData.usage) {
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
  console.log(`[Usage] 定时同步已启动，间隔: ${interval / 1000}秒`);
}

async function loadConfigSites() {
  try {
    const response = await fetch(`${CLI_PROXY_API}/openai-compatibility`, {
      headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
    });
    if (!response.ok) {
      console.error('Failed to fetch config sites:', response.status);
      return [];
    }
    const data = await response.json();
    const sites = data['openai-compatibility'] || data.items || data.data || data || [];
    return (Array.isArray(sites) ? sites : []).map(site => ({
      name: site.name,
      baseUrl: site['base-url']
    }));
  } catch (e) {
    console.error('Error loading sites from API:', e);
    return [];
  }
}

app.get('/api/sites', (req, res) => {
  const sites = loadManagedSites();
  const status = loadStatus();
  const result = sites.map(site => ({
    ...site,
    checkedIn: !!status.checkins[site.name]
  }));
  res.json(result);
});

app.get('/api/config-sites', async (req, res) => {
  const configSites = await loadConfigSites();
  const managedSites = loadManagedSites();
  const managedNames = new Set(managedSites.map(s => s.name));
  const result = configSites.map(site => ({
    ...site,
    added: managedNames.has(site.name)
  }));
  res.json(result);
});

app.post('/api/sites', (req, res) => {
  const { name, directUrl } = req.body;
  if (!name) {
    return res.status(400).json({ error: '站点名称不能为空' });
  }
  const configSites = loadConfigSites();
  const configSite = configSites.find(s => s.name === name);
  if (!configSite) {
    return res.status(400).json({ error: '站点不在配置文件中' });
  }
  const sites = loadManagedSites();
  if (sites.some(s => s.name === name)) {
    return res.status(400).json({ error: '站点已存在' });
  }
  sites.push({ name, baseUrl: configSite.baseUrl, directUrl: directUrl || '' });
  saveManagedSites(sites);
  res.json({ success: true, site: { name, baseUrl: configSite.baseUrl, directUrl } });
});

app.patch('/api/sites/:siteName', (req, res) => {
  const { siteName } = req.params;
  const { directUrl } = req.body;
  const sites = loadManagedSites();
  const site = sites.find(s => s.name === siteName);
  if (!site) {
    return res.status(404).json({ error: '站点不存在' });
  }
  site.directUrl = directUrl || '';
  saveManagedSites(sites);
  res.json({ success: true, site });
});

app.delete('/api/sites/:siteName', (req, res) => {
  const { siteName } = req.params;
  let sites = loadManagedSites();
  sites = sites.filter(s => s.name !== siteName);
  saveManagedSites(sites);
  const status = loadStatus();
  delete status.checkins[siteName];
  saveStatus(status);
  res.json({ success: true });
});

app.get('/api/status', (req, res) => {
  const status = loadStatus();
  res.json(status);
});

app.post('/api/checkin/:siteName', (req, res) => {
  const { siteName } = req.params;
  const status = loadStatus();
  status.checkins[siteName] = {
    time: new Date().toISOString(),
    done: true
  };
  saveStatus(status);
  res.json({ success: true, siteName, checkedIn: true });
});

app.delete('/api/checkin/:siteName', (req, res) => {
  const { siteName } = req.params;
  const status = loadStatus();
  delete status.checkins[siteName];
  saveStatus(status);
  res.json({ success: true, siteName, checkedIn: false });
});

// 站点配置管理 API（通过 CLI-Proxy API 方式，实时生效无需重启）
app.get('/api/config/sites', async (req, res) => {
  try {
    const response = await fetch(`${CLI_PROXY_API}/openai-compatibility`, {
      headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: '获取站点列表失败' });
    }
    const data = await response.json();
    const sites = data['openai-compatibility'] || data.items || data.data || data || [];
    res.json(Array.isArray(sites) ? sites : []);
  } catch (e) {
    console.error('Error reading config via API:', e);
    res.status(500).json({ error: '读取配置失败: ' + e.message });
  }
});

app.post('/api/config/sites', async (req, res) => {
  try {
    const newSite = req.body;
    if (!newSite.name || !newSite['base-url']) {
      return res.status(400).json({ error: '站点名称和地址不能为空' });
    }
    
    // 先获取现有列表
    const getRes = await fetch(`${CLI_PROXY_API}/openai-compatibility`, {
      headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
    });
    if (!getRes.ok) {
      return res.status(getRes.status).json({ error: '获取站点列表失败' });
    }
    const data = await getRes.json();
    const sites = data['openai-compatibility'] || data.items || data.data || data || [];
    const siteList = Array.isArray(sites) ? sites : [];
    
    if (siteList.some(s => s.name === newSite.name)) {
      return res.status(400).json({ error: '站点名称已存在' });
    }
    
    const siteEntry = {
      name: newSite.name,
      'base-url': newSite['base-url'],
      'api-key-entries': newSite['api-key-entries'] || [{ 'api-key': '' }],
      models: newSite.models || []
    };
    
    siteList.push(siteEntry);
    
    // 保存整个列表
    const putRes = await fetch(`${CLI_PROXY_API}/openai-compatibility`, {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${CLI_PROXY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(siteList)
    });
    
    if (!putRes.ok) {
      const text = await putRes.text();
      return res.status(putRes.status).json({ error: text || '添加站点失败' });
    }
    
    res.json({ success: true, site: siteEntry });
  } catch (e) {
    console.error('Error adding site via API:', e);
    res.status(500).json({ error: '添加站点失败: ' + e.message });
  }
});

app.put('/api/config/sites/:siteName', async (req, res) => {
  try {
    const { siteName } = req.params;
    const updates = req.body;
    
    // 先获取现有列表
    const getRes = await fetch(`${CLI_PROXY_API}/openai-compatibility`, {
      headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
    });
    if (!getRes.ok) {
      return res.status(getRes.status).json({ error: '获取站点列表失败' });
    }
    const data = await getRes.json();
    const sites = data['openai-compatibility'] || data.items || data.data || data || [];
    const siteList = Array.isArray(sites) ? sites : [];
    
    const siteIndex = siteList.findIndex(s => s.name === siteName);
    if (siteIndex === -1) {
      return res.status(404).json({ error: '站点不存在' });
    }
    
    const site = siteList[siteIndex];
    
    if (updates.name !== undefined) site.name = updates.name;
    if (updates['base-url'] !== undefined) site['base-url'] = updates['base-url'];
    if (updates['api-key-entries'] !== undefined) site['api-key-entries'] = updates['api-key-entries'];
    if (updates.models !== undefined) site.models = updates.models;
    
    // 保存整个列表
    const putRes = await fetch(`${CLI_PROXY_API}/openai-compatibility`, {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${CLI_PROXY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(siteList)
    });
    
    if (!putRes.ok) {
      const text = await putRes.text();
      return res.status(putRes.status).json({ error: text || '更新站点失败' });
    }
    
    res.json({ success: true, site });
  } catch (e) {
    console.error('Error updating site via API:', e);
    res.status(500).json({ error: '更新站点失败: ' + e.message });
  }
});

app.delete('/api/config/sites/:siteName', async (req, res) => {
  try {
    const { siteName } = req.params;
    
    // 使用 CLI-Proxy 的删除 API
    const delRes = await fetch(`${CLI_PROXY_API}/openai-compatibility?name=${encodeURIComponent(siteName)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
    });
    
    if (!delRes.ok) {
      const text = await delRes.text();
      return res.status(delRes.status).json({ error: text || '删除站点失败' });
    }
    
    res.json({ success: true });
  } catch (e) {
    console.error('Error deleting site via API:', e);
    res.status(500).json({ error: '删除站点失败: ' + e.message });
  }
});

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

// OpenAI 兼容提供商管理 API（代理到 CLI-Proxy）
app.get('/api/openai-providers', async (req, res) => {
  try {
    const response = await fetch(`${CLI_PROXY_API}/openai-compatibility`, {
      headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: '获取提供商列表失败' });
    }
    const data = await response.json();
    const list = data['openai-compatibility'] || data.items || data.data || data || [];
    res.json(Array.isArray(list) ? list : []);
  } catch (e) {
    console.error('获取OpenAI提供商失败:', e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/openai-providers', async (req, res) => {
  try {
    const response = await fetch(`${CLI_PROXY_API}/openai-compatibility`, {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${CLI_PROXY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text || '保存失败' });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('保存OpenAI提供商失败:', e);
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/openai-providers', async (req, res) => {
  try {
    const { index, value } = req.body;
    const response = await fetch(`${CLI_PROXY_API}/openai-compatibility`, {
      method: 'PATCH',
      headers: { 
        'Authorization': `Bearer ${CLI_PROXY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ index, value })
    });
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text || '更新失败' });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('更新OpenAI提供商失败:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/openai-providers/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const response = await fetch(`${CLI_PROXY_API}/openai-compatibility?name=${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${CLI_PROXY_KEY}` }
    });
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text || '删除失败' });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('删除OpenAI提供商失败:', e);
    res.status(500).json({ error: e.message });
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
        if (rateLimit?.primary_window) {
          const usedPercent = rateLimit.primary_window.used_percent || 0;
          const remainingPercent = 100 - usedPercent;
          const resetAt = rateLimit.primary_window.reset_at;
          return { 
            completionQuota: Math.max(0, Math.min(100, remainingPercent)),
            usedPercent,
            resetAt,
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
          if (result.completionQuota !== undefined) {
            return {
              authIndex,
              email: account.email || account.account,
              completionQuota: result.completionQuota,
              usedPercent: result.usedPercent,
              resetAt: result.resetAt
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
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`API站点签到管理服务运行在 http://localhost:${PORT}`);
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
