const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function ensureDataDir(dataDir) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
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
      created_at TEXT DEFAULT (datetime('now'))
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
  `);

  try {
    db.exec('ALTER TABLE usage_records ADD COLUMN cached_tokens INTEGER DEFAULT 0');
  } catch (e) {
    // ignore existing column
  }

  try {
    db.exec('ALTER TABLE usage_records ADD COLUMN reasoning_tokens INTEGER DEFAULT 0');
  } catch (e) {
    // ignore existing column
  }

  const stmts = {
    insertUsage: db.prepare(`
      INSERT OR IGNORE INTO usage_records 
      (request_id, api_path, model, source, auth_index, input_tokens, output_tokens, total_tokens, cached_tokens, reasoning_tokens, success, request_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),

    getOverview: db.prepare(`
      SELECT 
        COUNT(*) as total_requests,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count,
        SUM(total_tokens) as total_tokens,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cached_tokens) as total_cached_tokens,
        SUM(reasoning_tokens) as total_reasoning_tokens
      FROM usage_records
    `),

    getByModel: db.prepare(`
      SELECT 
        model,
        COUNT(*) as requests,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count,
        SUM(total_tokens) as total_tokens,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(cached_tokens) as cached_tokens,
        SUM(reasoning_tokens) as reasoning_tokens,
        MAX(request_time) as last_used
      FROM usage_records
      GROUP BY model
      ORDER BY total_tokens DESC
    `),

    getRequestsByDay: db.prepare(`
      SELECT 
        substr(request_time, 1, 10) as day,
        COUNT(*) as count
      FROM usage_records
      WHERE request_time IS NOT NULL
      GROUP BY substr(request_time, 1, 10)
      ORDER BY day
    `),

    getRequestsByHour: db.prepare(`
      SELECT 
        substr(request_time, 12, 2) as hour,
        COUNT(*) as count
      FROM usage_records
      WHERE request_time IS NOT NULL
        AND substr(request_time, 1, 10) = date('now', 'localtime')
      GROUP BY substr(request_time, 12, 2)
      ORDER BY hour
    `),

    getTokensByDay: db.prepare(`
      SELECT 
        substr(request_time, 1, 10) as day,
        SUM(total_tokens) as tokens
      FROM usage_records
      WHERE request_time IS NOT NULL
      GROUP BY substr(request_time, 1, 10)
      ORDER BY day
    `),

    getTokensByHour: db.prepare(`
      SELECT 
        substr(request_time, 12, 2) as hour,
        SUM(total_tokens) as tokens
      FROM usage_records
      WHERE request_time IS NOT NULL
        AND substr(request_time, 1, 10) = date('now', 'localtime')
      GROUP BY substr(request_time, 12, 2)
      ORDER BY hour
    `),

    getByApi: db.prepare(`
      SELECT 
        api_path,
        model,
        COUNT(*) as requests,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count,
        SUM(total_tokens) as total_tokens,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(cached_tokens) as cached_tokens,
        SUM(reasoning_tokens) as reasoning_tokens
      FROM usage_records
      GROUP BY api_path, model
      ORDER BY requests DESC
    `),

    getModelDetails: db.prepare(`
      SELECT 
        id,
        request_time as timestamp,
        auth_index,
        source,
        input_tokens,
        output_tokens,
        total_tokens,
        cached_tokens,
        reasoning_tokens,
        success
      FROM usage_records
      WHERE api_path = ? AND model = ?
      ORDER BY request_time DESC
      LIMIT 5000
    `),

    getSyncState: db.prepare('SELECT * FROM sync_state WHERE id = 1'),
    updateSyncState: db.prepare('UPDATE sync_state SET last_sync = ?, last_export_at = ? WHERE id = 1'),

    getKeyProviderCache: db.prepare('SELECT * FROM key_provider_cache'),
    upsertKeyProvider: db.prepare(`
      INSERT OR REPLACE INTO key_provider_cache (cache_key, provider, channel, email, source, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `),

    getModelPricing: db.prepare('SELECT * FROM model_pricing'),
    upsertModelPricing: db.prepare(`
      INSERT OR REPLACE INTO model_pricing (model, input_price, output_price, updated_at)
      VALUES (?, ?, ?, datetime('now'))
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
  };

  const insertUsageBatch = db.transaction((records) => {
    let inserted = 0;
    for (const r of records) {
      const result = stmts.insertUsage.run(
        r.request_id,
        r.api_path,
        r.model,
        r.source,
        r.auth_index,
        r.input_tokens || 0,
        r.output_tokens || 0,
        r.total_tokens || 0,
        r.cached_tokens || 0,
        r.reasoning_tokens || 0,
        r.success ? 1 : 0,
        r.request_time
      );
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });

  return {
    db,
    stmts,
    insertUsageBatch,

    getUsageStats() {
      const overview = stmts.getOverview.get();
      const byModel = stmts.getByModel.all();
      const requestsByDay = stmts.getRequestsByDay.all();
      const requestsByHour = stmts.getRequestsByHour.all();
      const tokensByDay = stmts.getTokensByDay.all();
      const tokensByHour = stmts.getTokensByHour.all();
      const byApi = stmts.getByApi.all();

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

        const rawDetails = stmts.getModelDetails.all(row.api_path, row.model);
        const details = rawDetails.map((detail) => ({
          timestamp: detail.timestamp,
          auth_index: detail.auth_index,
          source: detail.source,
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
    },

    getSyncState() {
      return stmts.getSyncState.get();
    },

    updateSyncState(lastSync, lastExportAt) {
      stmts.updateSyncState.run(lastSync, lastExportAt);
    },

    getKeyProviderCache() {
      const rows = stmts.getKeyProviderCache.all();
      return Object.fromEntries(rows.map((row) => [row.cache_key, {
        provider: row.provider,
        channel: row.channel,
        email: row.email,
        source: row.source,
      }]));
    },

    upsertKeyProvider(cacheKey, data) {
      stmts.upsertKeyProvider.run(cacheKey, data.provider, data.channel, data.email, data.source);
    },

    getModelPricing() {
      const rows = stmts.getModelPricing.all();
      return Object.fromEntries(rows.map((row) => [row.model, {
        inputPrice: row.input_price,
        outputPrice: row.output_price,
        updatedAt: row.updated_at,
      }]));
    },

    upsertModelPricing(model, inputPrice, outputPrice) {
      stmts.upsertModelPricing.run(model, inputPrice, outputPrice);
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

    close() {
      db.close();
    },
  };
}

module.exports = {
  createUsageDb,
};
