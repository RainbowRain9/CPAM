const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'usage.db');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_FILE);

// 启用 WAL 模式提升性能
db.pragma('journal_mode = WAL');

// 初始化表结构
db.exec(`
  -- 使用记录表：存储每一条请求的详细信息
  CREATE TABLE IF NOT EXISTS usage_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT UNIQUE,           -- 请求唯一标识（用于去重）
    api_path TEXT NOT NULL,           -- API 路径 (如 /v1/chat/completions)
    model TEXT NOT NULL,              -- 模型名称
    source TEXT,                      -- 来源 (API Key 或账号标识)
    auth_index TEXT,                  -- 认证索引
    input_tokens INTEGER DEFAULT 0,   -- 输入 token 数
    output_tokens INTEGER DEFAULT 0,  -- 输出 token 数
    total_tokens INTEGER DEFAULT 0,   -- 总 token 数
    success INTEGER DEFAULT 1,        -- 是否成功 (1=成功, 0=失败)
    request_time TEXT,                -- 请求时间 (ISO 格式)
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- 索引优化查询性能
  CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_records(model);
  CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_records(request_time);
  CREATE INDEX IF NOT EXISTS idx_usage_api ON usage_records(api_path);
  CREATE INDEX IF NOT EXISTS idx_usage_auth ON usage_records(auth_index);
  CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_records(date(request_time));

  -- 同步状态表：记录最后同步时间
  CREATE TABLE IF NOT EXISTS sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_sync TEXT,
    last_export_at TEXT
  );

  -- 初始化同步状态
  INSERT OR IGNORE INTO sync_state (id) VALUES (1);

  -- Key-Provider 缓存表
  CREATE TABLE IF NOT EXISTS key_provider_cache (
    cache_key TEXT PRIMARY KEY,
    provider TEXT,
    channel TEXT,
    email TEXT,
    source TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- 模型定价表
  CREATE TABLE IF NOT EXISTS model_pricing (
    model TEXT PRIMARY KEY,
    input_price REAL DEFAULT 0,
    output_price REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// 迁移：添加 cached_tokens 列（已有数据库兼容）
try {
  db.exec('ALTER TABLE usage_records ADD COLUMN cached_tokens INTEGER DEFAULT 0');
} catch (e) {
  // 列已存在，忽略
}
try {
  db.exec('ALTER TABLE usage_records ADD COLUMN reasoning_tokens INTEGER DEFAULT 0');
} catch (e) {
  // 列已存在，忽略
}

// 准备常用语句
const stmts = {
  // 插入使用记录（忽略重复）
  insertUsage: db.prepare(`
    INSERT OR IGNORE INTO usage_records 
    (request_id, api_path, model, source, auth_index, input_tokens, output_tokens, total_tokens, cached_tokens, reasoning_tokens, success, request_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  // 获取统计概览
  getOverview: db.prepare(`
    SELECT 
      COUNT(*) as total_requests,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count,
      SUM(total_tokens) as total_tokens,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens
    FROM usage_records
  `),

  // 按模型统计
  getByModel: db.prepare(`
    SELECT 
      model,
      COUNT(*) as requests,
      SUM(total_tokens) as total_tokens,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      MAX(request_time) as last_used
    FROM usage_records
    GROUP BY model
    ORDER BY total_tokens DESC
  `),

  // 按天统计请求数（从request_time中提取日期）
  getRequestsByDay: db.prepare(`
    SELECT 
      substr(request_time, 1, 10) as day,
      COUNT(*) as count
    FROM usage_records
    WHERE request_time IS NOT NULL
    GROUP BY substr(request_time, 1, 10)
    ORDER BY day
  `),

  // 按小时统计请求数（今天的24小时）
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

  // 按天统计 token
  getTokensByDay: db.prepare(`
    SELECT 
      substr(request_time, 1, 10) as day,
      SUM(total_tokens) as tokens
    FROM usage_records
    WHERE request_time IS NOT NULL
    GROUP BY substr(request_time, 1, 10)
    ORDER BY day
  `),

  // 按小时统计 token（今天的24小时）
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

  // 按 API 路径统计
  getByApi: db.prepare(`
    SELECT 
      api_path,
      model,
      COUNT(*) as requests,
      SUM(total_tokens) as total_tokens,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens
    FROM usage_records
    GROUP BY api_path, model
    ORDER BY requests DESC
  `),

  // 获取模型详情（原始记录，兼容前端格式）
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
    LIMIT 1000
  `),

  // 同步状态
  getSyncState: db.prepare('SELECT * FROM sync_state WHERE id = 1'),
  updateSyncState: db.prepare('UPDATE sync_state SET last_sync = ?, last_export_at = ? WHERE id = 1'),

  // Key-Provider 缓存
  getKeyProviderCache: db.prepare('SELECT * FROM key_provider_cache'),
  upsertKeyProvider: db.prepare(`
    INSERT OR REPLACE INTO key_provider_cache (cache_key, provider, channel, email, source, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `),

  // 模型定价
  getModelPricing: db.prepare('SELECT * FROM model_pricing'),
  upsertModelPricing: db.prepare(`
    INSERT OR REPLACE INTO model_pricing (model, input_price, output_price, updated_at)
    VALUES (?, ?, ?, datetime('now'))
  `),
  deleteModelPricing: db.prepare('DELETE FROM model_pricing WHERE model = ?'),
};

// 批量插入使用记录（事务）
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

// 导出函数
module.exports = {
  db,
  stmts,
  insertUsageBatch,
  
  // 获取完整的使用统计（兼容旧格式）
  getUsageStats() {
    const overview = stmts.getOverview.get();
    const byModel = stmts.getByModel.all();
    const requestsByDay = stmts.getRequestsByDay.all();
    const requestsByHour = stmts.getRequestsByHour.all();
    const tokensByDay = stmts.getTokensByDay.all();
    const tokensByHour = stmts.getTokensByHour.all();
    const byApi = stmts.getByApi.all();

    // 构建兼容旧格式的数据结构
    const apis = {};
    byApi.forEach(row => {
      if (!apis[row.api_path]) {
        apis[row.api_path] = { models: {} };
      }
      // 获取原始记录并转换为前端期望的格式
      const rawDetails = stmts.getModelDetails.all(row.api_path, row.model);
      const details = rawDetails.map(d => ({
        timestamp: d.timestamp,
        auth_index: d.auth_index,
        source: d.source,
        tokens: {
          input_tokens: d.input_tokens,
          output_tokens: d.output_tokens,
          total_tokens: d.total_tokens,
          cached_tokens: d.cached_tokens || 0,
          reasoning_tokens: d.reasoning_tokens || 0
        },
        failed: d.success === 0
      }));
      
      apis[row.api_path].models[row.model] = {
        requests: row.requests,
        total_tokens: row.total_tokens,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        details: details
      };
    });

    return {
      total_requests: overview.total_requests || 0,
      success_count: overview.success_count || 0,
      failure_count: overview.failure_count || 0,
      total_tokens: overview.total_tokens || 0,
      apis,
      requests_by_day: Object.fromEntries(requestsByDay.map(r => [r.day, r.count])),
      requests_by_hour: Object.fromEntries(requestsByHour.map(r => [r.hour, r.count])),
      tokens_by_day: Object.fromEntries(tokensByDay.map(r => [r.day, r.tokens])),
      tokens_by_hour: Object.fromEntries(tokensByHour.map(r => [r.hour, r.tokens])),
    };
  },

  // 获取同步状态
  getSyncState() {
    return stmts.getSyncState.get();
  },

  // 更新同步状态
  updateSyncState(lastSync, lastExportAt) {
    stmts.updateSyncState.run(lastSync, lastExportAt);
  },

  // Key-Provider 缓存操作
  getKeyProviderCache() {
    const rows = stmts.getKeyProviderCache.all();
    return Object.fromEntries(rows.map(r => [r.cache_key, {
      provider: r.provider,
      channel: r.channel,
      email: r.email,
      source: r.source
    }]));
  },

  upsertKeyProvider(cacheKey, data) {
    stmts.upsertKeyProvider.run(cacheKey, data.provider, data.channel, data.email, data.source);
  },

  // 模型定价操作
  getModelPricing() {
    const rows = stmts.getModelPricing.all();
    return Object.fromEntries(rows.map(r => [r.model, {
      inputPrice: r.input_price,
      outputPrice: r.output_price,
      updatedAt: r.updated_at
    }]));
  },

  upsertModelPricing(model, inputPrice, outputPrice) {
    stmts.upsertModelPricing.run(model, inputPrice, outputPrice);
  },

  deleteModelPricing(model) {
    stmts.deleteModelPricing.run(model);
  },

  // 关闭数据库
  close() {
    db.close();
  }
};
