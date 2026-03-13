import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../i18n/I18nProvider'
import { ThemeProvider } from '../theme/ThemeProvider'

const apiFetch = vi.fn()

vi.mock('../auth.js', () => ({
  apiFetch,
}))

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SetupPage', () => {
  beforeEach(() => {
    apiFetch.mockReset()
  })

  it('renders the instance list with active and status labels', async () => {
    const { default: SetupPage } = await import('./SetupPage')

    render(
      <ThemeProvider>
        <I18nProvider>
          <SetupPage
            instances={[{
              id: 1,
              name: 'Primary CPA',
              baseUrl: 'http://localhost:8317',
              syncInterval: 5,
              isActive: true,
              isEnabled: true,
              status: 'healthy',
              statusMessage: 'validated',
              lastCheckedAt: null,
              lastSyncAt: null,
              lastExportAt: null,
              apiKeyPreview: 'cli-***min',
            }]}
          />
        </I18nProvider>
      </ThemeProvider>
    )

    expect(screen.getByText('Primary CPA')).toBeInTheDocument()
    expect(screen.getAllByText('Current active').length).toBeGreaterThan(0)
    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })

  it('sends a patch request when disabling an instance from the list', async () => {
    const { default: SetupPage } = await import('./SetupPage')

    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/cpa-instances/1') {
        return Promise.resolve(jsonResponse({ instance: { id: 1 } }))
      }
      if (path === '/api/cpa-instances') {
        return Promise.resolve(jsonResponse({
          instances: [{
            id: 1,
            name: 'Primary CPA',
            baseUrl: 'http://localhost:8317',
            syncInterval: 5,
            isActive: false,
            isEnabled: false,
            status: 'disabled',
            statusMessage: 'Instance disabled',
            lastCheckedAt: null,
            lastSyncAt: null,
            lastExportAt: null,
            apiKeyPreview: 'cli-***min',
          }],
        }))
      }
      return Promise.reject(new Error(`Unexpected path: ${path}`))
    })

    render(
      <ThemeProvider>
        <I18nProvider>
          <SetupPage
            instances={[{
              id: 1,
              name: 'Primary CPA',
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
            }]}
          />
        </I18nProvider>
      </ThemeProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Disable instance' }))

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/cpa-instances/1', expect.objectContaining({
        method: 'PATCH',
      }))
    })
  })
})
