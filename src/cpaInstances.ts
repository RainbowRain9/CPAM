import { apiFetch } from './auth.js'

export type CpaInstanceStatus = 'healthy' | 'auth_failed' | 'unreachable' | 'disabled'

export type CpaInstance = {
  id: number
  name: string
  baseUrl: string
  syncInterval: number
  isActive: boolean
  isEnabled: boolean
  status: CpaInstanceStatus
  statusMessage: string
  lastCheckedAt: string | null
  lastSyncAt: string | null
  lastExportAt: string | null
  apiKeyPreview: string
}

export function extractCpaInstances(payload: unknown): CpaInstance[] {
  if (Array.isArray(payload)) {
    return payload as CpaInstance[]
  }

  if (payload && typeof payload === 'object' && Array.isArray((payload as { instances?: unknown[] }).instances)) {
    return (payload as { instances: CpaInstance[] }).instances
  }

  return []
}

export async function fetchCpaInstances() {
  const response = await apiFetch('/api/cpa-instances')
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error((payload as { error?: string }).error || 'Failed to load CPA instances') as Error & { status?: number }
    error.status = response.status
    throw error
  }

  return extractCpaInstances(payload)
}

export function getActiveCpaInstance(instances: CpaInstance[]) {
  return instances.find((instance) => instance.isActive) || instances.find((instance) => instance.isEnabled) || null
}

export function getCpaInstanceStatusLabel(status: CpaInstanceStatus, t: (key: string) => string) {
  switch (status) {
    case 'healthy':
      return t('Healthy')
    case 'auth_failed':
      return t('Auth failed')
    case 'disabled':
      return t('Disabled')
    case 'unreachable':
    default:
      return t('Unreachable')
  }
}

export function getCpaInstanceStatusClass(status: CpaInstanceStatus) {
  switch (status) {
    case 'healthy':
      return 'border-[color-mix(in_srgb,var(--success)_28%,transparent)] bg-[color-mix(in_srgb,var(--success)_12%,var(--bg-card-strong))] text-[var(--success)]'
    case 'auth_failed':
      return 'border-[color-mix(in_srgb,var(--warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--warning)_12%,var(--bg-card-strong))] text-[var(--warning)]'
    case 'disabled':
      return 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
    case 'unreachable':
    default:
      return 'border-[color-mix(in_srgb,var(--danger)_26%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,var(--bg-card-strong))] text-[var(--danger)]'
  }
}

export function buildScopedCacheKey(instanceId: number | string | null | undefined, type: 'auth' | 'source', value: string | number | null | undefined) {
  if (instanceId === null || instanceId === undefined || value === null || value === undefined || String(value).trim() === '') {
    return ''
  }

  return `instance:${instanceId}:${type}:${String(value)}`
}
