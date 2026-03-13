import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { hasDefinedIdentifier, resolveAppAuthSecret, shouldUseViteProxy } = require('./runtime')

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dirPath = tempDirs.pop()
    if (dirPath && fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true })
    }
  }
})

describe('server runtime helpers', () => {
  it('uses an explicit environment secret before touching disk', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-center-runtime-'))
    tempDirs.push(dataDir)

    expect(resolveAppAuthSecret({
      dataDir,
      envSecret: 'from-env-secret',
      secretFile: path.join(dataDir, '.ignored-secret'),
    })).toBe('from-env-secret')
  })

  it('persists a generated secret and reuses it on the next read', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-center-runtime-'))
    const secretFile = path.join(dataDir, '.session-secret')
    tempDirs.push(dataDir)

    const firstSecret = resolveAppAuthSecret({ dataDir, secretFile, envSecret: '' })
    const secondSecret = resolveAppAuthSecret({ dataDir, secretFile, envSecret: '' })

    expect(firstSecret).toMatch(/^[a-f0-9]{64}$/)
    expect(secondSecret).toBe(firstSecret)
    expect(fs.readFileSync(secretFile, 'utf-8').trim()).toBe(firstSecret)
  })

  it('only enables the Vite proxy when the explicit dev flag is set', () => {
    expect(shouldUseViteProxy({ nodeEnv: 'development', devProxyFlag: 'true' })).toBe(true)
    expect(shouldUseViteProxy({ nodeEnv: 'development', devProxyFlag: '' })).toBe(false)
    expect(shouldUseViteProxy({ nodeEnv: 'production', devProxyFlag: 'true' })).toBe(false)
  })

  it('treats numeric zero as a valid identifier', () => {
    expect(hasDefinedIdentifier(0)).toBe(true)
    expect(hasDefinedIdentifier('0')).toBe(true)
    expect(hasDefinedIdentifier('')).toBe(false)
    expect(hasDefinedIdentifier(null)).toBe(false)
  })
})
