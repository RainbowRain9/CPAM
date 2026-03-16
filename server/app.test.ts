// @vitest-environment node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const SqliteDatabase = require('better-sqlite3')
const { createServerApp } = require('./app')
const { createUsageDb } = require('./db')

const tempDirs: string[] = []
const servers: Array<{ close: (callback: () => void) => void }> = []
const databases: Array<{ close: () => void }> = []

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  while (databases.length > 0) {
    const db = databases.pop()
    db?.close()
  }

  while (tempDirs.length > 0) {
    const dirPath = tempDirs.pop()
    if (dirPath && fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true })
    }
  }
})

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createCliProxyFetchMock() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url)
    const host = parsed.host
    const pathname = parsed.pathname
    const authorization = String((init?.headers as Record<string, string> | undefined)?.Authorization || '')

    if (pathname.endsWith('/v0/management/config')) {
      if (host === 'unreachable:8317') {
        throw new Error('network down')
      }

      if (authorization.includes('bad-key')) {
        return jsonResponse({ error: 'forbidden' }, 401)
      }

      return jsonResponse({ ok: true })
    }

    if (pathname.endsWith('/v0/management/openai-compatibility')) {
      return jsonResponse({ 'openai-compatibility': [] })
    }

    if (pathname.endsWith('/v0/management/auth-files')) {
      if (host === 'instance-a:8317') {
        return jsonResponse({
          files: [{
            type: 'codex',
            auth_index: 'a-1',
            email: 'a@example.com',
          }],
        })
      }

      if (host === 'instance-b:8317') {
        return jsonResponse({
          files: [{
            type: 'codex',
            auth_index: 'b-1',
            email: 'b@example.com',
          }],
        })
      }

      return jsonResponse({ files: [] })
    }

    if (pathname.endsWith('/v0/management/usage/export')) {
      if (host === 'instance-a:8317') {
        return jsonResponse({
          exported_at: '2026-03-14T00:00:00.000Z',
          usage: {
            apis: {
              '/v1/chat/completions': {
                models: {
                  'gpt-a': {
                    details: [{
                      timestamp: '2026-03-14T00:00:00.000Z',
                      source: 'source-a',
                      auth_index: 'a-1',
                      tokens: {
                        input_tokens: 10,
                        output_tokens: 5,
                        total_tokens: 15,
                      },
                    }],
                  },
                },
              },
            },
          },
        })
      }

      return jsonResponse({
        exported_at: '2026-03-14T00:10:00.000Z',
        usage: {
          apis: {
            '/v1/chat/completions': {
              models: {
                'gpt-b': {
                  details: [{
                    timestamp: '2026-03-14T00:10:00.000Z',
                    source: 'source-b',
                    auth_index: 'b-1',
                    tokens: {
                      input_tokens: 20,
                      output_tokens: 10,
                      total_tokens: 30,
                    },
                  }],
                },
              },
            },
          },
        },
      })
    }

    return jsonResponse({ error: 'not found' }, 404)
  })
}

async function startApp(fetchImpl: typeof fetch, existingDataDir?: string) {
  const dataDir = existingDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'cpam-app-'))
  if (!existingDataDir) {
    tempDirs.push(dataDir)
  }

  const { app, usageDb } = createServerApp({
    dataDir,
    fetchImpl,
    devMode: false,
    distDir: path.join(process.cwd(), 'dist'),
  })

  databases.push(usageDb)

  const server = await new Promise<any>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer))
  })
  servers.push(server)

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve test server address')
  }

  return {
    usageDb,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }
}

function getCookieHeader(response: Response) {
  const headers = response.headers as Response['headers'] & { getSetCookie?: () => string[] }
  const cookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean) as string[]
  return cookies[0]?.split(';')[0] || ''
}

async function bootstrapCookie(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/auth/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: 'bootstrap-pass-123',
      confirmPassword: 'bootstrap-pass-123',
    }),
  })

  return getCookieHeader(response)
}

async function apiRequest(baseUrl: string, cookie: string, pathname: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Cookie: cookie,
      ...(init.headers || {}),
    },
  })
}

describe('server app multi-instance routes', () => {
  it('creates instances, activates a new one, and falls back when the active instance is disabled', async () => {
    const fetchImpl = createCliProxyFetchMock()
    const { baseUrl } = await startApp(fetchImpl as unknown as typeof fetch)
    const cookie = await bootstrapCookie(baseUrl)

    const createFirst = await apiRequest(baseUrl, cookie, '/api/cpa-instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'A',
        baseUrl: 'http://instance-a:8317',
        apiKey: 'good-a',
        syncInterval: 5,
        isEnabled: true,
      }),
    })
    expect(createFirst.status).toBe(201)

    const createSecond = await apiRequest(baseUrl, cookie, '/api/cpa-instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'B',
        baseUrl: 'http://good-b:8317',
        apiKey: 'good-b',
        syncInterval: 10,
        isEnabled: true,
      }),
    })
    expect(createSecond.status).toBe(201)

    let instancesResponse = await apiRequest(baseUrl, cookie, '/api/cpa-instances')
    let instancesPayload = await instancesResponse.json()
    expect(instancesPayload.instances[0]).toMatchObject({ name: 'A', isActive: true })

    const instanceB = instancesPayload.instances.find((instance: { name: string }) => instance.name === 'B')
    const activate = await apiRequest(baseUrl, cookie, `/api/cpa-instances/${instanceB.id}/activate`, {
      method: 'POST',
    })
    expect(activate.status).toBe(200)

    const disable = await apiRequest(baseUrl, cookie, `/api/cpa-instances/${instanceB.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled: false }),
    })
    expect(disable.status).toBe(200)

    instancesResponse = await apiRequest(baseUrl, cookie, '/api/cpa-instances')
    instancesPayload = await instancesResponse.json()

    const refreshedA = instancesPayload.instances.find((instance: { name: string }) => instance.name === 'A')
    const refreshedB = instancesPayload.instances.find((instance: { name: string }) => instance.name === 'B')

    expect(refreshedA).toMatchObject({ isActive: true, isEnabled: true })
    expect(refreshedB).toMatchObject({ isActive: false, isEnabled: false, status: 'disabled' })
  })

  it('returns per-instance usage by default and aggregate usage when scope=all', async () => {
    const fetchImpl = createCliProxyFetchMock()
    const { baseUrl } = await startApp(fetchImpl as unknown as typeof fetch)
    const cookie = await bootstrapCookie(baseUrl)

    for (const payload of [
      { name: 'A', baseUrl: 'http://instance-a:8317', apiKey: 'good-a' },
      { name: 'B', baseUrl: 'http://good-b:8317', apiKey: 'good-b' },
    ]) {
      const response = await apiRequest(baseUrl, cookie, '/api/cpa-instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          syncInterval: 5,
          isEnabled: true,
        }),
      })
      expect(response.status).toBe(201)
    }

    const syncAll = await apiRequest(baseUrl, cookie, '/api/usage/export-now?scope=all', {
      method: 'POST',
    })
    expect(syncAll.status).toBe(200)

    const listResponse = await apiRequest(baseUrl, cookie, '/api/cpa-instances')
    const listPayload = await listResponse.json()
    const active = listPayload.instances.find((instance: { isActive: boolean }) => instance.isActive)

    const activeUsageResponse = await apiRequest(baseUrl, cookie, '/api/usage')
    const activeUsagePayload = await activeUsageResponse.json()
    expect(activeUsagePayload.scope).toBe('instance')
    expect(activeUsagePayload.instanceId).toBe(active.id)
    expect(activeUsagePayload.usage.total_requests).toBe(1)

    const aggregateUsageResponse = await apiRequest(baseUrl, cookie, '/api/usage?scope=all')
    const aggregateUsagePayload = await aggregateUsageResponse.json()
    expect(aggregateUsagePayload.scope).toBe('all')
    expect(aggregateUsagePayload.usage.total_requests).toBe(2)
    expect(aggregateUsagePayload.usage.total_tokens).toBe(45)
  })

  it('updates instance status on failed checks and binds CodeX routes to the active instance', async () => {
    const fetchImpl = createCliProxyFetchMock()
    const { baseUrl, usageDb } = await startApp(fetchImpl as unknown as typeof fetch)
    const cookie = await bootstrapCookie(baseUrl)

    await apiRequest(baseUrl, cookie, '/api/cpa-instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'A',
        baseUrl: 'http://instance-a:8317',
        apiKey: 'good-a',
        syncInterval: 5,
        isEnabled: true,
      }),
    })

    await apiRequest(baseUrl, cookie, '/api/cpa-instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'B',
        baseUrl: 'http://good-b:8317',
        apiKey: 'good-b',
        syncInterval: 5,
        isEnabled: true,
      }),
    })

    const listResponse = await apiRequest(baseUrl, cookie, '/api/cpa-instances')
    const listPayload = await listResponse.json()
    const active = listPayload.instances.find((instance: { isActive: boolean }) => instance.isActive)
    const other = listPayload.instances.find((instance: { isActive: boolean }) => !instance.isActive)

    usageDb.updateCpaInstance(other.id, {
      apiKey: 'bad-key',
      status: 'healthy',
      statusMessage: '',
    })

    const authFailedCheck = await apiRequest(baseUrl, cookie, `/api/cpa-instances/${other.id}/check`, {
      method: 'POST',
    })
    expect(authFailedCheck.status).toBe(401)

    let refreshedOther = usageDb.getCpaInstanceById(other.id)
    expect(refreshedOther).toMatchObject({ status: 'auth_failed' })

    usageDb.updateCpaInstance(other.id, {
      baseUrl: 'http://unreachable:8317',
      apiKey: 'good-b',
      status: 'healthy',
      statusMessage: '',
    })

    const unreachableCheck = await apiRequest(baseUrl, cookie, `/api/cpa-instances/${other.id}/check`, {
      method: 'POST',
    })
    expect(unreachableCheck.status).toBe(502)

    refreshedOther = usageDb.getCpaInstanceById(other.id)
    expect(refreshedOther).toMatchObject({ status: 'unreachable' })

    const codexResponse = await apiRequest(baseUrl, cookie, '/api/codex/accounts')
    const codexPayload = await codexResponse.json()
    expect(codexResponse.status).toBe(200)
    expect(codexPayload).toEqual([expect.objectContaining({ email: 'a@example.com', authIndex: 'a-1' })])
  })

  it('upgrades a legacy usage database without instance_id during startup', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpam-app-legacy-schema-'))
    tempDirs.push(dataDir)

    const legacyDb = new SqliteDatabase(path.join(dataDir, 'usage.db'))
    legacyDb.exec(`
      CREATE TABLE usage_records (
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
    `)
    legacyDb.prepare(`
      INSERT INTO usage_records (
        request_id,
        api_path,
        model,
        source,
        auth_index,
        input_tokens,
        output_tokens,
        total_tokens,
        success,
        request_time
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-request',
      '/v1/chat/completions',
      'gpt-legacy',
      'legacy-source',
      'legacy-auth',
      10,
      5,
      15,
      1,
      '2026-03-14T00:00:00.000Z'
    )
    legacyDb.close()

    const usageDb = createUsageDb({ dataDir })
    databases.push(usageDb)

    expect(usageDb.getUsageStats().total_requests).toBe(1)
    expect(usageDb.getUsageStats({ instanceId: 1 }).total_requests).toBe(0)
  })

  it('imports legacy settings into the first instance and namespaces migrated history', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpam-app-legacy-'))
    tempDirs.push(dataDir)

    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
      cliProxyUrl: 'http://instance-a:8317',
      cliProxyKey: 'good-a',
      syncInterval: 5,
    }))

    const legacyDb = createUsageDb({ dataDir })
    databases.push(legacyDb)
    legacyDb.insertUsageBatch([{
      request_id: 'legacy-request',
      api_path: '/v1/chat/completions',
      model: 'gpt-a',
      source: 'legacy-source',
      auth_index: 'legacy-auth',
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      cached_tokens: 0,
      reasoning_tokens: 0,
      success: true,
      request_time: '2026-03-14T00:00:00.000Z',
    }])
    legacyDb.upsertKeyProvider('legacy-auth', {
      provider: 'CODEX',
      channel: 'codex',
      email: 'legacy@example.com',
      source: 'legacy-source',
    })
    legacyDb.close()
    databases.pop()

    const fetchImpl = createCliProxyFetchMock()
    const { usageDb } = await startApp(fetchImpl as unknown as typeof fetch, dataDir)

    const instances = usageDb.getCpaInstances()
    expect(instances).toHaveLength(1)
    expect(instances[0]).toMatchObject({
      baseUrl: 'http://instance-a:8317',
      isActive: true,
      isEnabled: true,
    })

    const scopedUsage = usageDb.getUsageStats({ instanceId: instances[0].id })
    expect(scopedUsage.total_requests).toBe(1)

    const scopedCache = usageDb.getKeyProviderCache(instances[0].id)
    expect(scopedCache[`instance:${instances[0].id}:auth:legacy-auth`]).toMatchObject({
      email: 'legacy@example.com',
    })
  })

  it('migrates legacy model pricing rows without cache_price and falls back cachePrice to promptPrice', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpam-app-legacy-pricing-'))
    tempDirs.push(dataDir)

    const legacyDb = new SqliteDatabase(path.join(dataDir, 'usage.db'))
    legacyDb.exec(`
      CREATE TABLE model_pricing (
        model TEXT PRIMARY KEY,
        input_price REAL DEFAULT 0,
        output_price REAL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `)
    legacyDb.prepare(`
      INSERT INTO model_pricing (model, input_price, output_price, updated_at)
      VALUES (?, ?, ?, ?)
    `).run('gpt-legacy', 1.5, 5, '2026-03-14T00:00:00.000Z')
    legacyDb.close()

    const usageDb = createUsageDb({ dataDir })
    databases.push(usageDb)

    const columns = usageDb.db.prepare('PRAGMA table_info(model_pricing)').all()
    expect(columns.some((column: { name: string }) => column.name === 'cache_price')).toBe(true)
    expect(usageDb.getModelPricing()).toEqual({
      'gpt-legacy': {
        promptPrice: 1.5,
        completionPrice: 5,
        cachePrice: 1.5,
        updatedAt: '2026-03-14T00:00:00.000Z',
      },
    })
  })

  it('stores complete pricing maps via PUT and returns them from pricing and usage routes', async () => {
    const fetchImpl = createCliProxyFetchMock()
    const { baseUrl } = await startApp(fetchImpl as unknown as typeof fetch)
    const cookie = await bootstrapCookie(baseUrl)

    const createInstanceResponse = await apiRequest(baseUrl, cookie, '/api/cpa-instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary',
        baseUrl: 'http://instance-a:8317',
        apiKey: 'good-a',
        syncInterval: 5,
        isEnabled: true,
      }),
    })
    expect(createInstanceResponse.status).toBe(201)

    const replaceResponse = await apiRequest(baseUrl, cookie, '/api/pricing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pricing: {
          'gpt-5.4': {
            promptPrice: 1.25,
            completionPrice: 10,
            cachePrice: 0.125,
          },
          'claude-sonnet-4-6': {
            promptPrice: 3,
            completionPrice: 15,
            cachePrice: 0.75,
          },
        },
      }),
    })
    expect(replaceResponse.status).toBe(200)

    const replacePayload = await replaceResponse.json()
    expect(replacePayload.pricing).toEqual({
      'gpt-5.4': {
        promptPrice: 1.25,
        completionPrice: 10,
        cachePrice: 0.125,
        updatedAt: expect.any(String),
      },
      'claude-sonnet-4-6': {
        promptPrice: 3,
        completionPrice: 15,
        cachePrice: 0.75,
        updatedAt: expect.any(String),
      },
    })

    const pricingResponse = await apiRequest(baseUrl, cookie, '/api/pricing')
    const pricingPayload = await pricingResponse.json()
    expect(pricingPayload).toEqual(replacePayload.pricing)

    const usageResponse = await apiRequest(baseUrl, cookie, '/api/usage')
    const usagePayload = await usageResponse.json()
    expect(usagePayload.modelPricing).toEqual(replacePayload.pricing)
  })

  it('clears pricing maps via PUT empty objects and preserves POST/DELETE compatibility', async () => {
    const fetchImpl = createCliProxyFetchMock()
    const { baseUrl } = await startApp(fetchImpl as unknown as typeof fetch)
    const cookie = await bootstrapCookie(baseUrl)

    const createInstanceResponse = await apiRequest(baseUrl, cookie, '/api/cpa-instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary',
        baseUrl: 'http://instance-a:8317',
        apiKey: 'good-a',
        syncInterval: 5,
        isEnabled: true,
      }),
    })
    expect(createInstanceResponse.status).toBe(201)

    const postResponse = await apiRequest(baseUrl, cookie, '/api/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-compat',
        inputPrice: 2,
        outputPrice: 8,
        cachePrice: 0.5,
      }),
    })
    expect(postResponse.status).toBe(200)

    const postPayload = await postResponse.json()
    expect(postPayload.pricing['gpt-compat']).toEqual({
      promptPrice: 2,
      completionPrice: 8,
      cachePrice: 0.5,
      updatedAt: expect.any(String),
    })

    const deleteResponse = await apiRequest(baseUrl, cookie, '/api/pricing/gpt-compat', {
      method: 'DELETE',
    })
    expect(deleteResponse.status).toBe(200)

    const pricingAfterDeleteResponse = await apiRequest(baseUrl, cookie, '/api/pricing')
    const pricingAfterDelete = await pricingAfterDeleteResponse.json()
    expect(pricingAfterDelete).toEqual({})

    const seedResponse = await apiRequest(baseUrl, cookie, '/api/pricing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pricing: {
          'gpt-temp': {
            promptPrice: 4,
            completionPrice: 12,
            cachePrice: 1,
          },
        },
      }),
    })
    expect(seedResponse.status).toBe(200)

    const clearResponse = await apiRequest(baseUrl, cookie, '/api/pricing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pricing: {},
      }),
    })
    expect(clearResponse.status).toBe(200)

    const clearPayload = await clearResponse.json()
    expect(clearPayload.pricing).toEqual({})

    const usageAfterClearResponse = await apiRequest(baseUrl, cookie, '/api/usage')
    const usageAfterClear = await usageAfterClearResponse.json()
    expect(usageAfterClear.modelPricing).toEqual({})
  })

  it('exports data bundles and skips duplicates when importing the same data again', async () => {
    const sourceFetchImpl = createCliProxyFetchMock()
    const { baseUrl: sourceBaseUrl } = await startApp(sourceFetchImpl as unknown as typeof fetch)
    const sourceCookie = await bootstrapCookie(sourceBaseUrl)

    const sourceInstanceResponse = await apiRequest(sourceBaseUrl, sourceCookie, '/api/cpa-instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Source A',
        baseUrl: 'http://instance-a:8317',
        apiKey: 'good-a',
        syncInterval: 5,
        isEnabled: true,
      }),
    })
    expect(sourceInstanceResponse.status).toBe(201)

    const sourcePricingResponse = await apiRequest(sourceBaseUrl, sourceCookie, '/api/pricing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pricing: {
          'gpt-a': {
            promptPrice: 1,
            completionPrice: 3,
            cachePrice: 0.25,
          },
        },
      }),
    })
    expect(sourcePricingResponse.status).toBe(200)

    const sourceSyncResponse = await apiRequest(sourceBaseUrl, sourceCookie, '/api/usage/export-now', {
      method: 'POST',
    })
    expect(sourceSyncResponse.status).toBe(200)

    const exportResponse = await apiRequest(sourceBaseUrl, sourceCookie, '/api/data-export?scope=all')
    expect(exportResponse.status).toBe(200)

    const exportPayload = await exportResponse.json()
    expect(exportPayload.usageRecords).toHaveLength(1)
    expect(exportPayload.modelPricing['gpt-a']).toMatchObject({
      promptPrice: 1,
      completionPrice: 3,
      cachePrice: 0.25,
    })

    const targetFetchImpl = createCliProxyFetchMock()
    const { baseUrl: targetBaseUrl, usageDb: targetUsageDb } = await startApp(targetFetchImpl as unknown as typeof fetch)
    const targetCookie = await bootstrapCookie(targetBaseUrl)

    const dummyInstance = targetUsageDb.createCpaInstance({
      name: 'Dummy',
      baseUrl: 'http://good-b:8317',
      apiKey: 'good-b',
      syncInterval: 5,
      isEnabled: false,
    })
    const matchingInstance = targetUsageDb.createCpaInstance({
      name: 'Target A',
      baseUrl: 'http://instance-a:8317',
      apiKey: 'good-a',
      syncInterval: 5,
      isEnabled: true,
    })
    expect(dummyInstance).toBeTruthy()
    expect(matchingInstance).toBeTruthy()

    const firstImportResponse = await apiRequest(targetBaseUrl, targetCookie, '/api/data-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exportPayload),
    })
    expect(firstImportResponse.status).toBe(200)

    const firstImportPayload = await firstImportResponse.json()
    expect(firstImportPayload.summary).toMatchObject({
      instancesMatched: 1,
      instancesCreated: 0,
      recordsReceived: 1,
      recordsInserted: 1,
      duplicatesSkipped: 0,
      keyProviderEntriesImported: 1,
      pricingModelsMerged: 1,
    })

    const pricingAfterImportResponse = await apiRequest(targetBaseUrl, targetCookie, '/api/pricing')
    const pricingAfterImport = await pricingAfterImportResponse.json()
    expect(pricingAfterImport['gpt-a']).toMatchObject({
      promptPrice: 1,
      completionPrice: 3,
      cachePrice: 0.25,
    })

    const aggregateUsageAfterImportResponse = await apiRequest(targetBaseUrl, targetCookie, '/api/usage?scope=all')
    const aggregateUsageAfterImport = await aggregateUsageAfterImportResponse.json()
    expect(aggregateUsageAfterImport.usage.total_requests).toBe(1)
    expect(aggregateUsageAfterImport.keyProviderCache[`instance:${matchingInstance.id}:auth:a-1`]).toMatchObject({
      email: 'a@example.com',
    })

    const liveSyncAfterImportResponse = await apiRequest(targetBaseUrl, targetCookie, `/api/usage/export-now?scope=instance&instanceId=${matchingInstance.id}`, {
      method: 'POST',
    })
    expect(liveSyncAfterImportResponse.status).toBe(200)

    const aggregateUsageAfterSyncResponse = await apiRequest(targetBaseUrl, targetCookie, '/api/usage?scope=all')
    const aggregateUsageAfterSync = await aggregateUsageAfterSyncResponse.json()
    expect(aggregateUsageAfterSync.usage.total_requests).toBe(1)

    const secondImportResponse = await apiRequest(targetBaseUrl, targetCookie, '/api/data-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exportPayload),
    })
    expect(secondImportResponse.status).toBe(200)

    const secondImportPayload = await secondImportResponse.json()
    expect(secondImportPayload.summary).toMatchObject({
      recordsInserted: 0,
      duplicatesSkipped: 1,
    })
  })
})
