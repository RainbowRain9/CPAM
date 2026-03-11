import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn()
const subscribeToAuthChanges = vi.fn(() => () => {})
const clearStoredAppAuth = vi.fn()

vi.mock('./auth.js', () => ({
  apiFetch,
  subscribeToAuthChanges,
  clearStoredAppAuth,
}))

vi.mock('./App', () => ({
  default: () => <div>Mock Dashboard</div>,
}))

vi.mock('./pages/SetupPage', () => ({
  default: () => <div>Mock Setup</div>,
}))

vi.mock('./pages/CodexPage', () => ({
  default: () => <div>Mock Codex</div>,
}))

vi.mock('./pages/OpenCodePage', () => ({
  default: () => <div>Mock OpenCode</div>,
}))

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('RootApp', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    subscribeToAuthChanges.mockClear()
    clearStoredAppAuth.mockClear()
    window.location.hash = '#/'
  })

  it('renders setup when the app is not configured', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/auth/status') {
        return Promise.resolve(jsonResponse({ authenticated: true, loginRequired: false, blocked: false }))
      }
      if (path === '/api/settings') {
        return Promise.resolve(jsonResponse({ configured: false }))
      }
      return Promise.reject(new Error(`Unexpected path: ${path}`))
    })

    const { RootApp } = await import('./RootApp')
    render(<RootApp />)

    expect(await screen.findByText('Mock Setup')).toBeInTheDocument()
  })

  it('renders hash routes after configuration is loaded', async () => {
    window.location.hash = '#/codex'
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/auth/status') {
        return Promise.resolve(jsonResponse({ authenticated: true, loginRequired: false, blocked: false }))
      }
      if (path === '/api/settings') {
        return Promise.resolve(jsonResponse({
          configured: true,
          cliProxyUrl: 'http://localhost:8317',
          syncInterval: 5,
          openCodeConfigPath: '/tmp/opencode',
        }))
      }
      return Promise.reject(new Error(`Unexpected path: ${path}`))
    })

    const { RootApp } = await import('./RootApp')
    render(<RootApp />)

    expect(await screen.findByText('Mock Codex')).toBeInTheDocument()
    await waitFor(() => expect(subscribeToAuthChanges).toHaveBeenCalled())
  })
})
