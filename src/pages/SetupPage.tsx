import { useEffect, useMemo, useState } from 'react'
import { apiFetch, saveStoredAppAuth } from '../auth.js'
import { ActionButton, AppShell, GlassPanel, InlineIcon, PageHero } from '../components/ui'
import { useI18n } from '../i18n/useI18n'

const SYNC_INTERVALS = [1, 3, 5, 10, 30]

type SetupPageProps = {
  onComplete?: () => void | Promise<void>
  initialSettings?: {
    cliProxyUrl?: string
    syncInterval?: number
    openCodeConfigPath?: string
  } | null
  authRequired?: boolean
  authenticated?: boolean
  blocked?: boolean
  blockedMessage?: string
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
  initialSettings,
  authRequired = false,
  authenticated = false,
  blocked = false,
  blockedMessage = '',
}: SetupPageProps) {
  const [loginPassword, setLoginPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [cliProxyUrl, setCliProxyUrl] = useState(initialSettings?.cliProxyUrl || 'http://localhost:8317')
  const [cliProxyKey, setCliProxyKey] = useState('')
  const [syncInterval, setSyncInterval] = useState(initialSettings?.syncInterval || 5)
  const [openCodeConfigPath, setOpenCodeConfigPath] = useState(initialSettings?.openCodeConfigPath || '')
  const [settingsError, setSettingsError] = useState('')
  const [settingsLoading, setSettingsLoading] = useState(false)
  const { t } = useI18n()

  const showAuthForm = !blocked && authRequired && !authenticated
  const showSettingsForm = !blocked && (!authRequired || authenticated)
  const isEditingConfiguredSettings = Boolean(initialSettings?.cliProxyUrl)

  useEffect(() => {
    if (!initialSettings) return
    if (initialSettings.cliProxyUrl) setCliProxyUrl(initialSettings.cliProxyUrl)
    if (initialSettings.syncInterval) setSyncInterval(initialSettings.syncInterval)
    if (initialSettings.openCodeConfigPath !== undefined) {
      setOpenCodeConfigPath(initialSettings.openCodeConfigPath)
    }
  }, [initialSettings])

  const setupMeta = useMemo(() => (
    <>
      <span className="chip">{t('Monochrome control surface')}</span>
      <span className="chip">{t('Glass shell')}</span>
      <span className="chip">{t('Theme aware')}</span>
    </>
  ), [t])

  const handleAuthSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (blocked) return

    setAuthLoading(true)
    setAuthError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliProxyUrl, password: loginPassword }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || t('Verification failed'))
      }

      saveStoredAppAuth({
        token: data.token,
        expiresAt: data.expiresAt,
      })

      if (data.cliProxyUrl) {
        setCliProxyUrl(data.cliProxyUrl)
      }
      setCliProxyKey(loginPassword)
      setLoginPassword('')
    } catch (error) {
      setAuthError((error as Error).message || t('Verification failed'))
    } finally {
      setAuthLoading(false)
    }
  }

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
          openCodeConfigPath,
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
      <div className="grid gap-6 xl:grid-cols-[1.1fr_minmax(0,480px)]">
        <PageHero
          eyebrow={t('Control the full proxy surface')}
          title={t('Welcome to API Center')}
          subtitle={showAuthForm
            ? t('Authenticate against your CLI-Proxy management endpoint, then save local access settings for the dashboard.')
            : t('Connect CLI-Proxy, set a sync rhythm, and unlock a calmer management surface for usage, CodeX, and OpenCode.')}
          meta={setupMeta}
        />

        <GlassPanel tone="strong" className="rounded-[32px] p-6 md:p-7">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] faint-text">
                {showAuthForm ? t('Step 1') : t('Step 2')}
              </p>
              <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-[var(--text-primary)]">
                {showAuthForm ? t('Verify access') : t('Save runtime settings')}
              </h2>
              <p className="mt-3 text-sm leading-6 muted-text">
                {showAuthForm
                  ? t('Provide your CLI-Proxy address and management password to continue.')
                  : t('These values stay local to API Center and can be reopened from the footer at any time.')}
              </p>
            </div>
            <div className="chip">{blocked ? t('Blocked') : t('Ready')}</div>
          </div>

          {blocked ? (
            <div className="surface-danger rounded-[24px] px-4 py-4 text-sm leading-6">
              {blockedMessage || t('Authentication service is currently unreachable.')}
            </div>
          ) : null}

          {showAuthForm ? (
            <form onSubmit={handleAuthSubmit} className="space-y-5">
              <div>
                <label className="field-label">{t('CLI-Proxy URL')}</label>
                <input
                  type="text"
                  value={cliProxyUrl}
                  onChange={(event) => setCliProxyUrl(event.target.value)}
                  className="field-input"
                  placeholder="http://127.0.0.1:8317"
                  disabled={authLoading}
                  required
                />
                <p className="mt-2 text-xs faint-text">
                  {t('API Center verifies `/v0/management/config` directly before opening the dashboard.')}
                </p>
              </div>

              <div>
                <label className="field-label">{t('CLI-Proxy admin password')}</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  className="field-input"
                  placeholder={t('Enter the management password')}
                  autoComplete="current-password"
                  disabled={authLoading}
                  required
                />
              </div>

              {authError ? <p className="text-sm text-[var(--danger)]">{authError}</p> : null}

              <ActionButton type="submit" variant="primary" size="lg" loading={authLoading} icon={<InlineIcon name="check" />}>
                {authLoading ? t('Verifying...') : t('Verify and continue')}
              </ActionButton>
            </form>
          ) : null}

          {showSettingsForm ? (
            <form onSubmit={handleSettingsSubmit} className="space-y-5">
              {authRequired ? (
                <div className="surface-success rounded-[24px] px-4 py-4 text-sm leading-6">
                  {t('Management password verified. Save the local runtime settings below.')}
                </div>
              ) : null}

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
                  required
                />
                <p className="mt-2 text-xs faint-text">
                  {isEditingConfiguredSettings
                    ? t('Saving again will revalidate the management password before replacing the local config.')
                    : t('API Center validates the management endpoint again before saving the local config.')}
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

              <div>
                <label className="field-label">{t('OpenCode config directory (optional)')}</label>
                <input
                  type="text"
                  value={openCodeConfigPath}
                  onChange={(event) => setOpenCodeConfigPath(event.target.value)}
                  className="field-input"
                  placeholder={t('Example: C:\\Users\\you\\.config\\opencode')}
                />
              </div>

              {settingsError ? <p className="text-sm text-[var(--danger)]">{settingsError}</p> : null}

              <ActionButton type="submit" variant="primary" size="lg" loading={settingsLoading} icon={<InlineIcon name="spark" />}>
                {settingsLoading ? t('Saving...') : t('Enter API Center')}
              </ActionButton>
            </form>
          ) : null}
        </GlassPanel>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <InfoChip
          icon={<InlineIcon name="refresh" className="h-4 w-4" />}
          label={t('Sync')}
          value={t('Usage refresh stays configurable, so the dashboard can remain quiet or near real-time depending on your workflow.')}
        />
        <InfoChip
          icon={<InlineIcon name="codex" className="h-4 w-4" />}
          label={t('CodeX')}
          value={t('Account health, quota inspection, and clean-up actions stay available once the proxy is connected.')}
        />
        <InfoChip
          icon={<InlineIcon name="opencode" className="h-4 w-4" />}
          label={t('OpenCode')}
          value={t('Provider, model, agent, and category management appear automatically when an OpenCode config directory is configured.')}
        />
      </div>
    </AppShell>
  )
}
