import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../auth.js'
import {
  type CpaInstance,
  fetchCpaInstances,
  getActiveCpaInstance,
  getCpaInstanceStatusClass,
  getCpaInstanceStatusLabel,
} from '../cpaInstances'
import { ActionButton, AppShell, GlassPanel, InlineIcon } from '../components/ui'
import { useI18n } from '../i18n/useI18n'

const SYNC_INTERVALS = [1, 3, 5, 10, 30]
const DEFAULT_BASE_URL = 'http://localhost:8317'

type SetupPageProps = {
  onComplete?: () => void | Promise<void>
  onCancel?: () => void
  onLogout?: () => void | Promise<void>
  instances?: CpaInstance[]
}

function InfoChip({ icon, label, value }: { icon: JSX.Element; label: string; value: string }) {
  return (
    <div className="surface-panel-subtle flex items-start gap-3 rounded-[24px] px-4 py-4">
      <div className="mt-0.5 text-[var(--text-primary)]">{icon}</div>
      <div>
        <p className="text-xs uppercase tracking-[0.18em] faint-text">{label}</p>
        <p className="mt-2 text-sm leading-6 muted-text">{value}</p>
      </div>
    </div>
  )
}

function formatTime(isoString: string | null | undefined) {
  if (!isoString) return '-'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN')
}

export default function SetupPage({
  onComplete,
  onCancel,
  onLogout,
  instances = [],
}: SetupPageProps) {
  const [items, setItems] = useState<CpaInstance[]>(instances)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [instanceName, setInstanceName] = useState('')
  const [cliProxyUrl, setCliProxyUrl] = useState(DEFAULT_BASE_URL)
  const [cliProxyKey, setCliProxyKey] = useState('')
  const [syncInterval, setSyncInterval] = useState(5)
  const [isEnabled, setIsEnabled] = useState(true)
  const [settingsError, setSettingsError] = useState('')
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const { t } = useI18n()

  useEffect(() => {
    setItems(instances)
  }, [instances])

  const activeInstance = useMemo(() => getActiveCpaInstance(items), [items])
  const hasInstances = items.length > 0
  const isEditingConfiguredInstance = editingId !== null

  const setupMeta = useMemo(() => (
    <>
      <span className="chip">{t('Multi CPA')}</span>
      <span className="chip">{t('SQLite backed')}</span>
      <span className="chip">{t('Current active')}</span>
    </>
  ), [t])

  const resetForm = () => {
    setEditingId(null)
    setInstanceName('')
    setCliProxyUrl(activeInstance?.baseUrl || DEFAULT_BASE_URL)
    setCliProxyKey('')
    setSyncInterval(activeInstance?.syncInterval || 5)
    setIsEnabled(true)
    setSettingsError('')
  }

  useEffect(() => {
    if (!hasInstances && editingId !== null) {
      resetForm()
    }
  }, [editingId, hasInstances])

  const refreshInstances = async () => {
    const nextInstances = await fetchCpaInstances()
    setItems(nextInstances)
    return nextInstances
  }

  const handleEdit = (instance: CpaInstance) => {
    setEditingId(instance.id)
    setInstanceName(instance.name)
    setCliProxyUrl(instance.baseUrl)
    setCliProxyKey('')
    setSyncInterval(instance.syncInterval)
    setIsEnabled(instance.isEnabled)
    setSettingsError('')
    setActionMessage('')
  }

  const handleSettingsSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSettingsError('')
    setActionMessage('')
    setSettingsLoading(true)

    const wasFirstInstance = items.length === 0

    try {
      const isEditing = editingId !== null
      const endpoint = isEditing ? `/api/cpa-instances/${editingId}` : '/api/cpa-instances'
      const response = await apiFetch(endpoint, {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: instanceName,
          baseUrl: cliProxyUrl,
          apiKey: cliProxyKey,
          syncInterval,
          isEnabled,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || t('Save failed'))
      }

      await refreshInstances()
      resetForm()

      if (wasFirstInstance || onCancel) {
        await onComplete?.()
      } else {
        setActionMessage(t('Instance saved'))
      }
    } catch (error) {
      setSettingsError((error as Error).message || t('Save failed'))
    } finally {
      setSettingsLoading(false)
    }
  }

  const handleActivate = async (instance: CpaInstance) => {
    setBusyId(instance.id)
    setSettingsError('')
    setActionMessage('')

    try {
      const response = await apiFetch(`/api/cpa-instances/${instance.id}/activate`, {
        method: 'POST',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || t('Activation failed'))
      }

      await refreshInstances()
      setActionMessage(t('Instance activated'))
    } catch (error) {
      setSettingsError((error as Error).message || t('Activation failed'))
    } finally {
      setBusyId(null)
    }
  }

  const handleToggleEnabled = async (instance: CpaInstance) => {
    setBusyId(instance.id)
    setSettingsError('')
    setActionMessage('')

    try {
      const response = await apiFetch(`/api/cpa-instances/${instance.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isEnabled: !instance.isEnabled,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || t('Update failed'))
      }

      await refreshInstances()
      setActionMessage(instance.isEnabled ? t('Instance disabled') : t('Instance enabled'))
    } catch (error) {
      setSettingsError((error as Error).message || t('Update failed'))
    } finally {
      setBusyId(null)
    }
  }

  const handleCheck = async (instance: CpaInstance) => {
    setBusyId(instance.id)
    setSettingsError('')
    setActionMessage('')

    try {
      const response = await apiFetch(`/api/cpa-instances/${instance.id}/check`, {
        method: 'POST',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || t('Verification failed'))
      }

      await refreshInstances()
      setActionMessage(t('Instance checked'))
    } catch (error) {
      setSettingsError((error as Error).message || t('Verification failed'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <AppShell showNav={false}>
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5">
        <GlassPanel tone="strong" className="rounded-[32px] p-6 md:p-7">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] faint-text">{t('Welcome to API Center')}</p>
              <h1 className="mt-2 text-[1.8rem] font-medium tracking-[-0.05em] text-[var(--text-primary)]">
                {t('CPA instance settings')}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 muted-text">
                {hasInstances
                  ? t('Manage multiple CPA instances, choose the active one for management flows, and keep per-instance sync intervals independent.')
                  : t('Create the first CPA instance to unlock the dashboard and CodeX management views.')}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {setupMeta}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeInstance ? <span className="chip">{t('Active instance')}: {activeInstance.name}</span> : null}
              <span className="chip">{hasInstances ? t('Configured') : t('First run')}</span>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <form onSubmit={handleSettingsSubmit} className="space-y-5 rounded-[28px] border border-[var(--border-color)] bg-[var(--bg-card-strong)] p-5">
              <div>
                <label className="field-label">{t('Instance name')}</label>
                <input
                  type="text"
                  value={instanceName}
                  onChange={(event) => setInstanceName(event.target.value)}
                  className="field-input"
                  placeholder={t('Optional display name')}
                />
              </div>

              <div>
                <label className="field-label">{t('CLI-Proxy URL')}</label>
                <input
                  type="text"
                  value={cliProxyUrl}
                  onChange={(event) => setCliProxyUrl(event.target.value)}
                  className="field-input"
                  placeholder={DEFAULT_BASE_URL}
                  required
                />
              </div>

              <div>
                <label className="field-label">{t('CLI-Proxy admin password')}</label>
                <input
                  type="password"
                  value={cliProxyKey}
                  onChange={(event) => setCliProxyKey(event.target.value)}
                  className="field-input"
                  placeholder={isEditingConfiguredInstance ? t('Leave blank to keep current password') : t('Enter the management password')}
                  autoComplete="off"
                  required={!isEditingConfiguredInstance}
                />
                <p className="mt-2 text-xs faint-text">
                  {isEditingConfiguredInstance
                    ? t('Leave the password empty to keep the current secret. Changing URL or password will trigger a fresh validation.')
                    : t('Validated against the CLI-Proxy management API before saving.')}
                </p>
              </div>

              <div>
                <label className="field-label">{t('Sync interval')}</label>
                <div className="flex flex-wrap gap-2">
                  {SYNC_INTERVALS.map((item) => (
                    <ActionButton
                      key={item}
                      type="button"
                      size="sm"
                      variant={syncInterval === item ? 'primary' : 'secondary'}
                      onClick={() => setSyncInterval(item)}
                    >
                      {t('{count} minutes', { count: item })}
                    </ActionButton>
                  ))}
                </div>
              </div>

              <div className="surface-panel-subtle flex items-center justify-between rounded-[22px] px-4 py-4">
                <div>
                  <p className="text-sm text-[var(--text-primary)]">{t('Enabled for sync')}</p>
                  <p className="mt-1 text-xs faint-text">{t('Disabled instances keep history but stop future sync jobs.')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEnabled((value) => !value)}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                    isEnabled ? 'bg-[var(--text-primary)]' : 'bg-[var(--bg-secondary)]'
                  }`}
                >
                  <span
                    className={`inline-block h-6 w-6 rounded-full bg-white transition-transform ${
                      isEnabled ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <InfoChip
                  icon={<InlineIcon name="check" className="h-4 w-4" />}
                  label={t('Connection')}
                  value={t('Each instance stores its own CLI-Proxy address, password, and sync interval.')}
                />
                <InfoChip
                  icon={<InlineIcon name="spark" className="h-4 w-4" />}
                  label={t('Aggregate view')}
                  value={t('The dashboard defaults to the active instance and can switch to a combined summary across all instances.')}
                />
              </div>

              {settingsError ? <p className="text-sm text-[var(--danger)]">{settingsError}</p> : null}
              {actionMessage ? <p className="text-sm text-[var(--success)]">{actionMessage}</p> : null}

              <div className="flex flex-wrap gap-3">
                <ActionButton type="submit" variant="primary" size="lg" loading={settingsLoading} icon={<InlineIcon name="spark" />}>
                  {settingsLoading
                    ? t('Saving...')
                    : editingId !== null
                      ? t('Save instance')
                      : t('Add instance')}
                </ActionButton>
                {editingId !== null ? (
                  <ActionButton type="button" variant="secondary" size="lg" onClick={resetForm}>
                    {t('Cancel edit')}
                  </ActionButton>
                ) : null}
                {onCancel ? (
                  <ActionButton type="button" variant="secondary" size="lg" onClick={onCancel}>
                    {t('Back to dashboard')}
                  </ActionButton>
                ) : null}
                {onLogout ? (
                  <ActionButton type="button" variant="ghost" size="lg" onClick={() => void onLogout()}>
                    {t('Sign out')}
                  </ActionButton>
                ) : null}
              </div>
            </form>

            <div className="space-y-4">
              <div className="rounded-[28px] border border-[var(--border-color)] bg-[var(--bg-card-strong)] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] faint-text">{t('Instance list')}</p>
                    <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-[var(--text-primary)]">
                      {t('All CPA instances')}
                    </h2>
                    <p className="mt-2 text-sm leading-6 muted-text">
                      {t('The active instance drives CodeX operations and the default single-instance dashboard view.')}
                    </p>
                  </div>
                  <div className="chip">{t('{count} instances', { count: items.length })}</div>
                </div>
              </div>

              {items.length === 0 ? (
                <GlassPanel tone="subtle" className="rounded-[28px] p-8 text-center">
                  <p className="text-base text-[var(--text-primary)]">{t('No CPA instances yet')}</p>
                  <p className="mt-2 text-sm muted-text">{t('Create your first instance to start syncing usage and manage CodeX accounts.')}</p>
                </GlassPanel>
              ) : (
                items.map((instance) => (
                  <GlassPanel key={instance.id} tone="subtle" className="rounded-[28px] p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-medium tracking-[-0.03em] text-[var(--text-primary)]">
                            {instance.name}
                          </h3>
                          {instance.isActive ? <span className="chip">{t('Current active')}</span> : null}
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getCpaInstanceStatusClass(instance.status)}`}>
                            {getCpaInstanceStatusLabel(instance.status, t)}
                          </span>
                        </div>
                        <p className="mt-2 break-all text-sm muted-text">{instance.baseUrl}</p>
                        <div className="mt-3 flex flex-wrap gap-3 text-xs faint-text">
                          <span>{t('Sync interval')}: {t('{count} minutes', { count: instance.syncInterval })}</span>
                          <span>{t('Last sync')}: {formatTime(instance.lastSyncAt)}</span>
                          <span>{t('API key preview')}: {instance.apiKeyPreview || '-'}</span>
                        </div>
                        {instance.statusMessage ? (
                          <p className="mt-3 text-sm text-[var(--text-secondary)]">{instance.statusMessage}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2 lg:max-w-[360px] lg:justify-end">
                        {!instance.isActive && instance.isEnabled ? (
                          <ActionButton
                            size="sm"
                            variant="primary"
                            onClick={() => void handleActivate(instance)}
                            loading={busyId === instance.id}
                          >
                            {t('Set active')}
                          </ActionButton>
                        ) : null}
                        <ActionButton size="sm" variant="secondary" onClick={() => handleEdit(instance)}>
                          {t('Edit instance')}
                        </ActionButton>
                        {instance.isEnabled ? (
                          <ActionButton size="sm" variant="secondary" onClick={() => void handleCheck(instance)} loading={busyId === instance.id}>
                            {t('Check now')}
                          </ActionButton>
                        ) : null}
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleToggleEnabled(instance)}
                          loading={busyId === instance.id}
                        >
                          {instance.isEnabled ? t('Disable instance') : t('Enable instance')}
                        </ActionButton>
                      </div>
                    </div>
                  </GlassPanel>
                ))
              )}
            </div>
          </div>
        </GlassPanel>
      </div>
    </AppShell>
  )
}
