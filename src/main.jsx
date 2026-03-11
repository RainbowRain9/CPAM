import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.jsx'
import SetupPage from './pages/SetupPage.jsx'
import CodexPage from './pages/CodexPage.jsx'
import OpenCodePage from './pages/OpenCodePage.jsx'
import { apiFetch, clearStoredAppAuth, subscribeToAuthChanges } from './auth.js'
import './index.css'

function Root() {
  const [authState, setAuthState] = useState({
    checked: false,
    authenticated: false,
    loginRequired: false,
    blocked: false,
    message: '',
  })
  const [configured, setConfigured] = useState(null)
  const [showSetup, setShowSetup] = useState(false)
  const [currentSettings, setCurrentSettings] = useState(null)
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
          openCodeConfigPath: data.openCodeConfigPath || ''
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

  if (!authState.checked || waitingForSettings) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-2 border-[#e5e5e5] border-t-[#0d0d0d] rounded-full animate-spin"></div>
      </div>
    )
  }

  if (authState.blocked || (authState.loginRequired && !authState.authenticated) || !configured || showSetup) {
    return (
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
    )
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col">
        <div className="flex-1">
          <Routes>
            <Route path="/" element={<App openCodeEnabled={!!currentSettings?.openCodeConfigPath} />} />
            <Route path="/codex" element={<CodexPage />} />
            {currentSettings?.openCodeConfigPath && (
              <Route path="/opencode" element={<OpenCodePage />} />
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <footer className="py-4 text-center">
          <div className="flex items-center justify-center">
            <button 
              onClick={() => setShowSetup(true)}
              className="text-xs text-[#acacac] hover:text-[#6e6e80] transition-colors"
            >
              重新设置
            </button>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
