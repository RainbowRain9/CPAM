const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DEFAULT_INSTANCE_STATUS = 'unreachable';
const DISABLED_INSTANCE_STATUS = 'disabled';

function ensureDataDir(dataDir) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function hasTableColumn(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((row) => row.name === columnName);
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  if (!hasTableColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function toBooleanFlag(value) {
  return value === 1 || value === true ? 1 : 0;
}

function mapInstanceRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    syncInterval: row.sync_interval_minutes,
    isActive: row.is_active === 1,
    isEnabled: row.is_enabled === 1,
    status: row.status,
    statusMessage: row.status_message || '',
    lastCheckedAt: row.last_checked_at || null,
    lastSyncAt: row.last_sync_at || null,
    lastExportAt: row.last_export_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildScopedCacheKey(instanceId, type, value) {
  return `instance:${instanceId}:${type}:${String(value)}`;
}

function escapeLikeValue(value) {
  return String(value).replace(/([%_\\])/g, '\\$1');
}

function createUsageDb(options = {}) {
  const dataDir = options.dataDir || process.env.CPAM_DATA_DIR || path.join(__dirname, '..', 'data');
  const dbFile = options.dbFile || path.join(dataDir, 'usage.db');

  ensureDataDir(dataDir);

  const db = new Database(dbFile);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT UNIQUE,
      api_path TEXT NOT NULL,
      model TEXT NOT NULL,
      source TEXT,
      auth_index TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      success INTEGER DEFAULT 1,
      request_time TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      cached_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      instance_id INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_records(model);
    CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_records(request_time);
    CREATE INDEX IF NOT EXISTS idx_usage_api ON usage_records(api_path);
    CREATE INDEX IF NOT EXISTS idx_usage_auth ON usage_records(auth_index);
    CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_records(date(request_time));

    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_sync TEXT,
      last_export_at TEXT
    );

    INSERT OR IGNORE INTO sync_state (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS key_provider_cache (
      cache_key TEXT PRIMARY KEY,
      provider TEXT,
      channel TEXT,
      email TEXT,
      source TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS model_pricing (
      model TEXT PRIMARY KEY,
      input_price REAL DEFAULT 0,
      output_price REAL DEFAULT 0,
      cache_price REAL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS auth_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      password_changed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      user_agent TEXT,
      ip_address TEXT,
      FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS cpa_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      sync_interval_minutes INTEGER NOT NULL DEFAULT 5,
      is_active INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT '${DEFAULT_INSTANCE_STATUS}',
      status_message TEXT NOT NULL DEFAULT '',
      last_checked_at TEXT,
      last_sync_at TEXT,
      last_export_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cpa_instances_active ON cpa_instances(is_active);
    CREATE INDEX IF NOT EXISTS idx_cpa_instances_enabled ON cpa_instances(is_enabled);
  `);

  addColumnIfMissing(db, 'usage_records', 'cached_tokens', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'usage_records', 'reasoning_tokens', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'usage_records', 'instance_id', 'INTEGER');
  addColumnIfMissing(db, 'model_pricing', 'cache_price', 'REAL');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_usage_instance ON usage_records(instance_id);
    CREATE INDEX IF NOT EXISTS idx_usage_instance_time ON usage_records(instance_id, request_time);
  `);

  const stmts = {
    insertUsage: db.prepare(`
      INSERT OR IGNORE INTO usage_records
      (
        request_id,
        api_path,
        model,
        source,
        auth_index,
        input_tokens,
        output_tokens,
        total_tokens,
        cached_tokens,
        reasoning_tokens,
        success,
        request_time,
        instance_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),

    getSyncState: db.prepare('SELECT * FROM sync_state WHERE id = 1'),
    updateSyncState: db.prepare('UPDATE sync_state SET last_sync = ?, last_export_at = ? WHERE id = 1'),

    getKeyProviderCacheRows: db.prepare('SELECT * FROM key_provider_cache'),
    upsertKeyProvider: db.prepare(`
      INSERT OR REPLACE INTO key_provider_cache (cache_key, provider, channel, email, source, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `),

    getModelPricing: db.prepare('SELECT * FROM model_pricing'),
    clearModelPricing: db.prepare('DELETE FROM model_pricing'),
    upsertModelPricing: db.prepare(`
      INSERT OR REPLACE INTO model_pricing (model, input_price, output_price, cache_price, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `),
    deleteModelPricing: db.prepare('DELETE FROM model_pricing WHERE model = ?'),

    countAuthUsers: db.prepare('SELECT COUNT(*) as count FROM auth_users'),
    getAuthUserById: db.prepare('SELECT * FROM auth_users WHERE id = ?'),
    getAuthUserByUsername: db.prepare('SELECT * FROM auth_users WHERE username = ?'),
    getSingleAuthUser: db.prepare('SELECT * FROM auth_users ORDER BY id LIMIT 1'),
    insertAuthUser: db.prepare(`
      INSERT INTO auth_users (username, password_hash, created_at, updated_at, password_changed_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    updateAuthUserPassword: db.prepare(`
      UPDATE auth_users
      SET password_hash = ?, updated_at = ?, password_changed_at = ?
      WHERE id = ?
    `),
    insertAuthSession: db.prepare(`
      INSERT INTO auth_sessions (
        user_id,
        session_token_hash,
        expires_at,
        last_seen_at,
        created_at,
        revoked_at,
        user_agent,
        ip_address
      )
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    `),
    getAuthSessionById: db.prepare(`
      SELECT
        s.*,
        u.username,
        u.password_changed_at
      FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id
      WHERE s.id = ?
      LIMIT 1
    `),
    getAuthSessionByTokenHash: db.prepare(`
      SELECT
        s.*,
        u.username,
        u.password_changed_at
      FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id
      WHERE s.session_token_hash = ?
      LIMIT 1
    `),
    touchAuthSession: db.prepare(`
      UPDATE auth_sessions
      SET expires_at = ?, last_seen_at = ?
      WHERE id = ? AND revoked_at IS NULL
    `),
    revokeAuthSession: db.prepare(`
      UPDATE auth_sessions
      SET revoked_at = ?
      WHERE id = ? AND revoked_at IS NULL
    `),
    revokeAuthSessionsByUserId: db.prepare(`
      UPDATE auth_sessions
      SET revoked_at = ?
      WHERE user_id = ? AND revoked_at IS NULL
    `),

    countCpaInstances: db.prepare('SELECT COUNT(*) as count FROM cpa_instances'),
    getCpaInstanceById: db.prepare('SELECT * FROM cpa_instances WHERE id = ? LIMIT 1'),
    getActiveCpaInstance: db.prepare(`
      SELECT * FROM cpa_instances
      WHERE is_active = 1
      ORDER BY id
      LIMIT 1
    `),
    getActiveEnabledCpaInstance: db.prepare(`
      SELECT * FROM cpa_instances
      WHERE is_active = 1 AND is_enabled = 1
      ORDER BY id
      LIMIT 1
    `),
    listCpaInstances: db.prepare(`
      SELECT * FROM cpa_instances
      ORDER BY is_active DESC, is_enabled DESC, updated_at DESC, id DESC
    `),
    listEnabledCpaInstances: db.prepare(`
      SELECT * FROM cpa_instances
      WHERE is_enabled = 1
      ORDER BY is_active DESC, updated_at DESC, id DESC
    `),
    getFirstEnabledCpaInstance: db.prepare(`
      SELECT * FROM cpa_instances
      WHERE is_enabled = 1
      ORDER BY is_active DESC, updated_at DESC, id ASC
      LIMIT 1
    `),
    insertCpaInstance: db.prepare(`
      INSERT INTO cpa_instances (
        name,
        base_url,
        api_key,
        sync_interval_minutes,
        is_active,
        is_enabled,
        status,
        status_message,
        last_checked_at,
        last_sync_at,
        last_export_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateCpaInstance: db.prepare(`
      UPDATE cpa_instances
      SET
        name = ?,
        base_url = ?,
        api_key = ?,
        sync_interval_minutes = ?,
        is_active = ?,
        is_enabled = ?,
        status = ?,
        status_message = ?,
        last_checked_at = ?,
        last_sync_at = ?,
        last_export_at = ?,
        updated_at = ?
      WHERE id = ?
    `),
    clearActiveCpaInstances: db.prepare('UPDATE cpa_instances SET is_active = 0 WHERE is_active = 1'),
    setActiveCpaInstance: db.prepare('UPDATE cpa_instances SET is_active = 1, updated_at = ? WHERE id = ?'),
    updateCpaInstanceStatusOnly: db.prepare(`
      UPDATE cpa_instances
      SET status = ?, status_message = ?, last_checked_at = ?, updated_at = ?
      WHERE id = ?
    `),
    updateCpaInstanceSyncMeta: db.prepare(`
      UPDATE cpa_instances
      SET
        status = ?,
        status_message = ?,
        last_checked_at = ?,
        last_sync_at = ?,
        last_export_at = ?,
        updated_at = ?
      WHERE id = ?
    `),
    getUsageViewMetaByInstance: db.prepare(`
      SELECT
        MAX(last_sync_at) as last_sync_at,
        MAX(last_export_at) as last_export_at
      FROM cpa_instances
      WHERE id = ?
    `),
    getUsageViewMetaAll: db.prepare(`
      SELECT
        MAX(last_sync_at) as last_sync_at,
        MAX(last_export_at) as last_export_at
      FROM cpa_instances
    `),
    namespaceLegacyUsageRecords: db.prepare(`
      UPDATE usage_records
      SET request_id = ? || request_id
      WHERE instance_id IS NULL
        AND request_id NOT LIKE ?
    `),
    assignLegacyUsageRecords: db.prepare(`
      UPDATE usage_records
      SET instance_id = ?
      WHERE instance_id IS NULL
    `),
  };

  const insertUsageBatch = db.transaction((records) => {
    let inserted = 0;
    for (const record of records) {
      const result = stmts.insertUsage.run(
        record.request_id,
        record.api_path,
        record.model,
        record.source,
        record.auth_index,
        record.input_tokens || 0,
        record.output_tokens || 0,
        record.total_tokens || 0,
        record.cached_tokens || 0,
        record.reasoning_tokens || 0,
        record.success ? 1 : 0,
        record.request_time,
        record.instance_id || null
      );
      if (result.changes > 0) inserted += 1;
    }
    return inserted;
  });

  const createCpaInstanceTx = db.transaction((input) => {
    const now = input.now || new Date().toISOString();
    const currentCount = stmts.countCpaInstances.get().count || 0;
    const shouldActivate = Boolean(input.forceActive) || (currentCount === 0 && input.isEnabled !== false);
    const isEnabled = input.isEnabled !== false;
    const status = isEnabled
      ? input.status || DEFAULT_INSTANCE_STATUS
      : DISABLED_INSTANCE_STATUS;
    const statusMessage = input.statusMessage || (isEnabled ? '' : 'Instance disabled');

    if (shouldActivate) {
      stmts.clearActiveCpaInstances.run();
    }

    const result = stmts.insertCpaInstance.run(
      input.name,
      input.baseUrl,
      input.apiKey,
      input.syncInterval || 5,
      toBooleanFlag(shouldActivate),
      toBooleanFlag(isEnabled),
      status,
      statusMessage,
      input.lastCheckedAt || null,
      input.lastSyncAt || null,
      input.lastExportAt || null,
      now,
      now
    );

    return stmts.getCpaInstanceById.get(result.lastInsertRowid);
  });

  const activateCpaInstanceTx = db.transaction((instanceId, now) => {
    const current = stmts.getCpaInstanceById.get(instanceId);
    if (!current || current.is_enabled !== 1) {
      return null;
    }

    stmts.clearActiveCpaInstances.run();
    stmts.setActiveCpaInstance.run(now || new Date().toISOString(), instanceId);
    return stmts.getCpaInstanceById.get(instanceId);
  });

  const ensureActiveCpaInstanceTx = db.transaction(() => {
    const activeEnabled = stmts.getActiveEnabledCpaInstance.get();
    if (activeEnabled) {
      return activeEnabled;
    }

    stmts.clearActiveCpaInstances.run();
    const fallback = stmts.getFirstEnabledCpaInstance.get();
    if (!fallback) {
      return null;
    }

    stmts.setActiveCpaInstance.run(new Date().toISOString(), fallback.id);
    return stmts.getCpaInstanceById.get(fallback.id);
  });

  const assignLegacyDataTx = db.transaction((instanceId) => {
    const prefix = `instance:${instanceId}:`;

    stmts.namespaceLegacyUsageRecords.run(prefix, `${prefix}%`);
    stmts.assignLegacyUsageRecords.run(instanceId);

    const cacheRows = stmts.getKeyProviderCacheRows.all();
    for (const row of cacheRows) {
      const hasAuthMatch = db.prepare(`
        SELECT 1
        FROM usage_records
        WHERE instance_id = ? AND auth_index = ?
        LIMIT 1
      `).get(instanceId, row.cache_key);
      const hasSourceMatch = db.prepare(`
        SELECT 1
        FROM usage_records
        WHERE instance_id = ? AND source = ?
        LIMIT 1
      `).get(instanceId, row.cache_key);

      if (hasAuthMatch) {
        stmts.upsertKeyProvider.run(
          buildScopedCacheKey(instanceId, 'auth', row.cache_key),
          row.provider,
          row.channel,
          row.email,
          row.source
        );
      }

      if (hasSourceMatch || !hasAuthMatch) {
        stmts.upsertKeyProvider.run(
          buildScopedCacheKey(instanceId, 'source', row.cache_key),
          row.provider,
          row.channel,
          row.email,
          row.source
        );
      }
    }
  });

  const replaceModelPricingTx = db.transaction((pricingMap) => {
    stmts.clearModelPricing.run();

    for (const [model, pricing] of Object.entries(pricingMap || {})) {
      stmts.upsertModelPricing.run(
        model,
        pricing.promptPrice,
        pricing.completionPrice,
        pricing.cachePrice
      );
    }
  });

  function buildUsageWhereClause(instanceId) {
    if (instanceId === undefined || instanceId === null || instanceId === '') {
      return { clause: '', params: [] };
    }

    return {
      clause: 'WHERE ur.instance_id = ?',
      params: [Number(instanceId)],
    };
  }

  function getUsageStats(options = {}) {
    const { instanceId } = options;
    const filter = buildUsageWhereClause(instanceId);
    const baseWhere = filter.clause;
    const baseParams = filter.params;

    const overview = db.prepare(`
      SELECT
        COUNT(*) as total_requests,
        SUM(CASE WHEN ur.success = 1 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN ur.success = 0 THEN 1 ELSE 0 END) as failure_count,
        SUM(ur.total_tokens) as total_tokens,
        SUM(ur.input_tokens) as total_input_tokens,
        SUM(ur.output_tokens) as total_output_tokens,
        SUM(ur.cached_tokens) as total_cached_tokens,
        SUM(ur.reasoning_tokens) as total_reasoning_tokens
      FROM usage_records ur
      ${baseWhere}
    `).get(...baseParams);

    const byModel = db.prepare(`
      SELECT
        ur.model,
        COUNT(*) as requests,
        SUM(CASE WHEN ur.success = 1 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN ur.success = 0 THEN 1 ELSE 0 END) as failure_count,
        SUM(ur.total_tokens) as total_tokens,
        SUM(ur.input_tokens) as input_tokens,
        SUM(ur.output_tokens) as output_tokens,
        SUM(ur.cached_tokens) as cached_tokens,
        SUM(ur.reasoning_tokens) as reasoning_tokens,
        MAX(ur.request_time) as last_used
      FROM usage_records ur
      ${baseWhere}
      GROUP BY ur.model
      ORDER BY total_tokens DESC
    `).all(...baseParams);

    const requestsByDay = db.prepare(`
      SELECT
        substr(ur.request_time, 1, 10) as day,
        COUNT(*) as count
      FROM usage_records ur
      ${baseWhere}${baseWhere ? ' AND' : ' WHERE'} ur.request_time IS NOT NULL
      GROUP BY substr(ur.request_time, 1, 10)
      ORDER BY day
    `).all(...baseParams);

    const requestsByHour = db.prepare(`
      SELECT
        substr(ur.request_time, 12, 2) as hour,
        COUNT(*) as count
      FROM usage_records ur
      ${baseWhere}${baseWhere ? ' AND' : ' WHERE'} ur.request_time IS NOT NULL
        AND substr(ur.request_time, 1, 10) = date('now', 'localtime')
      GROUP BY substr(ur.request_time, 12, 2)
      ORDER BY hour
    `).all(...baseParams);

    const tokensByDay = db.prepare(`
      SELECT
        substr(ur.request_time, 1, 10) as day,
        SUM(ur.total_tokens) as tokens
      FROM usage_records ur
      ${baseWhere}${baseWhere ? ' AND' : ' WHERE'} ur.request_time IS NOT NULL
      GROUP BY substr(ur.request_time, 1, 10)
      ORDER BY day
    `).all(...baseParams);

    const tokensByHour = db.prepare(`
      SELECT
        substr(ur.request_time, 12, 2) as hour,
        SUM(ur.total_tokens) as tokens
      FROM usage_records ur
      ${baseWhere}${baseWhere ? ' AND' : ' WHERE'} ur.request_time IS NOT NULL
        AND substr(ur.request_time, 1, 10) = date('now', 'localtime')
      GROUP BY substr(ur.request_time, 12, 2)
      ORDER BY hour
    `).all(...baseParams);

    const byApi = db.prepare(`
      SELECT
        ur.api_path,
        ur.model,
        COUNT(*) as requests,
        SUM(CASE WHEN ur.success = 1 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN ur.success = 0 THEN 1 ELSE 0 END) as failure_count,
        SUM(ur.total_tokens) as total_tokens,
        SUM(ur.input_tokens) as input_tokens,
        SUM(ur.output_tokens) as output_tokens,
        SUM(ur.cached_tokens) as cached_tokens,
        SUM(ur.reasoning_tokens) as reasoning_tokens
      FROM usage_records ur
      ${baseWhere}
      GROUP BY ur.api_path, ur.model
      ORDER BY requests DESC
    `).all(...baseParams);

    const apis = {};
    byApi.forEach((row) => {
      if (!apis[row.api_path]) {
        apis[row.api_path] = {
          total_requests: 0,
          success_count: 0,
          failure_count: 0,
          total_tokens: 0,
          input_tokens: 0,
          output_tokens: 0,
          cached_tokens: 0,
          reasoning_tokens: 0,
          models: {},
        };
      }

      const detailRows = db.prepare(`
        SELECT
          ur.id,
          ur.request_time as timestamp,
          ur.auth_index,
          ur.source,
          ur.input_tokens,
          ur.output_tokens,
          ur.total_tokens,
          ur.cached_tokens,
          ur.reasoning_tokens,
          ur.success,
          ur.instance_id,
          ci.name as instance_name
        FROM usage_records ur
        LEFT JOIN cpa_instances ci ON ci.id = ur.instance_id
        WHERE ur.api_path = ? AND ur.model = ?${instanceId !== undefined && instanceId !== null && instanceId !== '' ? ' AND ur.instance_id = ?' : ''}
        ORDER BY ur.request_time DESC
        LIMIT 5000
      `).all(
        row.api_path,
        row.model,
        ...(instanceId !== undefined && instanceId !== null && instanceId !== '' ? [Number(instanceId)] : [])
      );

      const details = detailRows.map((detail) => ({
        timestamp: detail.timestamp,
        auth_index: detail.auth_index,
        source: detail.source,
        instance_id: detail.instance_id,
        instance_name: detail.instance_name || '',
        tokens: {
          input_tokens: detail.input_tokens,
          output_tokens: detail.output_tokens,
          total_tokens: detail.total_tokens,
          cached_tokens: detail.cached_tokens || 0,
          reasoning_tokens: detail.reasoning_tokens || 0,
        },
        failed: detail.success === 0,
      }));

      apis[row.api_path].models[row.model] = {
        requests: row.requests,
        total_requests: row.requests,
        success_count: row.success_count,
        failure_count: row.failure_count,
        total_tokens: row.total_tokens,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cached_tokens: row.cached_tokens,
        reasoning_tokens: row.reasoning_tokens,
        details,
      };

      apis[row.api_path].total_requests += row.requests || 0;
      apis[row.api_path].success_count += row.success_count || 0;
      apis[row.api_path].failure_count += row.failure_count || 0;
      apis[row.api_path].total_tokens += row.total_tokens || 0;
      apis[row.api_path].input_tokens += row.input_tokens || 0;
      apis[row.api_path].output_tokens += row.output_tokens || 0;
      apis[row.api_path].cached_tokens += row.cached_tokens || 0;
      apis[row.api_path].reasoning_tokens += row.reasoning_tokens || 0;
    });

    return {
      total_requests: overview.total_requests || 0,
      success_count: overview.success_count || 0,
      failure_count: overview.failure_count || 0,
      total_tokens: overview.total_tokens || 0,
      total_input_tokens: overview.total_input_tokens || 0,
      total_output_tokens: overview.total_output_tokens || 0,
      total_cached_tokens: overview.total_cached_tokens || 0,
      total_reasoning_tokens: overview.total_reasoning_tokens || 0,
      apis,
      models_summary: byModel.map((row) => ({
        model: row.model,
        requests: row.requests || 0,
        total_requests: row.requests || 0,
        success_count: row.success_count || 0,
        failure_count: row.failure_count || 0,
        total_tokens: row.total_tokens || 0,
        input_tokens: row.input_tokens || 0,
        output_tokens: row.output_tokens || 0,
        cached_tokens: row.cached_tokens || 0,
        reasoning_tokens: row.reasoning_tokens || 0,
        last_used: row.last_used || null,
      })),
      requests_by_day: Object.fromEntries(requestsByDay.map((row) => [row.day, row.count])),
      requests_by_hour: Object.fromEntries(requestsByHour.map((row) => [row.hour, row.count])),
      tokens_by_day: Object.fromEntries(tokensByDay.map((row) => [row.day, row.tokens])),
      tokens_by_hour: Object.fromEntries(tokensByHour.map((row) => [row.hour, row.tokens])),
    };
  }

  return {
    db,
    stmts,
    insertUsageBatch,
    buildScopedCacheKey,

    getUsageStats,

    getUsageViewMeta(instanceId = null) {
      const row = instanceId === null || instanceId === undefined
        ? stmts.getUsageViewMetaAll.get()
        : stmts.getUsageViewMetaByInstance.get(Number(instanceId));

      return {
        lastSyncAt: row?.last_sync_at || null,
        lastExportAt: row?.last_export_at || null,
      };
    },

    getSyncState() {
      return stmts.getSyncState.get();
    },

    updateSyncState(lastSync, lastExportAt) {
      stmts.updateSyncState.run(lastSync, lastExportAt);
    },

    getKeyProviderCache(instanceId = null) {
      const rows = stmts.getKeyProviderCacheRows.all();
      const prefix = instanceId === null || instanceId === undefined
        ? ''
        : `instance:${instanceId}:`;

      return Object.fromEntries(
        rows
          .filter((row) => (prefix ? row.cache_key.startsWith(prefix) : row.cache_key.startsWith('instance:')))
          .map((row) => [
            row.cache_key,
            {
              provider: row.provider,
              channel: row.channel,
              email: row.email,
              source: row.source,
            },
          ])
      );
    },

    upsertKeyProvider(cacheKey, data) {
      stmts.upsertKeyProvider.run(cacheKey, data.provider, data.channel, data.email, data.source);
    },

    getModelPricing() {
      const rows = stmts.getModelPricing.all();
      return Object.fromEntries(rows.map((row) => [row.model, {
        promptPrice: row.input_price,
        completionPrice: row.output_price,
        cachePrice: row.cache_price === null || row.cache_price === undefined
          ? row.input_price
          : row.cache_price,
        updatedAt: row.updated_at,
      }]));
    },

    upsertModelPricing(model, inputPrice, outputPrice, cachePrice = inputPrice) {
      stmts.upsertModelPricing.run(model, inputPrice, outputPrice, cachePrice);
    },

    replaceModelPricing(pricingMap) {
      replaceModelPricingTx(pricingMap);
    },

    deleteModelPricing(model) {
      stmts.deleteModelPricing.run(model);
    },

    countAuthUsers() {
      return stmts.countAuthUsers.get().count || 0;
    },

    hasAuthUsers() {
      return this.countAuthUsers() > 0;
    },

    getAuthUserById(id) {
      return stmts.getAuthUserById.get(id) || null;
    },

    getAuthUserByUsername(username) {
      return stmts.getAuthUserByUsername.get(username) || null;
    },

    getSingleAuthUser() {
      return stmts.getSingleAuthUser.get() || null;
    },

    createAuthUser({ username, passwordHash, now }) {
      const timestamp = now || new Date().toISOString();
      const result = stmts.insertAuthUser.run(username, passwordHash, timestamp, timestamp, timestamp);
      return this.getAuthUserById(result.lastInsertRowid);
    },

    updateAuthUserPassword(userId, passwordHash, now) {
      const timestamp = now || new Date().toISOString();
      stmts.updateAuthUserPassword.run(passwordHash, timestamp, timestamp, userId);
      return this.getAuthUserById(userId);
    },

    createAuthSession({ userId, sessionTokenHash, expiresAt, lastSeenAt, createdAt, userAgent, ipAddress }) {
      const now = createdAt || new Date().toISOString();
      const seenAt = lastSeenAt || now;
      const result = stmts.insertAuthSession.run(
        userId,
        sessionTokenHash,
        expiresAt,
        seenAt,
        now,
        userAgent || '',
        ipAddress || ''
      );
      return this.getAuthSessionById(result.lastInsertRowid);
    },

    getAuthSessionById(id) {
      return stmts.getAuthSessionById.get(id) || null;
    },

    getAuthSessionByTokenHash(tokenHash) {
      return stmts.getAuthSessionByTokenHash.get(tokenHash) || null;
    },

    touchAuthSession(sessionId, expiresAt, lastSeenAt) {
      stmts.touchAuthSession.run(expiresAt, lastSeenAt, sessionId);
      return this.getAuthSessionById(sessionId);
    },

    revokeAuthSession(sessionId, now) {
      stmts.revokeAuthSession.run(now || new Date().toISOString(), sessionId);
    },

    revokeAuthSessionsByUserId(userId, now) {
      stmts.revokeAuthSessionsByUserId.run(now || new Date().toISOString(), userId);
    },

    countCpaInstances() {
      return stmts.countCpaInstances.get().count || 0;
    },

    getCpaInstanceById(id) {
      return mapInstanceRow(stmts.getCpaInstanceById.get(Number(id)));
    },

    getCpaInstances() {
      return stmts.listCpaInstances.all().map(mapInstanceRow);
    },

    getEnabledCpaInstances() {
      return stmts.listEnabledCpaInstances.all().map(mapInstanceRow);
    },

    getActiveCpaInstance(options = {}) {
      const row = options.includeDisabled
        ? stmts.getActiveCpaInstance.get()
        : stmts.getActiveEnabledCpaInstance.get();
      return mapInstanceRow(row);
    },

    createCpaInstance(input) {
      return mapInstanceRow(createCpaInstanceTx(input));
    },

    updateCpaInstance(instanceId, updates) {
      const currentRow = stmts.getCpaInstanceById.get(Number(instanceId));
      if (!currentRow) {
        return null;
      }

      const now = updates.now || new Date().toISOString();
      const isEnabled = updates.isEnabled === undefined ? currentRow.is_enabled === 1 : Boolean(updates.isEnabled);
      const nextStatus = isEnabled
        ? (updates.status || (currentRow.status === DISABLED_INSTANCE_STATUS ? DEFAULT_INSTANCE_STATUS : currentRow.status))
        : DISABLED_INSTANCE_STATUS;
      const nextStatusMessage = isEnabled
        ? (updates.statusMessage !== undefined ? updates.statusMessage : currentRow.status_message)
        : (updates.statusMessage || 'Instance disabled');

      stmts.updateCpaInstance.run(
        updates.name !== undefined ? updates.name : currentRow.name,
        updates.baseUrl !== undefined ? updates.baseUrl : currentRow.base_url,
        updates.apiKey !== undefined ? updates.apiKey : currentRow.api_key,
        updates.syncInterval !== undefined ? updates.syncInterval : currentRow.sync_interval_minutes,
        currentRow.is_active,
        toBooleanFlag(isEnabled),
        nextStatus,
        nextStatusMessage,
        updates.lastCheckedAt !== undefined ? updates.lastCheckedAt : currentRow.last_checked_at,
        updates.lastSyncAt !== undefined ? updates.lastSyncAt : currentRow.last_sync_at,
        updates.lastExportAt !== undefined ? updates.lastExportAt : currentRow.last_export_at,
        now,
        Number(instanceId)
      );

      const updated = this.getCpaInstanceById(instanceId);
      if (currentRow.is_active === 1 && !updated.isEnabled) {
        this.ensureActiveCpaInstance();
      }

      return this.getCpaInstanceById(instanceId);
    },

    activateCpaInstance(instanceId) {
      return mapInstanceRow(activateCpaInstanceTx(Number(instanceId), new Date().toISOString()));
    },

    ensureActiveCpaInstance() {
      return mapInstanceRow(ensureActiveCpaInstanceTx());
    },

    updateCpaInstanceStatus(instanceId, status, statusMessage, lastCheckedAt) {
      const now = new Date().toISOString();
      stmts.updateCpaInstanceStatusOnly.run(
        status,
        statusMessage || '',
        lastCheckedAt || now,
        now,
        Number(instanceId)
      );
      return this.getCpaInstanceById(instanceId);
    },

    markCpaInstanceSynced(instanceId, meta = {}) {
      const current = stmts.getCpaInstanceById.get(Number(instanceId));
      if (!current) {
        return null;
      }

      const now = meta.now || new Date().toISOString();
      stmts.updateCpaInstanceSyncMeta.run(
        meta.status || current.status,
        meta.statusMessage !== undefined ? meta.statusMessage : current.status_message,
        meta.lastCheckedAt || now,
        meta.lastSyncAt || current.last_sync_at,
        meta.lastExportAt !== undefined ? meta.lastExportAt : current.last_export_at,
        now,
        Number(instanceId)
      );

      return this.getCpaInstanceById(instanceId);
    },

    assignLegacyDataToInstance(instanceId) {
      assignLegacyDataTx(Number(instanceId));
    },

    close() {
      db.close();
    },
  };
}

module.exports = {
  createUsageDb,
  buildScopedCacheKey,
  DEFAULT_INSTANCE_STATUS,
  DISABLED_INSTANCE_STATUS,
};
