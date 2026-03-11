import { useEffect, useState } from 'react'
import { apiFetch, saveStoredAppAuth } from '../auth.js'

const SYNC_INTERVALS = [
  { label: '1 分钟', value: 1 },
  { label: '3 分钟', value: 3 },
  { label: '5 分钟', value: 5 },
  { label: '10 分钟', value: 10 },
  { label: '30 分钟', value: 30 },
]

function EyeIcon({ open }) {
  if (open) {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 3l18 18" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M10.6 10.6a2 2 0 102.8 2.8" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9.88 5.09A9.77 9.77 0 0112 4.8c4.6 0 8.33 3 9.5 7.2a10.3 10.3 0 01-2.64 4.38M6.23 6.23A10.44 10.44 0 002.5 12c.6 2.17 1.9 4 3.65 5.27A9.76 9.76 0 0012 19.2c1.58 0 3.08-.36 4.42-1" />
      </svg>
    )
  }

  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M2.5 12C3.67 7.8 7.4 4.8 12 4.8s8.33 3 9.5 7.2c-1.17 4.2-4.9 7.2-9.5 7.2S3.67 16.2 2.5 12z" />
      <circle cx="12" cy="12" r="3" strokeWidth="1.6" />
    </svg>
  )
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
  autoComplete = 'current-password',
  helper = '',
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-[#121212]">{label}</label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          className="w-full rounded-2xl border border-[#dedede] bg-white px-4 py-3 pr-12 text-[#121212] outline-none transition focus:border-[#121212]"
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          required
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 flex items-center px-4 text-[#7a7a85] transition hover:text-[#121212]"
          aria-label={visible ? '隐藏密码' : '显示密码'}
          title={visible ? '隐藏密码' : '显示密码'}
        >
          <EyeIcon open={visible} />
        </button>
      </div>
      {helper && <p className="text-xs text-[#7a7a85]">{helper}</p>}
    </div>
  )
}

function SetupPage({
  onComplete,
  initialSettings,
  authRequired = false,
  authenticated = false,
  blocked = false,
  blockedMessage = '',
}) {
  const [adminPassword, setAdminPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [cliProxyUrl, setCliProxyUrl] = useState(initialSettings?.cliProxyUrl || 'http://localhost:8317')
  const [cliProxyKey, setCliProxyKey] = useState('')
  const [syncInterval, setSyncInterval] = useState(initialSettings?.syncInterval || 5)
  const [openCodeConfigPath, setOpenCodeConfigPath] = useState(initialSettings?.openCodeConfigPath || '')
  const [settingsError, setSettingsError] = useState('')
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(Boolean(initialSettings?.openCodeConfigPath))

  const showAuthForm = !blocked && authRequired && !authenticated
  const showSettingsForm = !blocked && (!authRequired || authenticated)
  const isEditingConfiguredSettings = Boolean(initialSettings?.cliProxyUrl)

  useEffect(() => {
    if (initialSettings) {
      if (initialSettings.cliProxyUrl) setCliProxyUrl(initialSettings.cliProxyUrl)
      if (initialSettings.syncInterval) setSyncInterval(initialSettings.syncInterval)
      if (initialSettings.openCodeConfigPath !== undefined) setOpenCodeConfigPath(initialSettings.openCodeConfigPath)
      if (initialSettings.openCodeConfigPath) setShowAdvanced(true)
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
        body: JSON.stringify({ password: adminPassword }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || '验证失败')
      }

      saveStoredAppAuth({
        token: data.token,
        expiresAt: data.expiresAt,
      })
      setAdminPassword('')
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
      const res = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliProxyUrl, cliProxyKey, syncInterval, openCodeConfigPath }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        onComplete?.()
      } else {
        setSettingsError(data.error || '保存失败')
      }
    } catch (error) {
      setSettingsError('连接失败: ' + error.message)
    } finally {
      setSettingsLoading(false)
    }
  }

  const title = showAuthForm ? '访问验证' : '连接 CLI-Proxy'
  const subtitle = blocked
    ? '站点已锁定，请先完成服务端管理员密码配置'
    : showAuthForm
      ? '输入站点访问密码后继续'
      : '输入 CLI-Proxy 管理密码，提交时会先校验管理接口再保存'

  const primaryButtonText = showAuthForm
    ? (authLoading ? '验证中...' : '验证并继续')
    : isEditingConfiguredSettings
      ? (settingsLoading ? '校验中...' : '校验并保存')
      : (settingsLoading ? '校验中...' : '校验并开始使用')

  return (
    <div className="min-h-screen bg-[#f7f7f8] lg:flex">
      <aside className="hidden lg:flex lg:w-[48%] bg-[#050505] text-white">
        <div className="flex w-full items-center justify-center px-12">
          <div className="w-full max-w-[640px] text-right leading-none select-none">
            <div className="text-[12vw] font-black tracking-[-0.08em] text-white/95">CLI</div>
            <div className="text-[12vw] font-black tracking-[-0.08em] text-white/70">PROXY</div>
            <div className="text-[12vw] font-black tracking-[-0.08em] text-white/45">API</div>
          </div>
        </div>
      </aside>

      <main className="flex min-h-screen flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-[430px]">
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-[#111111] text-sm font-semibold tracking-[0.28em] text-white shadow-[0_20px_40px_rgba(0,0,0,0.16)]">
              AC
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#8e8ea0]">API Center</p>
              <h1 className="mt-1 text-[28px] font-black tracking-[-0.04em] text-[#121212]">欢迎使用 API Center</h1>
            </div>
          </div>

          <section className="rounded-[28px] border border-[#e3e3e3] bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] sm:p-7">
            <div className="space-y-2 text-center">
              <h2 className="text-[24px] font-black tracking-[-0.04em] text-[#121212]">{title}</h2>
              <p className="text-sm leading-6 text-[#6e6e80]">{subtitle}</p>
            </div>

            {blocked && (
              <div className="mt-6 rounded-2xl border border-[#fecaca] bg-[#fff1f2] px-4 py-4 text-sm text-[#b91c1c]">
                <p>{blockedMessage || '服务端尚未配置站点访问密码'}</p>
                <p className="mt-2 text-xs text-[#9f1239]">
                  请先在服务端设置 `API_CENTER_ADMIN_PASSWORD`，再重新启动当前服务。
                </p>
              </div>
            )}

            {showAuthForm && (
              <form onSubmit={handleAuthSubmit} className="mt-6 space-y-5">
                <div className="rounded-2xl border border-dashed border-[#d6d6dc] bg-[#f7f7f8] px-4 py-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8e8ea0]">Access</div>
                  <div className="mt-2 text-base font-semibold text-[#121212]">当前站点已开启访问保护</div>
                  <p className="mt-1 text-xs leading-5 text-[#6e6e80]">
                    登录状态只保存在当前浏览器，其他访问者仍需单独输入站点访问密码。
                  </p>
                </div>

                <PasswordField
                  label="站点访问密码"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  placeholder="请输入服务器配置的访问密码"
                  disabled={authLoading}
                />

                {authError && (
                  <div className="rounded-2xl border border-[#fecaca] bg-[#fff1f2] px-4 py-3 text-sm text-[#b91c1c]">
                    {authError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full rounded-2xl bg-[#111111] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#262626] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {primaryButtonText}
                </button>
              </form>
            )}

            {showSettingsForm && (
              <form onSubmit={handleSettingsSubmit} className="mt-6 space-y-5">
                <div className="rounded-2xl border border-dashed border-[#d6d6dc] bg-[#f7f7f8] px-4 py-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8e8ea0]">Connection</div>
                  <div className="mt-2 break-all text-base font-semibold text-[#121212]">{cliProxyUrl || 'http://localhost:8317'}</div>
                  <p className="mt-1 text-xs leading-5 text-[#6e6e80]">
                    将请求 `CLI-Proxy /v0/management` 接口验证管理密码，通过后才会保存配置。
                  </p>
                </div>

                {authRequired && (
                  <div className="rounded-2xl border border-[#dbeafe] bg-[#eff6ff] px-4 py-3 text-sm text-[#1d4ed8]">
                    已通过站点访问验证。下面这一步会继续校验 CLI-Proxy 管理密码。
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[#121212]">CLI-Proxy 地址</label>
                  <input
                    type="text"
                    value={cliProxyUrl}
                    onChange={(event) => setCliProxyUrl(event.target.value)}
                    className="w-full rounded-2xl border border-[#dedede] bg-white px-4 py-3 text-[#121212] outline-none transition focus:border-[#121212]"
                    placeholder="http://localhost:8317"
                    required
                  />
                  <p className="text-xs text-[#7a7a85]">请输入可访问的 CLI-Proxy 根地址，不需要手动加 `/v0/management`。</p>
                </div>

                <PasswordField
                  label="CLI-Proxy 管理密码"
                  value={cliProxyKey}
                  onChange={(event) => setCliProxyKey(event.target.value)}
                  placeholder="请输入 CLI-Proxy 管理密码"
                  disabled={settingsLoading}
                  helper={
                    isEditingConfiguredSettings
                      ? '出于安全原因，已保存的管理密码不会回显；重新保存时请再次输入。'
                      : '提交后会立即调用 CLI-Proxy 管理接口校验该密码。'
                  }
                />

                <div className="rounded-2xl border border-[#ececf1] bg-[#fbfbfc] px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((current) => !current)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <span className="text-sm font-semibold text-[#121212]">更多设置</span>
                    <span className="text-xs font-medium text-[#6e6e80]">{showAdvanced ? '收起' : '展开'}</span>
                  </button>

                  {showAdvanced && (
                    <div className="mt-4 space-y-5 border-t border-[#ececf1] pt-4">
                      <div>
                        <label className="block text-sm font-medium text-[#121212]">数据同步间隔</label>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {SYNC_INTERVALS.map((item) => (
                            <button
                              key={item.value}
                              type="button"
                              onClick={() => setSyncInterval(item.value)}
                              className={`rounded-full border px-4 py-2 text-sm transition ${
                                syncInterval === item.value
                                  ? 'border-[#111111] bg-[#111111] text-white'
                                  : 'border-[#d9d9df] bg-white text-[#121212] hover:border-[#121212]'
                              }`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                        <p className="mt-2 text-xs text-[#7a7a85]">控制从 CLI-Proxy 拉取统计数据的频率。</p>
                      </div>

                      <div className="space-y-2">
                        <label className="block text-sm font-medium text-[#121212]">
                          OpenCode 配置目录 <span className="text-xs font-normal text-[#8e8ea0]">(可选)</span>
                        </label>
                        <input
                          type="text"
                          value={openCodeConfigPath}
                          onChange={(event) => setOpenCodeConfigPath(event.target.value)}
                          className="w-full rounded-2xl border border-[#dedede] bg-white px-4 py-3 text-[#121212] outline-none transition focus:border-[#121212]"
                          placeholder="如 C:\\Users\\你的用户名\\.config\\opencode"
                        />
                        <p className="text-xs text-[#7a7a85]">填写后可在主页直接管理 OpenCode 的模型和提供商配置。</p>
                      </div>
                    </div>
                  )}
                </div>

                {settingsError && (
                  <div className="rounded-2xl border border-[#fecaca] bg-[#fff1f2] px-4 py-3 text-sm text-[#b91c1c]">
                    {settingsError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={settingsLoading}
                  className="w-full rounded-2xl bg-[#111111] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#262626] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {primaryButtonText}
                </button>
              </form>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

export default SetupPage
