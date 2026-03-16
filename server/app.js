const express = require('express');
const fs = require('fs');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const { buildInstanceClient, normalizeCliProxyBaseUrl, validateCliProxyManagementAccess } = require('./cliProxy');
const {
  buildScopedCacheKey,
  createUsageDb,
  DEFAULT_INSTANCE_STATUS,
  DISABLED_INSTANCE_STATUS,
} = require('./db');
const { createLocalAuth } = require('./localAuth');
const { hasDefinedIdentifier, shouldUseViteProxy } = require('./runtime');

const DEFAULT_SYNC_INTERVAL_MINUTES = 5;

function maskSensitiveValue(value) {
  const text = typeof value === 'string' ? value.trim() : String(value || '').trim();
  if (!text) return '';
  if (text.length <= 8) {
    return `${text.slice(0, 2)}***${text.slice(-2)}`;
  }
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function deriveDefaultInstanceName(baseUrl, index = 1) {
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname ? `CPA ${hostname}` : `CPA ${index}`;
  } catch {
    return `CPA ${index}`;
  }
}

function toSafeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toNonNegativeNumber(value) {
  return Math.max(0, toSafeNumber(value));
}

function normalizeModelPricingMap(rawPricing) {
  if (!rawPricing || typeof rawPricing !== 'object' || Array.isArray(rawPricing)) {
    return null;
  }

  const normalized = {};

  Object.entries(rawPricing).forEach(([model, value]) => {
    const normalizedModel = String(model || '').trim();
    if (!normalizedModel || !value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }

    const pricing = value;
    const promptPrice = toNonNegativeNumber(
      pricing.promptPrice ?? pricing.prompt ?? pricing.inputPrice
    );
    const completionPrice = toNonNegativeNumber(
      pricing.completionPrice ?? pricing.completion ?? pricing.outputPrice
    );
    const hasExplicitCachePrice =
      pricing.cachePrice !== undefined ||
      pricing.cache !== undefined ||
      pricing.cacheInputPrice !== undefined;
    const cachePrice = hasExplicitCachePrice
      ? toNonNegativeNumber(pricing.cachePrice ?? pricing.cache ?? pricing.cacheInputPrice)
      : promptPrice;

    normalized[normalizedModel] = {
      promptPrice,
      completionPrice,
      cachePrice,
    };
  });

  return normalized;
}

function serializeCpaInstance(instance) {
  if (!instance) return null;

  return {
    id: instance.id,
    name: instance.name,
    baseUrl: instance.baseUrl,
    syncInterval: instance.syncInterval,
    isActive: instance.isActive,
    isEnabled: instance.isEnabled,
    status: instance.status,
    statusMessage: instance.statusMessage || '',
    lastCheckedAt: instance.lastCheckedAt,
    lastSyncAt: instance.lastSyncAt,
    lastExportAt: instance.lastExportAt,
    apiKeyPreview: maskSensitiveValue(instance.apiKey),
  };
}

function createUsageScheduler({ usageDb, syncInstance, logger = console }) {
  const timers = new Map();

  function clearTimer(instanceId) {
    const timer = timers.get(instanceId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(instanceId);
    }
  }

  function scheduleInstance(instance, options = {}) {
    clearTimer(instance.id);
    if (!instance.isEnabled) return;

    const delayMs = options.immediate
      ? 0
      : Math.max(1, Number(instance.syncInterval) || DEFAULT_SYNC_INTERVAL_MINUTES) * 60 * 1000;

    const timer = setTimeout(async () => {
      clearTimer(instance.id);

      try {
        await syncInstance(instance.id);
      } catch (error) {
        logger.error(`[Usage] 实例 ${instance.id} 同步失败:`, error?.message || error);
      }

      const refreshed = usageDb.getCpaInstanceById(instance.id);
      if (refreshed?.isEnabled) {
        scheduleInstance(refreshed, { immediate: false });
      }
    }, delayMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    timers.set(instance.id, timer);
  }

  function refresh(options = {}) {
    const immediateIds = new Set((options.immediateIds || []).map((value) => Number(value)));
    const enabledInstances = usageDb.getEnabledCpaInstances();
    const enabledIds = new Set(enabledInstances.map((instance) => instance.id));

    for (const instanceId of timers.keys()) {
      if (!enabledIds.has(instanceId)) {
        clearTimer(instanceId);
      }
    }

    enabledInstances.forEach((instance) => {
      scheduleInstance(instance, { immediate: immediateIds.has(instance.id) });
    });
  }

  function stop() {
    for (const instanceId of timers.keys()) {
      clearTimer(instanceId);
    }
  }

  return {
    refresh,
    stop,
  };
}

function createServerApp(options = {}) {
  const app = express();
  const port = Number(options.port || process.env.PORT || 7940);
  const dataDir = options.dataDir || path.join(__dirname, '..', 'data');
  const distDir = options.distDir || path.join(__dirname, '..', 'dist');
  const settingsFile = options.settingsFile || path.join(dataDir, 'settings.json');
  const devServerUrl = options.devServerUrl || process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  const devMode = options.devMode ?? shouldUseViteProxy();
  const fetchImpl = options.fetchImpl || fetch;
  const usageDb = options.usageDb || createUsageDb({ dataDir });

  const {
    router: authRouter,
    applyAuthState,
    requireAppAuth,
  } = createLocalAuth({
    usageDb,
    isProduction: options.isProduction ?? process.env.NODE_ENV === 'production',
  });

  const usageStreamClients = new Set();

  function broadcastUsageUpdate(payload = {}) {
    const message = `data: ${JSON.stringify({
      type: 'usage-updated',
      timestamp: new Date().toISOString(),
      ...payload,
    })}\n\n`;

    for (const client of usageStreamClients) {
      try {
        client.write(message);
      } catch {
        usageStreamClients.delete(client);
      }
    }
  }

  function getValidationStatusResult(validation) {
    return {
      status: validation.instanceStatus || DEFAULT_INSTANCE_STATUS,
      statusMessage: validation.error || validation.statusMessage || '',
    };
  }

  async function buildSourceProviderMap(instanceClient) {
    const map = {};

    try {
      const { response, payload } = await instanceClient.fetchOpenaiCompatibility();
      if (!response.ok) {
        return map;
      }

      const sites = payload?.['openai-compatibility'] || payload?.items || payload?.data || payload || [];
      (Array.isArray(sites) ? sites : []).forEach((site) => {
        const providerName = site.name;
        if (!site['api-key-entries']) return;

        site['api-key-entries'].forEach((entry) => {
          if (entry['api-key']) {
            map[entry['api-key']] = {
              provider: providerName,
              channel: 'api-key',
            };
          }
        });
      });
    } catch (error) {
      console.error('Error building source-provider map:', error?.message || error);
    }

    return map;
  }

  async function fetchAuthIndexMap(instanceClient) {
    try {
      const { response, payload } = await instanceClient.fetchAuthFiles();
      if (!response.ok) {
        return {};
      }

      const files = payload?.files || payload || [];
      const map = {};

      (Array.isArray(files) ? files : []).forEach((file) => {
        if (!hasDefinedIdentifier(file.auth_index)) return;
        const authIndexKey = String(file.auth_index);
        map[authIndexKey] = {
          email: file.email || file.account,
          type: file.type || file.provider,
          name: file.name || file.id,
          label: file.label,
        };
      });

      return map;
    } catch (error) {
      console.error('Error fetching auth-files:', error?.message || error);
      return {};
    }
  }

  async function updateKeyProviderCacheFromUsage(instance, usage) {
    if (!usage?.apis) return;

    const instanceClient = buildInstanceClient(instance, fetchImpl);
    const configMap = await buildSourceProviderMap(instanceClient);
    const authIndexMap = await fetchAuthIndexMap(instanceClient);
    const scopedCache = usageDb.getKeyProviderCache(instance.id);

    Object.values(usage.apis).forEach((api) => {
      Object.values(api?.models || {}).forEach((modelData) => {
        const details = Array.isArray(modelData?.details) ? modelData.details : [];
        details.forEach((detail) => {
          const source = detail.source;
          const authIndex = detail.auth_index;
          const authIndexKey = hasDefinedIdentifier(authIndex) ? String(authIndex) : '';
          const sourceKey = source ? String(source) : '';

          if (authIndexKey) {
            const cacheKey = buildScopedCacheKey(instance.id, 'auth', authIndexKey);
            if (!scopedCache[cacheKey] && authIndexMap[authIndexKey]) {
              const authInfo = authIndexMap[authIndexKey];
              usageDb.upsertKeyProvider(cacheKey, {
                provider: authInfo.type ? String(authInfo.type).toUpperCase() : 'UNKNOWN',
                channel: authInfo.type || 'unknown',
                email: authInfo.email,
                source: sourceKey,
              });
            }
          }

          if (sourceKey && configMap[sourceKey]) {
            const cacheKey = buildScopedCacheKey(instance.id, 'source', sourceKey);
            if (!scopedCache[cacheKey]) {
              usageDb.upsertKeyProvider(cacheKey, {
                ...configMap[sourceKey],
                source: sourceKey,
              });
            }
          }
        });
      });
    });
  }

  function extractUsageRecords(instance, usage) {
    const records = [];
    if (!usage?.apis) return records;

    Object.entries(usage.apis).forEach(([apiPath, apiData]) => {
      Object.entries(apiData?.models || {}).forEach(([model, modelData]) => {
        const details = Array.isArray(modelData?.details) ? modelData.details : [];
        details.forEach((detail) => {
          const tokens = detail.tokens || {};
          const inputTokens = tokens.input_tokens || 0;
          const outputTokens = tokens.output_tokens || 0;
          const totalTokens = tokens.total_tokens || (inputTokens + outputTokens);
          const timestamp = detail.timestamp || '';
          const recordIdentifier = hasDefinedIdentifier(detail.auth_index)
            ? String(detail.auth_index)
            : detail.source || 'unknown';
          const legacyId = `${apiPath}:${model}:${recordIdentifier}:${timestamp}:${inputTokens}:${outputTokens}`;

          records.push({
            request_id: `instance:${instance.id}:${legacyId}`,
            api_path: apiPath,
            model,
            source: detail.source,
            auth_index: detail.auth_index,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: totalTokens,
            cached_tokens: tokens.cached_tokens || 0,
            reasoning_tokens: tokens.reasoning_tokens || 0,
            success: !detail.failed,
            request_time: timestamp || null,
            instance_id: instance.id,
          });
        });
      });
    });

    return records;
  }

  async function syncUsageForInstance(instanceId) {
    const instance = usageDb.getCpaInstanceById(instanceId);
    if (!instance) {
      throw new Error('实例不存在');
    }

    if (!instance.isEnabled) {
      throw new Error('实例已停用，无法同步');
    }

    const now = new Date().toISOString();
    const client = buildInstanceClient(instance, fetchImpl);

    try {
      const { response, payload } = await client.exportUsage();
      if (!response.ok) {
        const validationStatus = getValidationStatusResult({
          instanceStatus: response.status === 401 || response.status === 403 ? 'auth_failed' : 'unreachable',
          error: response.status === 401 || response.status === 403
            ? 'CLI-Proxy 管理密码错误'
            : `使用量导出失败（HTTP ${response.status}）`,
        });
        usageDb.markCpaInstanceSynced(instance.id, {
          status: validationStatus.status,
          statusMessage: validationStatus.statusMessage,
          lastCheckedAt: now,
        });
        throw new Error(validationStatus.statusMessage);
      }

      const exportData = payload || {};
      const usage = exportData.usage || null;
      if (!usage) {
        usageDb.markCpaInstanceSynced(instance.id, {
          status: 'healthy',
          statusMessage: '同步完成，但未返回 usage 数据',
          lastCheckedAt: now,
          lastSyncAt: now,
          lastExportAt: exportData.exported_at || instance.lastExportAt,
        });
        return { instance: usageDb.getCpaInstanceById(instance.id), inserted: 0 };
      }

      const records = extractUsageRecords(instance, usage);
      const inserted = records.length > 0 ? usageDb.insertUsageBatch(records) : 0;

      usageDb.markCpaInstanceSynced(instance.id, {
        status: 'healthy',
        statusMessage: '同步成功',
        lastCheckedAt: now,
        lastSyncAt: now,
        lastExportAt: exportData.exported_at || now,
      });

      usageDb.updateSyncState(now, exportData.exported_at || now);
      await updateKeyProviderCacheFromUsage(instance, usage);
      broadcastUsageUpdate({
        instanceId: instance.id,
        inserted,
      });

      return {
        instance: usageDb.getCpaInstanceById(instance.id),
        inserted,
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        usageDb.markCpaInstanceSynced(instance.id, {
          status: 'unreachable',
          statusMessage: '连接 CLI-Proxy 超时，请检查地址或网络',
          lastCheckedAt: now,
        });
      } else if (!/密码错误|导出失败/.test(error?.message || '')) {
        usageDb.markCpaInstanceSynced(instance.id, {
          status: 'unreachable',
          statusMessage: `无法连接 CLI-Proxy：${error?.message || '网络异常'}`,
          lastCheckedAt: now,
        });
      }

      throw error;
    }
  }

  function buildUsageResponse(scope, instance = null) {
    const scopedInstanceId = scope === 'all' ? null : instance?.id || null;
    const meta = usageDb.getUsageViewMeta(scopedInstanceId);

    return {
      scope,
      instanceId: instance?.id || null,
      instanceName: instance?.name || '',
      lastExport: meta.lastSyncAt || meta.lastExportAt || null,
      usage: usageDb.getUsageStats({ instanceId: scopedInstanceId }),
      keyProviderCache: usageDb.getKeyProviderCache(scopedInstanceId),
      modelPricing: usageDb.getModelPricing(),
    };
  }

  function resolveUsageScope(requestedScope, requestedInstanceId) {
    if (requestedScope === 'all') {
      return {
        scope: 'all',
        instance: null,
      };
    }

    if (requestedScope === 'instance' && hasDefinedIdentifier(requestedInstanceId)) {
      const instance = usageDb.getCpaInstanceById(Number(requestedInstanceId));
      if (!instance) {
        return {
          error: '实例不存在',
          status: 404,
        };
      }

      return {
        scope: 'instance',
        instance,
      };
    }

    const activeInstance = usageDb.ensureActiveCpaInstance();
    if (!activeInstance) {
      return {
        error: '没有可用的激活实例，请先配置或启用一个实例',
        status: 409,
      };
    }

    return {
      scope: 'instance',
      instance: activeInstance,
    };
  }

  function getActiveInstanceContext() {
    const activeInstance = usageDb.ensureActiveCpaInstance();
    if (!activeInstance) {
      return {
        error: '没有可用的激活实例，请先配置或启用一个实例',
        status: 409,
      };
    }

    return {
      instance: activeInstance,
      client: buildInstanceClient(activeInstance, fetchImpl),
    };
  }

  function importLegacySettingsIfNeeded() {
    if (usageDb.countCpaInstances() > 0) {
      usageDb.ensureActiveCpaInstance();
      return null;
    }

    if (!fs.existsSync(settingsFile)) {
      return null;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      const baseUrl = normalizeCliProxyBaseUrl(raw.cliProxyUrl || '');
      const apiKey = String(raw.cliProxyKey || '').trim();
      if (!baseUrl || !apiKey) {
        return null;
      }

      const instance = usageDb.createCpaInstance({
        name: deriveDefaultInstanceName(baseUrl, 1),
        baseUrl,
        apiKey,
        syncInterval: Number(raw.syncInterval) || DEFAULT_SYNC_INTERVAL_MINUTES,
        isEnabled: true,
        forceActive: true,
        status: DEFAULT_INSTANCE_STATUS,
        statusMessage: 'Imported from legacy settings',
      });

      usageDb.assignLegacyDataToInstance(instance.id);
      usageDb.ensureActiveCpaInstance();
      return instance;
    } catch (error) {
      console.error('迁移旧版 settings.json 失败:', error?.message || error);
      return null;
    }
  }

  const scheduler = createUsageScheduler({
    usageDb,
    syncInstance: syncUsageForInstance,
    logger: console,
  });

  importLegacySettingsIfNeeded();

  app.use(express.json());
  app.disable('x-powered-by');
  app.use(express.static(distDir));
  app.use('/api/auth', authRouter);
  app.use('/api', applyAuthState, requireAppAuth);

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
      } catch {
        clearInterval(heartbeat);
        usageStreamClients.delete(res);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      usageStreamClients.delete(res);
    });
  });

  app.get('/api/cpa-instances', (req, res) => {
    res.json({
      instances: usageDb.getCpaInstances().map(serializeCpaInstance),
    });
  });

  app.post('/api/cpa-instances', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const baseUrl = req.body?.baseUrl;
    const apiKey = req.body?.apiKey;
    const syncInterval = Number(req.body?.syncInterval) || DEFAULT_SYNC_INTERVAL_MINUTES;
    const isEnabled = req.body?.isEnabled !== false;

    if (!baseUrl || !apiKey) {
      return res.status(400).json({ error: 'CLI-Proxy 地址和管理密码不能为空' });
    }

    const validation = await validateCliProxyManagementAccess(baseUrl, apiKey, fetchImpl);
    if (!validation.ok) {
      return res.status(validation.status || 400).json({ error: validation.error });
    }

    const now = new Date().toISOString();
    const instance = usageDb.createCpaInstance({
      name: name || deriveDefaultInstanceName(validation.normalizedBaseUrl, usageDb.countCpaInstances() + 1),
      baseUrl: validation.normalizedBaseUrl,
      apiKey: String(apiKey).trim(),
      syncInterval,
      isEnabled,
      status: isEnabled ? 'healthy' : DISABLED_INSTANCE_STATUS,
      statusMessage: isEnabled ? '管理接口验证成功' : 'Instance disabled',
      lastCheckedAt: now,
    });

    usageDb.ensureActiveCpaInstance();
    scheduler.refresh({
      immediateIds: instance.isEnabled ? [instance.id] : [],
    });

    res.status(201).json({
      instance: serializeCpaInstance(usageDb.getCpaInstanceById(instance.id)),
    });
  });

  app.patch('/api/cpa-instances/:id', async (req, res) => {
    const instanceId = Number(req.params.id);
    const current = usageDb.getCpaInstanceById(instanceId);
    if (!current) {
      return res.status(404).json({ error: '实例不存在' });
    }

    const nextName = req.body?.name !== undefined ? String(req.body.name || '').trim() : current.name;
    const nextBaseUrl = req.body?.baseUrl !== undefined ? String(req.body.baseUrl || '').trim() : current.baseUrl;
    const nextApiKey = String(req.body?.apiKey || '').trim() || current.apiKey;
    const nextSyncInterval = req.body?.syncInterval !== undefined
      ? Number(req.body.syncInterval) || DEFAULT_SYNC_INTERVAL_MINUTES
      : current.syncInterval;
    const nextIsEnabled = req.body?.isEnabled !== undefined ? Boolean(req.body.isEnabled) : current.isEnabled;
    const credentialsChanged = nextBaseUrl !== current.baseUrl || nextApiKey !== current.apiKey;
    const enablingFromDisabled = !current.isEnabled && nextIsEnabled;

    let status = current.status;
    let statusMessage = current.statusMessage;
    let lastCheckedAt = current.lastCheckedAt;
    let normalizedBaseUrl = normalizeCliProxyBaseUrl(nextBaseUrl);

    if (nextIsEnabled && (credentialsChanged || enablingFromDisabled)) {
      const validation = await validateCliProxyManagementAccess(nextBaseUrl, nextApiKey, fetchImpl);
      if (!validation.ok) {
        return res.status(validation.status || 400).json({ error: validation.error });
      }

      normalizedBaseUrl = validation.normalizedBaseUrl;
      status = 'healthy';
      statusMessage = '管理接口验证成功';
      lastCheckedAt = new Date().toISOString();
    } else if (!nextIsEnabled) {
      status = DISABLED_INSTANCE_STATUS;
      statusMessage = 'Instance disabled';
    } else if (current.status === DISABLED_INSTANCE_STATUS) {
      status = DEFAULT_INSTANCE_STATUS;
      statusMessage = '';
    }

    const updated = usageDb.updateCpaInstance(instanceId, {
      name: nextName || current.name,
      baseUrl: normalizedBaseUrl,
      apiKey: nextApiKey,
      syncInterval: nextSyncInterval,
      isEnabled: nextIsEnabled,
      status,
      statusMessage,
      lastCheckedAt,
    });

    usageDb.ensureActiveCpaInstance();
    scheduler.refresh({
      immediateIds: updated?.isEnabled && (credentialsChanged || enablingFromDisabled) ? [updated.id] : [],
    });

    res.json({
      instance: serializeCpaInstance(usageDb.getCpaInstanceById(instanceId)),
    });
  });

  app.post('/api/cpa-instances/:id/activate', (req, res) => {
    const instanceId = Number(req.params.id);
    const activated = usageDb.activateCpaInstance(instanceId);
    if (!activated) {
      return res.status(400).json({ error: '只能激活已启用的实例' });
    }

    scheduler.refresh();
    res.json({
      instance: serializeCpaInstance(activated),
    });
  });

  app.post('/api/cpa-instances/:id/check', async (req, res) => {
    const instanceId = Number(req.params.id);
    const instance = usageDb.getCpaInstanceById(instanceId);
    if (!instance) {
      return res.status(404).json({ error: '实例不存在' });
    }

    if (!instance.isEnabled) {
      return res.status(409).json({ error: '实例已停用，启用后再检查' });
    }

    const validation = await validateCliProxyManagementAccess(instance.baseUrl, instance.apiKey, fetchImpl);
    const now = new Date().toISOString();

    if (!validation.ok) {
      const nextState = getValidationStatusResult(validation);
      const updated = usageDb.updateCpaInstance(instanceId, {
        baseUrl: instance.baseUrl,
        apiKey: instance.apiKey,
        status: nextState.status,
        statusMessage: nextState.statusMessage,
        lastCheckedAt: now,
      });

      return res.status(validation.status || 400).json({
        error: validation.error,
        instance: serializeCpaInstance(updated),
      });
    }

    const updated = usageDb.updateCpaInstance(instanceId, {
      baseUrl: validation.normalizedBaseUrl,
      apiKey: instance.apiKey,
      status: 'healthy',
      statusMessage: '管理接口验证成功',
      lastCheckedAt: now,
    });

    res.json({
      instance: serializeCpaInstance(updated),
    });
  });

  app.get('/api/usage', (req, res) => {
    const resolved = resolveUsageScope(req.query.scope, req.query.instanceId);
    if (resolved.error) {
      return res.status(resolved.status || 400).json({ error: resolved.error });
    }

    res.json(buildUsageResponse(resolved.scope, resolved.instance));
  });

  app.get('/api/usage/history', (req, res) => {
    const resolved = resolveUsageScope(req.query.scope, req.query.instanceId);
    if (resolved.error) {
      return res.status(resolved.status || 400).json({ error: resolved.error });
    }

    const payload = buildUsageResponse(resolved.scope, resolved.instance);
    res.json({
      exports: [],
      lastExport: payload.lastExport,
    });
  });

  app.post('/api/usage/export-now', async (req, res) => {
    const resolved = resolveUsageScope(req.query.scope, req.query.instanceId);
    if (resolved.error && req.query.scope !== 'all') {
      return res.status(resolved.status || 400).json({ error: resolved.error });
    }

    try {
      if (req.query.scope === 'all') {
        const enabledInstances = usageDb.getEnabledCpaInstances();
        if (enabledInstances.length === 0) {
          return res.status(409).json({ error: '没有可同步的启用实例' });
        }

        for (const instance of enabledInstances) {
          await syncUsageForInstance(instance.id);
        }
      } else {
        if (!resolved.instance?.isEnabled) {
          return res.status(409).json({ error: '当前实例已停用，无法同步' });
        }
        await syncUsageForInstance(resolved.instance.id);
      }

      const payload = buildUsageResponse(req.query.scope === 'all' ? 'all' : resolved.scope, resolved.instance);
      res.json({
        success: true,
        ...payload,
      });
    } catch (error) {
      console.error('手动同步失败:', error);
      res.status(500).json({ error: error?.message || '手动同步失败' });
    }
  });

  app.get('/api/pricing', (req, res) => {
    res.json(usageDb.getModelPricing());
  });

  app.put('/api/pricing', (req, res) => {
    const pricing = normalizeModelPricingMap(req.body?.pricing);
    if (pricing === null) {
      return res.status(400).json({ error: 'pricing 必须是对象' });
    }

    usageDb.replaceModelPricing(pricing);
    res.json({
      success: true,
      pricing: usageDb.getModelPricing(),
    });
  });

  app.post('/api/pricing', (req, res) => {
    const modelName = String(req.body?.model || '').trim();
    if (!modelName) {
      return res.status(400).json({ error: '模型名称不能为空' });
    }

    const pricing = normalizeModelPricingMap({
      [modelName]: {
        promptPrice: req.body?.inputPrice,
        completionPrice: req.body?.outputPrice,
        cachePrice: req.body?.cachePrice,
      },
    });

    const nextPricing = pricing?.[modelName] || {
      promptPrice: 0,
      completionPrice: 0,
      cachePrice: 0,
    };

    usageDb.upsertModelPricing(
      modelName,
      nextPricing.promptPrice,
      nextPricing.completionPrice,
      nextPricing.cachePrice
    );
    res.json({
      success: true,
      pricing: usageDb.getModelPricing(),
    });
  });

  app.delete('/api/pricing/:model', (req, res) => {
    usageDb.deleteModelPricing(req.params.model);
    res.json({ success: true });
  });

  app.get('/api/settings', (req, res) => {
    const activeInstance = usageDb.getActiveCpaInstance({ includeDisabled: true });
    if (!activeInstance) {
      return res.json({ configured: false });
    }

    res.json({
      configured: activeInstance.isEnabled,
      cliProxyUrl: activeInstance.baseUrl,
      syncInterval: activeInstance.syncInterval,
    });
  });

  app.get('/api/codex/accounts', async (req, res) => {
    const activeContext = getActiveInstanceContext();
    if (activeContext.error) {
      return res.status(activeContext.status || 400).json({ error: activeContext.error });
    }

    try {
      const { response, payload } = await activeContext.client.fetchAuthFiles();
      if (!response.ok) {
        return res.status(response.status).json({ error: '获取 CodeX 账号失败' });
      }

      const files = payload?.files || payload || [];
      const codexAccounts = (Array.isArray(files) ? files : [])
        .filter((file) => file.type === 'codex' || file.provider === 'codex')
        .map((account) => ({
          email: account.email || account.account,
          authIndex: account.auth_index,
          status: account.status,
          disabled: account.disabled,
          planType: account.id_token?.plan_type,
          label: account.label,
        }));

      res.json(codexAccounts);
    } catch (error) {
      console.error('获取 CodeX 账号失败:', error);
      res.status(500).json({ error: error?.message || '获取 CodeX 账号失败' });
    }
  });

  async function probeCodexAccount(client, authIndex, chatgptAccountId) {
    const userAgent = 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal';
    const payload = {
      authIndex,
      method: 'GET',
      url: 'https://chatgpt.com/backend-api/wham/usage',
      header: {
        Authorization: 'Bearer $TOKEN$',
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
        ...(chatgptAccountId ? { 'Chatgpt-Account-Id': chatgptAccountId } : {}),
      },
    };

    try {
      const { response, payload: data } = await client.apiCall(payload);
      if (!response.ok) {
        return { valid: false, error: `HTTP ${response.status}` };
      }

      const statusCode = data?.status_code || data?.statusCode;
      if (statusCode === 401) {
        return { valid: false, statusCode, error: 'unauthorized' };
      }

      if (statusCode >= 200 && statusCode < 300) {
        return { valid: true, statusCode };
      }

      return { valid: false, statusCode, error: `status ${statusCode}` };
    } catch (error) {
      return { valid: false, error: error?.message || 'unknown error' };
    }
  }

  const CODEX_FIVE_HOUR_WINDOW_SECONDS = 5 * 60 * 60;
  const CODEX_WEEKLY_WINDOW_SECONDS = 7 * 24 * 60 * 60;

  function toFiniteNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function resolveCodexWindowSeconds(window, fallbackDurationSeconds = null) {
    return (
      toFiniteNumber(
        window?.limit_window_seconds ??
        window?.limitWindowSeconds ??
        window?.duration_seconds ??
        window?.durationSeconds ??
        window?.window_seconds ??
        window?.windowSeconds ??
        window?.window_size_seconds ??
        window?.windowSizeSeconds ??
        window?.interval_seconds ??
        window?.intervalSeconds
      ) ?? fallbackDurationSeconds
    );
  }

  function resolveCodexResetAt(window) {
    const resetAt = toFiniteNumber(window?.reset_at ?? window?.resetAt);
    if (resetAt !== null && resetAt > 0) {
      return resetAt;
    }

    const resetAfterSeconds = toFiniteNumber(window?.reset_after_seconds ?? window?.resetAfterSeconds);
    if (resetAfterSeconds !== null && resetAfterSeconds > 0) {
      return Math.floor(Date.now() / 1000 + resetAfterSeconds);
    }

    return null;
  }

  function normalizeCodexQuotaWindow(window, source, fallbackDurationSeconds = null, options = {}) {
    if (!window || typeof window !== 'object') return null;

    const usedPercentValue = toFiniteNumber(
      window.used_percent ??
      window.usedPercent ??
      window.percent_used ??
      window.percentUsed
    );

    const resetAt = resolveCodexResetAt(window);
    const isLimitReached = Boolean(options.limitReached) || options.allowed === false;
    if (usedPercentValue === null && !(isLimitReached && resetAt !== null)) {
      return null;
    }

    const durationSeconds = resolveCodexWindowSeconds(window, fallbackDurationSeconds);
    const usedPercent = Math.max(0, Math.min(100, usedPercentValue ?? 100));

    return {
      source,
      durationSeconds,
      usedPercent,
      remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
      resetAt,
    };
  }

  function extractCodexQuotaWindows(rateLimit) {
    const normalizedWindows = [];
    const limitReached = rateLimit?.limit_reached ?? rateLimit?.limitReached;
    const allowed = rateLimit?.allowed;

    if (rateLimit?.primary_window) {
      const primaryWindow = normalizeCodexQuotaWindow(
        rateLimit.primary_window,
        'primary',
        CODEX_FIVE_HOUR_WINDOW_SECONDS,
        { limitReached, allowed }
      );
      if (primaryWindow) normalizedWindows.push(primaryWindow);
    }

    if (rateLimit?.secondary_window) {
      const secondaryWindow = normalizeCodexQuotaWindow(
        rateLimit.secondary_window,
        'secondary',
        CODEX_WEEKLY_WINDOW_SECONDS,
        { limitReached, allowed }
      );
      if (secondaryWindow) normalizedWindows.push(secondaryWindow);
    }

    if (Array.isArray(rateLimit?.windows)) {
      rateLimit.windows.forEach((window, index) => {
        const normalizedWindow = normalizeCodexQuotaWindow(window, `windows[${index}]`, null, {
          limitReached,
          allowed,
        });
        if (normalizedWindow) normalizedWindows.push(normalizedWindow);
      });
    }

    const sortedByDuration = [...normalizedWindows].sort((a, b) => {
      const durationA = a.durationSeconds ?? Number.MAX_SAFE_INTEGER;
      const durationB = b.durationSeconds ?? Number.MAX_SAFE_INTEGER;
      return durationA - durationB;
    });

    const sortedByDurationDesc = [...sortedByDuration].reverse();
    const fiveHourWindow =
      normalizedWindows.find((window) => window.durationSeconds === CODEX_FIVE_HOUR_WINDOW_SECONDS) ||
      normalizedWindows.find((window) => window.source === 'primary') ||
      sortedByDuration[0] ||
      null;
    const weeklyWindow =
      normalizedWindows.find((window) => window.durationSeconds === CODEX_WEEKLY_WINDOW_SECONDS) ||
      normalizedWindows.find((window) => window.source === 'secondary') ||
      sortedByDurationDesc.find((window) => window !== fiveHourWindow) ||
      null;

    return {
      fiveHourWindow,
      weeklyWindow,
    };
  }

  async function probeCodexQuota(client, authIndex, chatgptAccountId) {
    const userAgent = 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal';
    const payload = {
      auth_index: authIndex,
      method: 'GET',
      url: 'https://chatgpt.com/backend-api/wham/usage',
      header: {
        Authorization: 'Bearer $TOKEN$',
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
        ...(chatgptAccountId ? { 'Chatgpt-Account-Id': chatgptAccountId } : {}),
      },
    };

    try {
      const { response, payload: data } = await client.apiCall(payload);
      if (!response.ok) {
        return { error: `HTTP ${response.status}` };
      }

      const statusCode = data?.status_code || data?.statusCode;
      if (statusCode === 401) {
        return { error: 'unauthorized', statusCode };
      }

      const body = data?.body || data?.response_body;
      if (body) {
        try {
          const usageData = typeof body === 'string' ? JSON.parse(body) : body;
          const rateLimit = usageData.rate_limit;
          const { fiveHourWindow, weeklyWindow } = extractCodexQuotaWindows(rateLimit);

          if (fiveHourWindow || weeklyWindow) {
            return {
              completionQuota: fiveHourWindow?.remainingPercent,
              usedPercent: fiveHourWindow?.usedPercent,
              resetAt: fiveHourWindow?.resetAt,
              fiveHourWindow,
              weeklyWindow,
              statusCode,
            };
          }
        } catch {
          return { statusCode, error: 'no quota data' };
        }
      }

      return { statusCode, error: 'no quota data' };
    } catch (error) {
      return { error: error?.message || 'unknown error' };
    }
  }

  app.post('/api/codex/check', async (req, res) => {
    const activeContext = getActiveInstanceContext();
    if (activeContext.error) {
      return res.status(activeContext.status || 400).json({ error: activeContext.error });
    }

    try {
      const { response, payload } = await activeContext.client.fetchAuthFiles();
      if (!response.ok) {
        return res.status(response.status).json({ error: '获取账号失败' });
      }

      const files = payload?.files || payload || [];
      const codexAccounts = (Array.isArray(files) ? files : [])
        .filter((file) => file.type === 'codex' || file.provider === 'codex');

      let valid = 0;
      let invalid = 0;
      const invalidAccounts = [];
      const concurrency = 20;

      for (let index = 0; index < codexAccounts.length; index += concurrency) {
        const batch = codexAccounts.slice(index, index + concurrency);
        const results = await Promise.all(
          batch.map(async (account) => {
            const authIndex = account.auth_index;
            const chatgptAccountId = account.id_token?.chatgpt_account_id;
            if (!hasDefinedIdentifier(authIndex)) {
              return { account, result: { valid: false, error: 'no auth_index' } };
            }

            const result = await probeCodexAccount(activeContext.client, authIndex, chatgptAccountId);
            return { account, result };
          })
        );

        results.forEach(({ account, result }) => {
          if (result.valid) {
            valid += 1;
          } else {
            invalid += 1;
            invalidAccounts.push({
              email: account.email || account.account,
              name: account.name || account.id,
              error: result.error,
            });
          }
        });
      }

      res.json({ valid, invalid, total: codexAccounts.length, invalidAccounts });
    } catch (error) {
      console.error('检查 CodeX 账号失败:', error);
      res.status(500).json({ error: error?.message || '检查 CodeX 账号失败' });
    }
  });

  app.post('/api/codex/quota', async (req, res) => {
    const activeContext = getActiveInstanceContext();
    if (activeContext.error) {
      return res.status(activeContext.status || 400).json({ error: activeContext.error });
    }

    try {
      const { authIndexes } = req.body || {};
      const { response, payload } = await activeContext.client.fetchAuthFiles();
      if (!response.ok) {
        return res.status(response.status).json({ error: '获取账号失败' });
      }

      const files = payload?.files || payload || [];
      let codexAccounts = (Array.isArray(files) ? files : [])
        .filter((file) => file.type === 'codex' || file.provider === 'codex');

      if (Array.isArray(authIndexes) && authIndexes.length > 0) {
        const indexSet = new Set(authIndexes.map((value) => String(value)));
        codexAccounts = codexAccounts.filter((account) => indexSet.has(String(account.auth_index)));
      }

      const quotas = [];
      const concurrency = 20;
      for (let index = 0; index < codexAccounts.length; index += concurrency) {
        const batch = codexAccounts.slice(index, index + concurrency);
        const results = await Promise.all(
          batch.map(async (account) => {
            const authIndex = account.auth_index;
            const chatgptAccountId = account.id_token?.chatgpt_account_id;
            if (!hasDefinedIdentifier(authIndex)) return null;

            const result = await probeCodexQuota(activeContext.client, authIndex, chatgptAccountId);
            if (result.completionQuota !== undefined || result.fiveHourWindow || result.weeklyWindow) {
              return {
                authIndex,
                email: account.email || account.account,
                completionQuota: result.completionQuota,
                usedPercent: result.usedPercent,
                resetAt: result.resetAt,
                fiveHourWindow: result.fiveHourWindow || null,
                weeklyWindow: result.weeklyWindow || null,
              };
            }

            return null;
          })
        );

        quotas.push(...results.filter(Boolean));
      }

      res.json({ total: codexAccounts.length, checked: quotas.length, quotas });
    } catch (error) {
      console.error('检查 CodeX 配额失败:', error);
      res.status(500).json({ error: error?.message || '检查 CodeX 配额失败' });
    }
  });

  app.post('/api/codex/delete-by-auth', async (req, res) => {
    const activeContext = getActiveInstanceContext();
    if (activeContext.error) {
      return res.status(activeContext.status || 400).json({ error: activeContext.error });
    }

    try {
      const { authIndexes } = req.body || {};
      if (!Array.isArray(authIndexes) || authIndexes.length === 0) {
        return res.status(400).json({ error: '没有要删除的账号' });
      }

      const { response, payload } = await activeContext.client.fetchAuthFiles();
      if (!response.ok) {
        return res.status(response.status).json({ error: '获取账号失败' });
      }

      const files = payload?.files || payload || [];
      const indexSet = new Set(authIndexes.map((value) => String(value)));
      const toDelete = (Array.isArray(files) ? files : [])
        .filter((file) => indexSet.has(String(file.auth_index)))
        .map((file) => file.name || file.id)
        .filter(Boolean);

      let deleted = 0;
      let failed = 0;
      for (const name of toDelete) {
        try {
          const result = await activeContext.client.deleteAuthFile(name);
          if (result.response.ok) {
            deleted += 1;
          } else {
            failed += 1;
          }
        } catch {
          failed += 1;
        }
      }

      res.json({ deleted, failed, total: toDelete.length });
    } catch (error) {
      console.error('删除 CodeX 账号失败:', error);
      res.status(500).json({ error: error?.message || '删除 CodeX 账号失败' });
    }
  });

  app.post('/api/codex/delete', async (req, res) => {
    const activeContext = getActiveInstanceContext();
    if (activeContext.error) {
      return res.status(activeContext.status || 400).json({ error: activeContext.error });
    }

    try {
      const { names } = req.body || {};
      if (!Array.isArray(names) || names.length === 0) {
        return res.status(400).json({ error: '没有要删除的账号' });
      }

      let deleted = 0;
      let failed = 0;
      for (const name of names) {
        try {
          const result = await activeContext.client.deleteAuthFile(name);
          if (result.response.ok) {
            deleted += 1;
          } else {
            failed += 1;
          }
        } catch {
          failed += 1;
        }
      }

      res.json({ deleted, failed, total: names.length });
    } catch (error) {
      console.error('删除 CodeX 账号失败:', error);
      res.status(500).json({ error: error?.message || '删除 CodeX 账号失败' });
    }
  });

  if (devMode) {
    app.use('/', createProxyMiddleware({
      target: devServerUrl,
      changeOrigin: true,
      ws: true,
      filter: (req) => !req.path.startsWith('/api'),
    }));
  } else {
    app.get('*', (req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  function startBackgroundServices() {
    scheduler.refresh({
      immediateIds: usageDb.getEnabledCpaInstances().map((instance) => instance.id),
    });
  }

  function stopBackgroundServices() {
    scheduler.stop();
  }

  return {
    app,
    port,
    usageDb,
    scheduler,
    startBackgroundServices,
    stopBackgroundServices,
    serializeCpaInstance,
  };
}

module.exports = {
  createServerApp,
  deriveDefaultInstanceName,
  serializeCpaInstance,
};
