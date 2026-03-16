import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch, createApiEventSource, fetchCpaInstances } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  createApiEventSource: vi.fn(),
  fetchCpaInstances: vi.fn(),
}))

vi.mock('./auth.js', () => ({
  apiFetch,
  createApiEventSource,
}))

vi.mock('./cpaInstances', () => ({
  fetchCpaInstances,
  getActiveCpaInstance: (instances: Array<{ isActive?: boolean; isEnabled?: boolean }>) => (
    instances.find((instance) => instance.isActive) ||
    instances.find((instance) => instance.isEnabled) ||
    null
  ),
  getCpaInstanceStatusClass: () => '',
  getCpaInstanceStatusLabel: (status: string) => status,
  buildScopedCacheKey: (instanceId: number | string, type: string, value: string | number) => (
    `instance:${instanceId}:${type}:${String(value)}`
  ),
}))

vi.mock('./navigation', () => ({
  buildPrimaryNav: () => [],
}))

vi.mock('./theme/useTheme', () => ({
  useTheme: () => ({
    resolvedTheme: 'light',
  }),
}))

vi.mock('./i18n/useI18n', () => ({
  useI18n: () => ({
    t: (value: string) => value,
  }),
}))

vi.mock('./components/ui', () => ({
  ActionButton: ({
    children,
    icon,
    loading,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; loading?: boolean }) => (
    <button {...props}>
      {icon}
      {loading ? 'loading' : null}
      {children}
    </button>
  ),
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  InlineIcon: () => <span aria-hidden="true" />,
}))

vi.mock('recharts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    ResponsiveContainer: Container,
    LineChart: Container,
    CartesianGrid: () => null,
    Line: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  }
})

import { MODEL_PRICING_PRESET_VERSION } from './modelPricingPresets'
import {
  LOCAL_MODEL_PRICING_KEY,
  LOCAL_MODEL_PRICING_PRESET_OPT_IN_KEY,
  LOCAL_MODEL_PRICING_PRESET_VERSION_KEY,
} from './modelPricingState'

type PersistedPricingMap = Record<string, {
  promptPrice: number
  completionPrice: number
  cachePrice: number
  updatedAt?: string
}>

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createUsagePayload(modelPricing: PersistedPricingMap = {}) {
  return {
    scope: 'instance',
    instanceId: 1,
    instanceName: 'Primary',
    lastExport: null,
    usage: {
      total_requests: 0,
      success_count: 0,
      failure_count: 0,
      total_tokens: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cached_tokens: 0,
      total_reasoning_tokens: 0,
      apis: {},
      requests_by_day: {},
      requests_by_hour: {},
      tokens_by_day: {},
      tokens_by_hour: {},
    },
    keyProviderCache: {},
    modelPricing,
  }
}

function withUpdatedAt(pricing: Record<string, { promptPrice: number; completionPrice: number; cachePrice: number }>) {
  return Object.fromEntries(
    Object.entries(pricing).map(([model, value]) => [model, {
      ...value,
      updatedAt: '2026-03-16T00:00:00.000Z',
    }]),
  )
}

function seedLocalPricing(pricing: Record<string, { promptPrice: number; completionPrice: number; cachePrice: number }>) {
  window.localStorage.setItem(LOCAL_MODEL_PRICING_KEY, JSON.stringify(pricing))
  window.localStorage.setItem(LOCAL_MODEL_PRICING_PRESET_VERSION_KEY, MODEL_PRICING_PRESET_VERSION)
}

async function openPricingTab() {
  await waitFor(() => {
    const pricingTab = screen.getAllByRole('button').find((button) => button.textContent?.trim() === '模型价格')
    expect(pricingTab).toBeTruthy()
    fireEvent.click(pricingTab!)
    expect(document.body.textContent).toContain('Active tab: pricing')
  })
}

async function renderApp() {
  const { default: App } = await import('./App')
  await act(async () => {
    render(<App />)
  })
}

describe('App date helpers', () => {
  it('formats daily summary keys from local date parts instead of UTC ISO strings', async () => {
    const { formatLocalDateKey } = await import('./App')
    const fakeLocalMidnight = {
      getFullYear: () => 2026,
      getMonth: () => 2,
      getDate: () => 13,
      toISOString: () => '2026-03-12T16:00:00.000Z',
    } as Date

    expect(formatLocalDateKey(fakeLocalMidnight)).toBe('2026-03-13')
  })
})

describe('App pricing persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    apiFetch.mockReset()
    createApiEventSource.mockReset()
    fetchCpaInstances.mockReset()
    window.localStorage.clear()

    fetchCpaInstances.mockResolvedValue([{
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
    }])

    createApiEventSource.mockReturnValue({
      close: vi.fn(),
      onmessage: null,
    })
  })

  it('uses server pricing as the authority after loading usage data', async () => {
    seedLocalPricing({
      'local-model': {
        promptPrice: 9,
        completionPrice: 19,
        cachePrice: 4.5,
      },
    })

    const serverPricing = withUpdatedAt({
      'server-model': {
        promptPrice: 2,
        completionPrice: 6,
        cachePrice: 1,
      },
    })

    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/api/usage?')) {
        return Promise.resolve(jsonResponse(createUsagePayload(serverPricing)))
      }

      throw new Error(`Unexpected path: ${path}`)
    })

    await renderApp()
    await openPricingTab()

    expect((await screen.findAllByText('server-model')).length).toBeGreaterThan(0)
    expect(screen.queryAllByText('local-model')).toHaveLength(0)

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(LOCAL_MODEL_PRICING_KEY) || '{}')).toEqual({
        'server-model': {
          promptPrice: 2,
          completionPrice: 6,
          cachePrice: 1,
        },
      })
      expect(window.localStorage.getItem(LOCAL_MODEL_PRICING_PRESET_OPT_IN_KEY)).toBe('false')
    })

    expect(apiFetch.mock.calls.filter(([path]) => path === '/api/pricing')).toHaveLength(0)
  })

  it('migrates stored local pricing to the server once when the server has no pricing yet', async () => {
    seedLocalPricing({
      'local-model': {
        promptPrice: 3,
        completionPrice: 12,
        cachePrice: 1.5,
      },
    })

    let serverPricing: PersistedPricingMap = {}
    const pricingPutBodies: Array<{ pricing: PersistedPricingMap }> = []

    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/api/usage?')) {
        return Promise.resolve(jsonResponse(createUsagePayload(serverPricing)))
      }

      if (path === '/api/pricing' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body || '{}'))
        pricingPutBodies.push(body)
        serverPricing = withUpdatedAt(body.pricing || {})
        return Promise.resolve(jsonResponse({
          success: true,
          pricing: serverPricing,
        }))
      }

      throw new Error(`Unexpected path: ${path}`)
    })

    await renderApp()
    await openPricingTab()

    await waitFor(() => {
      expect(pricingPutBodies).toHaveLength(1)
    })

    expect(pricingPutBodies[0]).toEqual({
      pricing: {
        'local-model': {
          promptPrice: 3,
          completionPrice: 12,
          cachePrice: 1.5,
        },
      },
    })
    expect((await screen.findAllByText('local-model')).length).toBeGreaterThan(0)

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(LOCAL_MODEL_PRICING_KEY) || '{}')).toEqual({
        'local-model': {
          promptPrice: 3,
          completionPrice: 12,
          cachePrice: 1.5,
        },
      })
      expect(window.localStorage.getItem(LOCAL_MODEL_PRICING_PRESET_OPT_IN_KEY)).toBe('false')
    })
  })

  it('persists save, delete, and clear-all pricing actions through PUT /api/pricing', async () => {
    let serverPricing = withUpdatedAt({
      'server-model': {
        promptPrice: 1,
        completionPrice: 5,
        cachePrice: 0.25,
      },
    })
    const pricingPutBodies: Array<{ pricing: PersistedPricingMap }> = []

    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/api/usage?')) {
        return Promise.resolve(jsonResponse(createUsagePayload(serverPricing)))
      }

      if (path === '/api/pricing' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body || '{}'))
        pricingPutBodies.push(body)
        serverPricing = withUpdatedAt(body.pricing || {})
        return Promise.resolve(jsonResponse({
          success: true,
          pricing: serverPricing,
        }))
      }

      throw new Error(`Unexpected path: ${path}`)
    })

    await renderApp()
    await openPricingTab()

    const selectElements = screen.getAllByRole('combobox')
    fireEvent.change(selectElements[1], {
      target: { value: 'gpt-5.4' },
    })

    const priceInputs = screen.getAllByRole('spinbutton')
    fireEvent.change(priceInputs[0], { target: { value: '1.5' } })
    fireEvent.change(priceInputs[1], { target: { value: '8.5' } })
    fireEvent.change(priceInputs[2], { target: { value: '0.4' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(pricingPutBodies[0]).toEqual({
        pricing: {
          'server-model': {
            promptPrice: 1,
            completionPrice: 5,
            cachePrice: 0.25,
          },
          'gpt-5.4': {
            promptPrice: 1.5,
            completionPrice: 8.5,
            cachePrice: 0.4,
          },
        },
      })
    })
    expect((await screen.findAllByText('gpt-5.4')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[1])
    await waitFor(() => {
      expect(pricingPutBodies[1]).toEqual({
        pricing: {
          'server-model': {
            promptPrice: 1,
            completionPrice: 5,
            cachePrice: 0.25,
          },
        },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '清空全部' }))
    await waitFor(() => {
      expect(pricingPutBodies[2]).toEqual({
        pricing: {},
      })
    })
    expect(await screen.findByText('暂未设置任何模型价格')).toBeInTheDocument()

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(LOCAL_MODEL_PRICING_KEY) || '{}')).toEqual({})
      expect(window.localStorage.getItem(LOCAL_MODEL_PRICING_PRESET_OPT_IN_KEY)).toBe('false')
    })
  })
})
