import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

describe('CodexPage', () => {
  beforeEach(() => {
    apiFetch.mockReset()
  })

  it('shows the active instance context in the page header', async () => {
    const { default: CodexPage } = await import('./CodexPage')

    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/cpa-instances') {
        return Promise.resolve(jsonResponse({
          instances: [{
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
          }],
        }))
      }

      if (path === '/api/codex/accounts') {
        return Promise.resolve(jsonResponse([]))
      }

      return Promise.reject(new Error(`Unexpected path: ${path}`))
    })

    render(
      <MemoryRouter>
        <ThemeProvider>
          <I18nProvider>
            <CodexPage />
          </I18nProvider>
        </ThemeProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText((_, node) => node?.textContent === 'Active instance: Primary CPA')).toBeInTheDocument()
      expect(screen.getByText('Healthy')).toBeInTheDocument()
    })
  })
})
