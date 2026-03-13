import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../auth.js'
import { ActionButton, AppShell, GlassPanel, InlineIcon } from '../components/ui'
import { useI18n } from '../i18n/useI18n'

const SYNC_INTERVALS = [1, 3, 5, 10, 30]

type SetupPageProps = {
  onComplete?: () => void | Promise<void>
  onCancel?: () => void
  onLogout?: () => void | Promise<void>
  initialSettings?: {
    cliProxyUrl?: string
    syncInterval?: number
  } | null
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

export default function SetupPage({
  onComplete,
  onCancel,
  onLogout,
  initialSettings,
}: SetupPageProps) {
  const [cliProxyUrl, setCliProxyUrl] = useState(initialSettings?.cliProxyUrl || 'http://localhost:8317')
  const [cliProxyKey, setCliProxyKey] = useState('')
  const [syncInterval, setSyncInterval] = useState(initialSettings?.syncInterval || 5)
  const [settingsError, setSettingsError] = useState('')
  const [settingsLoading, setSettingsLoading] = useState(false)
  const { t } = useI18n()

  const isEditingConfiguredSettings = Boolean(initialSettings?.cliProxyUrl)

  useEffect(() => {
    if (!initialSettings) return
    if (initialSettings.cliProxyUrl) setCliProxyUrl(initialSettings.cliProxyUrl)
    if (initialSettings.syncInterval) setSyncInterval(initialSettings.syncInterval)
  }, [initialSettings])

  const setupMeta = useMemo(() => (
    <>
      <span className="chip">{t('Local runtime config')}</span>
      <span className="chip">{t('Separate from login')}</span>
      <span className="chip">{t('CLI-Proxy ready')}</span>
    </>
  ), [t])

  const handleSettingsSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSettingsError('')
    setSettingsLoading(true)

    try {
      const response = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliProxyUrl,
          cliProxyKey,
          syncInterval,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || t('Save failed'))
      }

      await onComplete?.()
    } catch (error) {
      setSettingsError((error as Error).message || t('Save failed'))
    } finally {
      setSettingsLoading(false)
    }
  }

  return (
    <AppShell showNav={false}>
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5">
        <GlassPanel tone="strong" className="rounded-[32px] p-6 md:p-7">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] faint-text">{t('Welcome to API Center')}</p>
              <h1 className="mt-2 text-[1.8rem] font-medium tracking-[-0.05em] text-[var(--text-primary)]">
                {t('Runtime settings')}
              </h1>
              <p className="mt-3 text-sm leading-6 muted-text">
                {t('Save the CLI-Proxy connection used by the dashboard and management views.')}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {setupMeta}
              </div>
            </div>
            <div className="chip">{t('Ready')}</div>
          </div>

          <form onSubmit={handleSettingsSubmit} className="space-y-5">
            <div>
              <label className="field-label">{t('CLI-Proxy URL')}</label>
              <input
                type="text"
                value={cliProxyUrl}
                onChange={(event) => setCliProxyUrl(event.target.value)}
                className="field-input"
                placeholder="http://localhost:8317"
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
                placeholder={t('Enter the management password')}
                autoComplete="off"
                required
              />
              <p className="mt-2 text-xs faint-text">
                {isEditingConfiguredSettings
                  ? t('Saving again will revalidate the management password before replacing the local config.')
                  : t('These values are stored locally on the server and are not used for app login.')}
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

            <div className="grid gap-3 md:grid-cols-3">
              <InfoChip
                icon={<InlineIcon name="check" className="h-4 w-4" />}
                label={t('Connection')}
                value={t('Validated against the CLI-Proxy management API before saving.')}
              />
              <InfoChip
                icon={<InlineIcon name="spark" className="h-4 w-4" />}
                label={t('Usage sync')}
                value={t('The dashboard refresh interval stays configurable after login.')}
              />
              <InfoChip
                icon={<InlineIcon name="edit" className="h-4 w-4" />}
                label={t('Auth split')}
                value={t('The app login and CLI-Proxy business credentials are fully separated.')}
              />
            </div>

            {settingsError ? <p className="text-sm text-[var(--danger)]">{settingsError}</p> : null}

            <div className="flex flex-wrap gap-3">
              <ActionButton type="submit" variant="primary" size="lg" loading={settingsLoading} icon={<InlineIcon name="spark" />}>
                {settingsLoading ? t('Saving...') : t('Save settings')}
              </ActionButton>
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
        </GlassPanel>
      </div>
    </AppShell>
  )
}
