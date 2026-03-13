import { useMemo, useState } from 'react'
import { apiFetch, notifyAuthChanged } from '../auth.js'
import { ActionButton, AppShell, GlassPanel, InlineIcon } from '../components/ui'
import { useI18n } from '../i18n/useI18n'

type LoginPageProps = {
  blocked?: boolean
  blockedMessage?: string
  onComplete?: () => void | Promise<void>
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

export default function LoginPage({
  blocked = false,
  blockedMessage = '',
  onComplete,
}: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { t } = useI18n()

  const meta = useMemo(() => (
    <>
      <span className="chip">{t('Local admin')}</span>
      <span className="chip">{t('7-day rolling session')}</span>
      <span className="chip">{t('Revocable access')}</span>
    </>
  ), [t])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (blocked) {
      return
    }

    setError('')
    setLoading(true)

    try {
      const response = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || t('Login failed'))
      }

      notifyAuthChanged()
      await onComplete?.()
    } catch (submitError) {
      setError((submitError as Error).message || t('Login failed'))
    } finally {
      setLoading(false)
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
                {t('Administrator login')}
              </h1>
              <p className="mt-3 text-sm leading-6 muted-text">
                {t('Sign in with the local administrator account. CLI-Proxy credentials are configured separately after login.')}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {meta}
              </div>
            </div>
            <div className="chip">{blocked ? t('Blocked') : t('Ready')}</div>
          </div>

          {blocked ? (
            <div className="surface-danger mb-5 rounded-[24px] px-4 py-4 text-sm leading-6">
              {blockedMessage || t('Too many failed login attempts. Please wait and try again.')}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="field-label">{t('Username')}</label>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="field-input"
                autoComplete="username"
                required
              />
            </div>

            <div>
              <label className="field-label">{t('Password')}</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="field-input"
                autoComplete="current-password"
                required
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <InfoChip
                icon={<InlineIcon name="check" className="h-4 w-4" />}
                label={t('Session cookie')}
                value={t('The browser only stores an HttpOnly session cookie. No login token is kept in localStorage.')}
              />
              <InfoChip
                icon={<InlineIcon name="spark" className="h-4 w-4" />}
                label={t('Runtime config')}
                value={t('After login you can manage CLI-Proxy settings separately without coupling them to app authentication.')}
              />
            </div>

            {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

            <ActionButton type="submit" variant="primary" size="lg" loading={loading} icon={<InlineIcon name="check" />}>
              {loading ? t('Signing in...') : t('Sign in')}
            </ActionButton>
          </form>
        </GlassPanel>
      </div>
    </AppShell>
  )
}
