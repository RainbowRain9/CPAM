import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { apiFetch, clearStoredAppAuth, subscribeToAuthChanges } from './auth.js'
import { I18nProvider } from './i18n/I18nProvider'
import { useI18n } from './i18n/useI18n'
import { ActionButton, AppShell } from './components/ui'
import { ThemeProvider } from './theme/ThemeProvider'

const DashboardPage = lazy(() => import('./App'))
const SetupPage = lazy(() => import('./pages/SetupPage'))
const CodexPage = lazy(() => import('./pages/CodexPage'))
const OpenCodePage = lazy(() => import('./pages/OpenCodePage'))

type AuthState = {
  checked: boolean
  authenticated: boolean
  loginRequired: boolean
  blocked: boolean
  message: string
}

type SettingsState = {
  cliProxyUrl: string
  syncInterval: number
  openCodeConfigPath: string
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
  const [authState, setAuthState] = useState<AuthState>({
    checked: false,
    authenticated: false,
    loginRequired: false,
    blocked: false,
    message: '',
  })
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [currentSettings, setCurrentSettings] = useState<SettingsState | null>(null)
  const { t } = useI18n()

  const waitingForSettings =
    authState.checked &&
    !authState.blocked &&
    (!authState.loginRequired || authState.authenticated) &&
    configured === null

  const fetchAuthStatus = async () => {
    try {
      const response = await apiFetch('/api/auth/status')
      const data = await response.json().catch(() => ({}))
      const nextAuthState = {
        checked: true,
        authenticated: Boolean(data.authenticated),
        loginRequired: Boolean(data.loginRequired),
        blocked: Boolean(data.blocked),
        message: data.message || '',
      }
      if (nextAuthState.loginRequired && !nextAuthState.authenticated) {
        clearStoredAppAuth({ silent: true })
      }
      setAuthState(nextAuthState)
      return nextAuthState
    } catch {
      const fallbackState = {
        checked: true,
        authenticated: false,
        loginRequired: true,
        blocked: true,
        message: '无法连接认证服务，请检查服务端是否正常运行。',
      }
      setAuthState(fallbackState)
      return fallbackState
    }
  }

  const fetchSettings = async () => {
    try {
      const response = await apiFetch('/api/settings')
      if (response.status === 401) {
        setAuthState((prev) => ({ ...prev, authenticated: false, checked: true }))
        setConfigured(null)
        setCurrentSettings(null)
        return null
      }

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || '获取设置失败')
      }

      setConfigured(Boolean(data.configured))
      if (data.configured) {
        setCurrentSettings({
          cliProxyUrl: data.cliProxyUrl,
          syncInterval: data.syncInterval,
          openCodeConfigPath: data.openCodeConfigPath || '',
        })
      } else {
        setCurrentSettings(null)
      }

      return data
    } catch {
      setConfigured(false)
      setCurrentSettings(null)
      return null
    }
  }

  const refreshAppState = async () => {
    const nextAuthState = await fetchAuthStatus()
    if (nextAuthState.blocked) {
      setConfigured(null)
      setCurrentSettings(null)
      return
    }
    if (nextAuthState.loginRequired && !nextAuthState.authenticated) {
      setConfigured(null)
      setCurrentSettings(null)
      return
    }
    await fetchSettings()
  }

  useEffect(() => {
    refreshAppState()
    const unsubscribe = subscribeToAuthChanges(() => {
      refreshAppState()
    })
    return unsubscribe
  }, [])

  const footer = useMemo(() => (
    <div className="px-2 pb-4 text-center">
      <ActionButton size="sm" variant="ghost" onClick={() => setShowSetup(true)}>
        {t('Open setup')}
      </ActionButton>
    </div>
  ), [t])

  if (!authState.checked || waitingForSettings) {
    return <LoadingScreen />
  }

  if (authState.blocked || (authState.loginRequired && !authState.authenticated) || !configured || showSetup) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <SetupPage
          initialSettings={currentSettings}
          authRequired={authState.loginRequired}
          authenticated={authState.authenticated}
          blocked={authState.blocked}
          blockedMessage={authState.message}
          onComplete={async () => {
            setConfigured(true)
            setShowSetup(false)
            await fetchSettings()
          }}
        />
      </Suspense>
    )
  }

  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="min-h-screen">
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<DashboardPage openCodeEnabled={!!currentSettings?.openCodeConfigPath} />} />
            <Route path="/codex" element={<CodexPage openCodeEnabled={!!currentSettings?.openCodeConfigPath} />} />
            {currentSettings?.openCodeConfigPath && (
              <Route path="/opencode" element={<OpenCodePage openCodeEnabled />} />
            )}
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
