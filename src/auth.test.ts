import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('auth helpers', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.unstubAllGlobals()
  })

  it('apiFetch uses same-origin cookies and does not add an Authorization header', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    global.fetch = fetchSpy as typeof fetch

    const { apiFetch } = await import('./auth.js')
    await apiFetch('/api/usage', {
      headers: {
        'Content-Type': 'application/json',
      },
    })

    expect(fetchSpy).toHaveBeenCalledWith('/api/usage', expect.objectContaining({
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
    }))

    const [, init] = fetchSpy.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(headers.has('Authorization')).toBe(false)
  })

  it('apiFetch notifies listeners after a 401 response from an API route', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 })) as typeof fetch
    const listener = vi.fn()

    const { apiFetch, subscribeToAuthChanges } = await import('./auth.js')
    const unsubscribe = subscribeToAuthChanges(listener)

    await apiFetch('/api/settings')

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('createApiEventSource keeps the same-origin stream URL unchanged', async () => {
    const eventSourceSpy = vi.fn()
    vi.stubGlobal('EventSource', eventSourceSpy)

    const { createApiEventSource } = await import('./auth.js')
    createApiEventSource('/api/usage/stream')

    expect(eventSourceSpy).toHaveBeenCalledWith('http://localhost:3000/api/usage/stream')
  })
})
