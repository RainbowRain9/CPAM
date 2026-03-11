import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.jsx'
import SetupPage from './pages/SetupPage.jsx'
import CodexPage from './pages/CodexPage.jsx'
import OpenCodePage from './pages/OpenCodePage.jsx'
import './index.css'

function Root() {
  const [configured, setConfigured] = useState(null)
  const [showSetup, setShowSetup] = useState(false)
  const [currentSettings, setCurrentSettings] = useState(null)

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        setConfigured(data.configured)
        if (data.configured) {
          setCurrentSettings({
            cliProxyUrl: data.cliProxyUrl,
            syncInterval: data.syncInterval,
            openCodeConfigPath: data.openCodeConfigPath || ''
          })
        }
      })
      .catch(() => setConfigured(false))
  }, [])

  if (configured === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-2 border-[#e5e5e5] border-t-[#0d0d0d] rounded-full animate-spin"></div>
      </div>
    )
  }

  if (!configured || showSetup) {
    return (
      <SetupPage 
        initialSettings={currentSettings}
        onComplete={() => {
          setConfigured(true)
          setShowSetup(false)
          // 重新获取设置
          fetch('/api/settings')
            .then(res => res.json())
            .then(data => {
              if (data.configured) {
                setCurrentSettings({
                  cliProxyUrl: data.cliProxyUrl,
                  syncInterval: data.syncInterval,
                  openCodeConfigPath: data.openCodeConfigPath || ''
                })
              }
            })
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
          <button 
            onClick={() => setShowSetup(true)}
            className="text-xs text-[#acacac] hover:text-[#6e6e80] transition-colors"
          >
            重新设置
          </button>
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
