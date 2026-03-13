import { useMemo, useState } from 'react'
import { apiFetch, notifyAuthChanged } from '../auth.js'
import { ActionButton, AppShell, GlassPanel, InlineIcon } from '../components/ui'
import { useI18n } from '../i18n/useI18n'

type BootstrapAdminPageProps = {
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

export default function BootstrapAdminPage({ onComplete }: BootstrapAdminPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { t } = useI18n()

  const meta = useMemo(() => (
    <>
      <span className="chip">{t('Single admin')}</span>
      <span className="chip">{t('Cookie session')}</span>
      <span className="chip">{t('SQLite backed')}</span>
    </>
  ), [t])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await apiFetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          confirmPassword,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || t('Bootstrap failed'))
      }

      notifyAuthChanged()
      await onComplete?.()
    } catch (submitError) {
      setError((submitError as Error).message || t('Bootstrap failed'))
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
                {t('Create admin account')}
              </h1>
              <p className="mt-3 text-sm leading-6 muted-text">
                {t('Create the first local administrator. CLI-Proxy settings are configured after login.')}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {meta}
              </div>
            </div>
            <div className="chip">{t('First run')}</div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="field-label">{t('Username')}</label>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="field-input"
                autoComplete="username"
                placeholder="admin"
                required
              />
              <p className="mt-2 text-xs faint-text">
                {t('Use 3 to 32 characters: letters, numbers, dot, underscore, or hyphen.')}
              </p>
            </div>

            <div>
              <label className="field-label">{t('Password')}</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="field-input"
                autoComplete="new-password"
                placeholder={t('At least 12 characters')}
                required
              />
            </div>

            <div>
              <label className="field-label">{t('Confirm password')}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="field-input"
                autoComplete="new-password"
                placeholder={t('Re-enter the password')}
                required
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <InfoChip
                icon={<InlineIcon name="check" className="h-4 w-4" />}
                label={t('Session')}
                value={t('A revocable HttpOnly cookie is created immediately after bootstrap.')}
              />
              <InfoChip
                icon={<InlineIcon name="edit" className="h-4 w-4" />}
                label={t('Password reset')}
                value={t('If you forget the password later, use the local reset script instead of the web UI.')}
              />
            </div>

            {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

            <ActionButton type="submit" variant="primary" size="lg" loading={loading} icon={<InlineIcon name="check" />}>
              {loading ? t('Creating...') : t('Create admin and sign in')}
            </ActionButton>
          </form>
        </GlassPanel>
      </div>
    </AppShell>
  )
}
