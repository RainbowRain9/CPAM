import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn()
const subscribeToAuthChanges = vi.fn(() => () => {})
const notifyAuthChanged = vi.fn()

vi.mock('./auth.js', () => ({
  apiFetch,
  notifyAuthChanged,
  subscribeToAuthChanges,
}))

vi.mock('./App', () => ({
  default: () => <div>Mock Dashboard</div>,
}))

vi.mock('./pages/BootstrapAdminPage', () => ({
  default: () => <div>Mock Bootstrap</div>,
}))

vi.mock('./pages/LoginPage', () => ({
  default: () => <div>Mock Login</div>,
}))

vi.mock('./pages/SetupPage', () => ({
  default: () => <div>Mock Setup</div>,
}))

vi.mock('./pages/CodexPage', () => ({
  default: () => <div>Mock Codex</div>,
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
    notifyAuthChanged.mockClear()
    window.location.hash = '#/'
  })

  it('renders bootstrap when the first admin has not been created', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/auth/status') {
        return Promise.resolve(jsonResponse({
          bootstrapRequired: true,
          authenticated: false,
          loginRequired: false,
          blocked: false,
        }))
      }
      return Promise.reject(new Error(`Unexpected path: ${path}`))
    })

    const { RootApp } = await import('./RootApp')
    render(<RootApp />)

    expect(await screen.findByText('Mock Bootstrap')).toBeInTheDocument()
  })

  it('renders login when authentication is required', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/auth/status') {
        return Promise.resolve(jsonResponse({
          bootstrapRequired: false,
          authenticated: false,
          loginRequired: true,
          blocked: false,
        }))
      }
      return Promise.reject(new Error(`Unexpected path: ${path}`))
    })

    const { RootApp } = await import('./RootApp')
    render(<RootApp />)

    expect(await screen.findByText('Mock Login')).toBeInTheDocument()
  })

  it('renders setup when the app is authenticated but not configured', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/auth/status') {
        return Promise.resolve(jsonResponse({
          bootstrapRequired: false,
          authenticated: true,
          loginRequired: true,
          blocked: false,
          user: { username: 'admin' },
        }))
      }
      if (path === '/api/cpa-instances') {
        return Promise.resolve(jsonResponse({ instances: [] }))
      }
      return Promise.reject(new Error(`Unexpected path: ${path}`))
    })

    const { RootApp } = await import('./RootApp')
    render(<RootApp />)

    expect(await screen.findByText('Mock Setup')).toBeInTheDocument()
  })

  it('renders hash routes after the authenticated app is configured', async () => {
    window.location.hash = '#/codex'
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/auth/status') {
        return Promise.resolve(jsonResponse({
          bootstrapRequired: false,
          authenticated: true,
          loginRequired: true,
          blocked: false,
          user: { username: 'admin' },
        }))
      }
      if (path === '/api/cpa-instances') {
        return Promise.resolve(jsonResponse({
          instances: [{
            id: 1,
            name: 'Primary',
            baseUrl: 'http://localhost:8317',
            syncInterval: 5,
            isActive: true,
            isEnabled: true,
            status: 'healthy',
            statusMessage: '',
            lastCheckedAt: null,
            lastSyncAt: null,
            lastExportAt: null,
            apiKeyPreview: 'cli-***min',
          }],
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
