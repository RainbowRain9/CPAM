import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { apiFetch, notifyAuthChanged, subscribeToAuthChanges } from './auth.js'
import type { CpaInstance } from './cpaInstances'
import { fetchCpaInstances } from './cpaInstances'
import { I18nProvider } from './i18n/I18nProvider'
import { useI18n } from './i18n/useI18n'
import { ActionButton, AppShell } from './components/ui'
import { ThemeProvider } from './theme/ThemeProvider'

const DashboardPage = lazy(() => import('./App'))
const BootstrapAdminPage = lazy(() => import('./pages/BootstrapAdminPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const SetupPage = lazy(() => import('./pages/SetupPage'))
const CodexPage = lazy(() => import('./pages/CodexPage'))

type AuthState = {
  checked: boolean
  bootstrapRequired: boolean
  authenticated: boolean
  loginRequired: boolean
  blocked: boolean
  message: string
  user: {
    username: string
  } | null
}

function LoadingScreen() {
  const { t } = useI18n()

  return (
    <AppShell showNav={false} subduedParticles>
      <div className="flex min-h-[72vh] items-center justify-center">
        <div className="surface-panel flex min-w-[220px] flex-col items-center gap-4 rounded-[28px] px-8 py-10 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--border-color)] border-t-[var(--text-primary)]" />
          <p className="text-sm muted-text">{t('Loading...')}</p>
        </div>
      </div>
    </AppShell>
  )
}

function RootContent() {
  const { t } = useI18n()
  const [authState, setAuthState] = useState<AuthState>({
    checked: false,
    bootstrapRequired: false,
    authenticated: false,
    loginRequired: false,
    blocked: false,
    message: '',
    user: null,
  })
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [instances, setInstances] = useState<CpaInstance[]>([])

  const waitingForInstances =
    authState.checked &&
    !authState.bootstrapRequired &&
    authState.authenticated &&
    configured === null

  const fetchAuthStatus = async () => {
    try {
      const response = await apiFetch('/api/auth/status')
      const data = await response.json().catch(() => ({}))

      const nextAuthState = {
        checked: true,
        bootstrapRequired: Boolean(data.bootstrapRequired),
        authenticated: Boolean(data.authenticated),
        loginRequired: Boolean(data.loginRequired),
        blocked: Boolean(data.blocked),
        message: data.message || '',
        user: data.user?.username ? { username: data.user.username } : null,
      }

      setAuthState(nextAuthState)
      return nextAuthState
    } catch {
      const fallbackState = {
        checked: true,
        bootstrapRequired: false,
        authenticated: false,
        loginRequired: true,
        blocked: true,
        message: t('Authentication service is currently unreachable.'),
        user: null,
      }
      setAuthState(fallbackState)
      return fallbackState
    }
  }

  const fetchInstances = async () => {
    try {
      const nextInstances = await fetchCpaInstances()
      setInstances(nextInstances)
      setConfigured(nextInstances.some((instance) => instance.isEnabled))
      return nextInstances
    } catch (error) {
      if ((error as Error & { status?: number }).status === 401) {
        setConfigured(null)
        setInstances([])
        return null
      }

      setConfigured(false)
      setInstances([])
      return null
    }
  }

  const refreshAppState = async () => {
    const nextAuthState = await fetchAuthStatus()
    if (nextAuthState.bootstrapRequired || !nextAuthState.authenticated) {
      setConfigured(null)
      setInstances([])
      setShowSetup(false)
      return
    }

    await fetchInstances()
  }

  useEffect(() => {
    void refreshAppState()
    const unsubscribe = subscribeToAuthChanges(() => {
      void refreshAppState()
    })
    return unsubscribe
  }, [])

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // ignore transport failure and still refresh local auth state
    } finally {
      setShowSetup(false)
      notifyAuthChanged()
    }
  }

  const footer = useMemo(() => {
    if (!authState.authenticated) {
      return null
    }

    return (
      <div className="px-2 pb-4 text-center">
        <p className="mb-3 text-xs faint-text">
          {t('Signed in as {username}', { username: authState.user?.username || '' })}
        </p>
        <div className="flex justify-center gap-2">
          <ActionButton size="sm" variant="ghost" onClick={() => setShowSetup(true)}>
            {t('Open setup')}
          </ActionButton>
          <ActionButton size="sm" variant="ghost" onClick={() => void handleLogout()}>
            {t('Sign out')}
          </ActionButton>
        </div>
      </div>
    )
  }, [authState.authenticated, authState.user?.username, t])

  if (!authState.checked || waitingForInstances) {
    return <LoadingScreen />
  }

  if (authState.bootstrapRequired) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <BootstrapAdminPage onComplete={refreshAppState} />
      </Suspense>
    )
  }

  if (!authState.authenticated) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <LoginPage blocked={authState.blocked} blockedMessage={authState.message} onComplete={refreshAppState} />
      </Suspense>
    )
  }

  if (!configured || showSetup) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <SetupPage
          instances={instances}
          onComplete={async () => {
            setShowSetup(false)
            await fetchInstances()
          }}
          onCancel={configured ? () => setShowSetup(false) : undefined}
          onLogout={handleLogout}
        />
      </Suspense>
    )
  }

  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="min-h-screen">
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/codex" element={<CodexPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        {footer}
      </div>
    </HashRouter>
  )
}

export function RootApp() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <RootContent />
      </I18nProvider>
    </ThemeProvider>
  )
}
