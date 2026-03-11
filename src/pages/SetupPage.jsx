import { useEffect, useState } from 'react'
import { apiFetch, saveStoredAppAuth } from '../auth.js'

const SYNC_INTERVALS = [
  { label: '1 分钟', value: 1 },
  { label: '3 分钟', value: 3 },
  { label: '5 分钟', value: 5 },
  { label: '10 分钟', value: 10 },
  { label: '30 分钟', value: 30 },
]

function SetupPage({
  onComplete,
  initialSettings,
  authRequired = false,
  authenticated = false,
  blocked = false,
  blockedMessage = '',
}) {
  const [loginPassword, setLoginPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [cliProxyUrl, setCliProxyUrl] = useState(initialSettings?.cliProxyUrl || 'http://localhost:8317')
  const [cliProxyKey, setCliProxyKey] = useState('')
  const [syncInterval, setSyncInterval] = useState(initialSettings?.syncInterval || 5)
  const [openCodeConfigPath, setOpenCodeConfigPath] = useState(initialSettings?.openCodeConfigPath || '')
  const [settingsError, setSettingsError] = useState('')
  const [settingsLoading, setSettingsLoading] = useState(false)

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

  const handleAuthSubmit = async (event) => {
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
        throw new Error(data.error || '验证失败')
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
      setAuthError(error.message || '验证失败')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleSettingsSubmit = async (event) => {
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
        throw new Error(data.error || '保存失败')
      }

      onComplete?.()
    } catch (error) {
      setSettingsError(error.message || '保存失败')
    } finally {
      setSettingsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-[#0d0d0d]">欢迎使用 API Center</h1>
          <p className="text-[#6e6e80] mt-2">
            {showAuthForm ? '请输入 CLI-Proxy 地址和管理密码' : '请配置 CLI-Proxy 连接信息'}
          </p>
        </div>

        {blocked && (
          <div className="p-4 rounded-lg border border-[#fecaca] bg-[#fef2f2] text-sm text-[#b91c1c]">
            {blockedMessage || '当前无法完成登录校验'}
          </div>
        )}

        {showAuthForm && (
          <form onSubmit={handleAuthSubmit} className="space-y-6">
            <div>
              <label className="block text-sm text-[#6e6e80] mb-2">CLI-Proxy 地址</label>
              <input
                type="text"
                value={cliProxyUrl}
                onChange={(event) => setCliProxyUrl(event.target.value)}
                className="w-full px-4 py-3 bg-white border border-[#e5e5e5] rounded-lg text-[#0d0d0d] focus:outline-none focus:border-[#0d0d0d]"
                placeholder="http://127.0.0.1:8317"
                disabled={authLoading}
                required
              />
              <p className="text-xs text-[#6e6e80] mt-2">
                会直接请求 `/v0/management/config` 校验管理密码。
              </p>
            </div>

            <div>
              <label className="block text-sm text-[#6e6e80] mb-2">CLI-Proxy 管理密码</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                className="w-full px-4 py-3 bg-white border border-[#e5e5e5] rounded-lg text-[#0d0d0d] focus:outline-none focus:border-[#0d0d0d]"
                placeholder="请输入 CLI-Proxy 管理密码"
                autoComplete="current-password"
                disabled={authLoading}
                required
              />
            </div>

            {authError && (
              <p className="text-[#ef4444] text-sm">{authError}</p>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 bg-[#0d0d0d] text-white rounded-lg font-medium hover:bg-[#2d2d2d] disabled:opacity-50 transition-colors"
            >
              {authLoading ? '验证中...' : '验证并继续'}
            </button>
          </form>
        )}

        {showSettingsForm && (
          <form onSubmit={handleSettingsSubmit} className="space-y-6">
            {authRequired && (
              <div className="p-4 rounded-lg border border-[#e0f2fe] bg-[#f0f9ff] text-sm text-[#0369a1]">
                已通过 CLI-Proxy 管理密码验证，下面保存本地配置。
              </div>
            )}

            <div>
              <label className="block text-sm text-[#6e6e80] mb-2">CLI-Proxy 地址</label>
              <input
                type="text"
                value={cliProxyUrl}
                onChange={(event) => setCliProxyUrl(event.target.value)}
                className="w-full px-4 py-3 bg-white border border-[#e5e5e5] rounded-lg text-[#0d0d0d] focus:outline-none focus:border-[#0d0d0d]"
                placeholder="http://localhost:8317"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-[#6e6e80] mb-2">CLI-Proxy 管理密码</label>
              <input
                type="password"
                value={cliProxyKey}
                onChange={(event) => setCliProxyKey(event.target.value)}
                className="w-full px-4 py-3 bg-white border border-[#e5e5e5] rounded-lg text-[#0d0d0d] focus:outline-none focus:border-[#0d0d0d]"
                placeholder="请输入 CLI-Proxy 管理密码"
                required
              />
              <p className="text-xs text-[#6e6e80] mt-2">
                {isEditingConfiguredSettings
                  ? '重新保存时会再次校验管理密码。'
                  : '保存前会再次请求 CLI-Proxy 管理接口校验。'}
              </p>
            </div>

            <div>
              <label className="block text-sm text-[#6e6e80] mb-2">数据同步间隔</label>
              <div className="flex flex-wrap gap-2">
                {SYNC_INTERVALS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setSyncInterval(item.value)}
                    className={`px-4 py-2 rounded-lg border transition-colors ${
                      syncInterval === item.value
                        ? 'bg-[#0d0d0d] text-white border-[#0d0d0d]'
                        : 'bg-white text-[#0d0d0d] border-[#e5e5e5] hover:border-[#0d0d0d]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm text-[#6e6e80] mb-2">
                OpenCode 配置目录 <span className="text-xs text-[#acacac]">(可选)</span>
              </label>
              <input
                type="text"
                value={openCodeConfigPath}
                onChange={(event) => setOpenCodeConfigPath(event.target.value)}
                className="w-full px-4 py-3 bg-white border border-[#e5e5e5] rounded-lg text-[#0d0d0d] focus:outline-none focus:border-[#0d0d0d]"
                placeholder="如 C:\\Users\\你的用户名\\.config\\opencode"
              />
            </div>

            {settingsError && (
              <p className="text-[#ef4444] text-sm">{settingsError}</p>
            )}

            <button
              type="submit"
              disabled={settingsLoading}
              className="w-full py-3 bg-[#0d0d0d] text-white rounded-lg font-medium hover:bg-[#2d2d2d] disabled:opacity-50 transition-colors"
            >
              {settingsLoading ? '保存中...' : '开始使用'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default SetupPage
