// @vitest-environment node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const { createUsageDb } = require('./db')
const { createLocalAuth } = require('./localAuth')
const { buildSessionExpiry, hashPassword, hashSessionToken, verifyPassword } = require('./auth')

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

async function startAuthServer(options: { loginMaxAttempts?: number } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpam-auth-'))
  tempDirs.push(dataDir)

  const usageDb = createUsageDb({ dataDir })
  databases.push(usageDb)

  const auth = createLocalAuth({
    usageDb,
    isProduction: false,
    ...options,
  })

  const app = express()
  app.use(express.json())
  app.use('/api/auth', auth.router)
  app.use('/api', auth.applyAuthState, auth.requireAppAuth)
  app.get('/api/protected', (req: any, res) => {
    res.json({
      authenticated: true,
      username: req.auth?.username || null,
    })
  })

  const server = await new Promise<any>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer))
  })
  servers.push(server)

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve test server address')
  }

  return {
    auth,
    usageDb,
    dataDir,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }
}

function getCookieHeader(response: Response) {
  const headers = response.headers as Response['headers'] & {
    getSetCookie?: () => string[]
  }
  const cookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean) as string[]
  return cookies[0]?.split(';')[0] || ''
}

describe('local auth routes', () => {
  it('returns bootstrapRequired when no administrator exists', async () => {
    const { baseUrl } = await startAuthServer()

    const response = await fetch(`${baseUrl}/api/auth/status`)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toMatchObject({
      bootstrapRequired: true,
      authenticated: false,
      loginRequired: false,
      blocked: false,
    })
  })

  it('bootstraps the first admin and authenticates the new session via cookie', async () => {
    const { baseUrl } = await startAuthServer()

    const response = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'bootstrap-pass-123',
        confirmPassword: 'bootstrap-pass-123',
      }),
    })

    expect(response.status).toBe(201)
    expect(getCookieHeader(response)).toMatch(/^cpam_session=/)

    const protectedResponse = await fetch(`${baseUrl}/api/protected`, {
      headers: { Cookie: getCookieHeader(response) },
    })
    const protectedData = await protectedResponse.json()

    expect(protectedResponse.status).toBe(200)
    expect(protectedData).toEqual({
      authenticated: true,
      username: 'admin',
    })
  })

  it('rejects bootstrap once an administrator already exists', async () => {
    const { baseUrl } = await startAuthServer()

    await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'bootstrap-pass-123',
        confirmPassword: 'bootstrap-pass-123',
      }),
    })

    const response = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'other',
        password: 'another-pass-123',
        confirmPassword: 'another-pass-123',
      }),
    })

    expect(response.status).toBe(409)
  })

  it('counts failed logins and blocks the IP after the threshold is exceeded', async () => {
    const { baseUrl } = await startAuthServer({ loginMaxAttempts: 2 })

    await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'bootstrap-pass-123',
        confirmPassword: 'bootstrap-pass-123',
      }),
    })

    const wrongLogin = async () => fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'wrong-password-123',
      }),
    })

    expect((await wrongLogin()).status).toBe(401)
    expect((await wrongLogin()).status).toBe(401)

    const blockedResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'bootstrap-pass-123',
      }),
    })

    expect(blockedResponse.status).toBe(429)
  })

  it('revokes only the current browser session on logout', async () => {
    const { baseUrl } = await startAuthServer()

    const bootstrapResponse = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'bootstrap-pass-123',
        confirmPassword: 'bootstrap-pass-123',
      }),
    })
    const cookie = getCookieHeader(bootstrapResponse)

    const secondLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'bootstrap-pass-123',
      }),
    })
    const secondCookie = getCookieHeader(secondLoginResponse)

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
    })

    expect(logoutResponse.status).toBe(200)

    const protectedResponse = await fetch(`${baseUrl}/api/protected`, {
      headers: { Cookie: cookie },
    })
    const secondSessionResponse = await fetch(`${baseUrl}/api/protected`, {
      headers: { Cookie: secondCookie },
    })

    expect(protectedResponse.status).toBe(401)
    expect(secondSessionResponse.status).toBe(200)
  })

  it('rejects access when the session is expired', async () => {
    const { baseUrl, usageDb } = await startAuthServer()

    const bootstrapResponse = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'bootstrap-pass-123',
        confirmPassword: 'bootstrap-pass-123',
      }),
    })
    const cookie = getCookieHeader(bootstrapResponse)
    const sessionToken = cookie.replace(/^cpam_session=/, '')
    const session = usageDb.getAuthSessionByTokenHash(hashSessionToken(sessionToken))

    usageDb.db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE id = ?').run(
      new Date(Date.now() - 60_000).toISOString(),
      session.id
    )

    const protectedResponse = await fetch(`${baseUrl}/api/protected`, {
      headers: { Cookie: cookie },
    })

    expect(protectedResponse.status).toBe(401)
  })
})

describe('reset-admin-password script', () => {
  it('updates the stored password hash and revokes existing sessions', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpam-reset-'))
    tempDirs.push(dataDir)

    const usageDb = createUsageDb({ dataDir })
    const user = usageDb.createAuthUser({
      username: 'admin',
      passwordHash: hashPassword('old-password-123'),
    })

    usageDb.createAuthSession({
      userId: user.id,
      sessionTokenHash: hashSessionToken('existing-session-token'),
      expiresAt: buildSessionExpiry(),
      lastSeenAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      userAgent: 'vitest',
      ipAddress: '127.0.0.1',
    })
    usageDb.close()

    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/reset-admin-password.js'], {
        cwd: repoRoot,
        env: {
          ...process.env,
          CPAM_DATA_DIR: dataDir,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let stderr = ''
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })

      child.on('error', reject)
      child.on('exit', (code) => {
        if (code === 0) {
          resolve()
          return
        }
        reject(new Error(stderr || `reset script exited with code ${code}`))
      })

      child.stdin.write('new-password-456\n')
      child.stdin.write('new-password-456\n')
      child.stdin.end()
    })

    const updatedDb = createUsageDb({ dataDir })
    const updatedUser = updatedDb.getSingleAuthUser()
    const updatedSession = updatedDb.getAuthSessionByTokenHash(hashSessionToken('existing-session-token'))

    expect(verifyPassword('old-password-123', updatedUser.password_hash)).toBe(false)
    expect(verifyPassword('new-password-456', updatedUser.password_hash)).toBe(true)
    expect(updatedSession.revoked_at).toBeTruthy()

    updatedDb.close()
  })
})
