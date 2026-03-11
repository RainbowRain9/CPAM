import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../auth.js'

const ITEMS_PER_PAGE = 12 // 3列 x 4行

function formatQuotaResetAt(resetAt) {
  if (!resetAt) return '未返回时间'

  const date = new Date(resetAt * 1000)
  if (Number.isNaN(date.getTime())) return '时间无效'

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function getQuotaTone(percent) {
  if (!Number.isFinite(percent)) {
    return {
      text: 'text-[#94a3b8]',
      bar: 'bg-[#cbd5e1]',
      border: 'border-[#e2e8f0]',
      bg: 'bg-[#f8fafc]',
    }
  }

  if (percent > 50) {
    return {
      text: 'text-[#15803d]',
      bar: 'bg-[#10a37f]',
      border: 'border-[#bbf7d0]',
      bg: 'bg-[#f0fdf4]',
    }
  }

  if (percent > 20) {
    return {
      text: 'text-[#b45309]',
      bar: 'bg-[#f59e0b]',
      border: 'border-[#fed7aa]',
      bg: 'bg-[#fff7ed]',
    }
  }

  return {
    text: 'text-[#dc2626]',
    bar: 'bg-[#ef4444]',
    border: 'border-[#fecaca]',
    bg: 'bg-[#fef2f2]',
  }
}

function getLegacyQuotaWindow(account) {
  if (account?.quota === undefined && account?.usedPercent === undefined && !account?.resetAt) {
    return null
  }

  return {
    remainingPercent: account.quota,
    usedPercent: account.usedPercent,
    resetAt: account.resetAt,
  }
}

function getFiveHourQuotaWindow(account) {
  return account?.fiveHourWindow || getLegacyQuotaWindow(account)
}

function getWeeklyQuotaWindow(account) {
  return account?.weeklyWindow || null
}

function QuotaWindowCard({ title, windowData }) {
  const remainingPercent = Number.isFinite(Number(windowData?.remainingPercent))
    ? Math.max(0, Math.min(100, Number(windowData.remainingPercent)))
    : null
  const tone = getQuotaTone(remainingPercent)

  return (
    <div className={`rounded-lg border px-3 py-3 ${tone.border} ${tone.bg}`}>
      <p className="text-[11px] text-[#6e6e80]">{title}</p>
      <div className="flex items-end justify-between mt-1">
        <span className={`text-lg font-semibold leading-none ${tone.text}`}>
          {remainingPercent !== null ? `${Math.round(remainingPercent)}%` : '--'}
        </span>
        <span className="text-[10px] text-[#8e8ea0]">
          {remainingPercent !== null ? '剩余' : '未检查'}
        </span>
      </div>
      <div className="h-1.5 bg-white/80 rounded-full overflow-hidden mt-3">
        <div
          className={`h-full rounded-full transition-all ${tone.bar}`}
          style={{ width: `${remainingPercent ?? 0}%` }}
        />
      </div>
      <p className="text-[10px] text-[#8e8ea0] mt-2">
        {windowData?.resetAt ? formatQuotaResetAt(windowData.resetAt) : '检查配额后显示'}
      </p>
    </div>
  )
}

function CodexPage() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [checkingQuota, setCheckingQuota] = useState(false)
  const [results, setResults] = useState(null)
  const [page, setPage] = useState(1)
  const [showQuotaModal, setShowQuotaModal] = useState(false)
  const [showStatusResult, setShowStatusResult] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [showCleanModal, setShowCleanModal] = useState(false)
  const [cleanThreshold, setCleanThreshold] = useState({ quota: 20, days: 5 })

  const fetchAccounts = async () => {
    try {
      const res = await apiFetch('/api/codex/accounts')
      if (res.ok) {
        const data = await res.json()
        setAccounts(data)
      }
    } catch (e) {
      console.error('获取账号失败:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAccounts()
  }, [])

  const handleCheckStatus = async () => {
    setCheckingStatus(true)
    setResults(null)

    try {
      const res = await apiFetch('/api/codex/check', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setResults({ type: 'status', ...data })
        // 更新账号列表中的状态信息
        if (data.invalidAccounts) {
          const invalidEmails = new Set(data.invalidAccounts.map(a => a.email))
          setAccounts(prev => prev.map(acc => ({
            ...acc,
            checkStatus: invalidEmails.has(acc.email) ? 'invalid' : 'valid'
          })))
        }
        // 显示结果弹窗
        setShowStatusResult({
          valid: data.valid || 0,
          invalid: data.invalid || 0,
          invalidAccounts: data.invalidAccounts || []
        })
      }
    } catch (e) {
      console.error('检查失败:', e)
    } finally {
      setCheckingStatus(false)
    }
  }

  // 获取已查配额的账号中符合清除条件的
  // 条件：配额低于阈值 且 距离刷新时间大于阈值天数（配额低且恢复慢的账号没用）
  const getCleanableAccounts = () => {
    const now = Date.now() / 1000
    const thresholdSeconds = cleanThreshold.days * 24 * 60 * 60
    return accounts.filter(acc => {
      const weeklyWindow = getWeeklyQuotaWindow(acc)
      const weeklyQuota = weeklyWindow?.remainingPercent
      const weeklyResetAt = weeklyWindow?.resetAt

      if (!Number.isFinite(Number(weeklyQuota))) return false // 未查周限额的不处理
      if (Number(weeklyQuota) > cleanThreshold.quota) return false // 配额高于阈值不清除
      if (!weeklyResetAt) return false
      const resetInSeconds = weeklyResetAt - now
      // 距离刷新时间大于阈值天数才清除（配额低且恢复慢）
      return resetInSeconds > thresholdSeconds
    })
  }

  const handleCleanLowQuota = async () => {
    const toClean = getCleanableAccounts()
    if (toClean.length === 0) return
    
    setDeleting(true)
    try {
      // 需要获取这些账号的name来删除
      const authIndexes = toClean.map(a => a.authIndex)
      const res = await apiFetch('/api/codex/delete-by-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authIndexes })
      })
      if (res.ok) {
        const data = await res.json()
        setShowCleanModal(false)
        fetchAccounts()
        setResults({ type: 'clean', deleted: data.deleted })
      }
    } catch (e) {
      console.error('清除失败:', e)
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteInvalid = async () => {
    if (!showStatusResult?.invalidAccounts?.length) return
    setDeleting(true)
    
    try {
      const names = showStatusResult.invalidAccounts.map(a => a.name).filter(Boolean)
      const res = await apiFetch('/api/codex/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names })
      })
      if (res.ok) {
        const data = await res.json()
        setShowStatusResult(null)
        fetchAccounts()
        setResults({ type: 'delete', deleted: data.deleted })
      }
    } catch (e) {
      console.error('删除失败:', e)
    } finally {
      setDeleting(false)
    }
  }

  const handleCheckQuota = async (pageCount) => {
    setShowQuotaModal(false)
    setCheckingQuota(true)
    setResults(null)

    // 计算要检查的账号范围
    let startIdx, endIdx
    if (pageCount === 'all') {
      startIdx = 0
      endIdx = accounts.length
    } else {
      const pages = parseInt(pageCount)
      startIdx = (page - 1) * ITEMS_PER_PAGE
      endIdx = Math.min(startIdx + pages * ITEMS_PER_PAGE, accounts.length)
    }
    
    const authIndexes = accounts.slice(startIdx, endIdx).map(a => a.authIndex).filter(Boolean)
    console.log(`检查配额: 页码${page}, 范围${startIdx}-${endIdx}, 共${authIndexes.length}个账号`)

    try {
      const res = await apiFetch('/api/codex/quota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authIndexes })
      })
      if (res.ok) {
        const data = await res.json()
        setResults({ type: 'quota', ...data })
        // 更新账号列表中的配额信息
        if (data.quotas) {
          setAccounts(prev => prev.map(acc => {
            const quota = data.quotas.find(q => q.authIndex === acc.authIndex)
            return quota ? { 
              ...acc, 
              quota: quota.completionQuota,
              usedPercent: quota.usedPercent,
              resetAt: quota.resetAt,
              fiveHourWindow: quota.fiveHourWindow || null,
              weeklyWindow: quota.weeklyWindow || null
            } : acc
          }))
        }
      }
    } catch (e) {
      console.error('检查配额失败:', e)
    } finally {
      setCheckingQuota(false)
    }
  }

  return (
    <div className="min-h-screen pt-10 pb-20 px-6 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <Link 
            to="/" 
            className="text-[#6e6e80] hover:text-[#0d0d0d] flex items-center gap-2 mb-4 transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            返回统计
          </Link>
          <h1 className="text-3xl font-semibold text-[#0d0d0d]">CodeX 账号管理</h1>
          <p className="text-[#6e6e80] mt-2">管理和检查 CodeX 账号有效性</p>
        </div>

        <div className="mb-6 flex gap-3">
          <button
            onClick={handleCheckStatus}
            disabled={checkingStatus || checkingQuota || accounts.length === 0}
            className="px-6 py-3 bg-[#0d0d0d] text-white rounded-lg font-medium hover:bg-[#2d2d2d] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
          >
            {checkingStatus ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                检查中...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                检查账号状态
              </>
            )}
          </button>
          <button
            onClick={() => setShowQuotaModal(true)}
            disabled={checkingStatus || checkingQuota || accounts.length === 0}
            className="px-6 py-3 bg-white text-[#0d0d0d] border border-[#e5e5e5] rounded-lg font-medium hover:bg-[#f7f7f8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
          >
            {checkingQuota ? (
              <>
                <div className="w-4 h-4 border-2 border-[#0d0d0d]/30 border-t-[#0d0d0d] rounded-full animate-spin"></div>
                检查中...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                检查账号配额
              </>
            )}
          </button>
          <button
            onClick={() => setShowCleanModal(true)}
            disabled={checkingStatus || checkingQuota || deleting}
            className="px-6 py-3 bg-white text-[#ef4444] border border-[#ef4444]/30 rounded-lg font-medium hover:bg-[#fef2f2] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            清除低配额
          </button>
        </div>


        {loading ? (
          <div className="text-center py-20">
            <div className="inline-block w-8 h-8 border-2 border-[#e5e5e5] border-t-[#0d0d0d] rounded-full animate-spin"></div>
            <p className="mt-4 text-[#6e6e80]">加载中...</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-20 text-[#6e6e80]">
            <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <p className="text-lg">暂无 CodeX 账号</p>
            <p className="text-sm mt-2">请在 CLI-Proxy 中配置 CodeX 账号</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-[#6e6e80]">
                共 {accounts.length} 个账号
              </p>
              {accounts.length > ITEMS_PER_PAGE && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1 text-sm border border-[#e5e5e5] rounded hover:bg-[#f7f7f8] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    上一页
                  </button>
                  <span className="text-sm text-[#6e6e80]">
                    {page} / {Math.ceil(accounts.length / ITEMS_PER_PAGE)}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(Math.ceil(accounts.length / ITEMS_PER_PAGE), p + 1))}
                    disabled={page >= Math.ceil(accounts.length / ITEMS_PER_PAGE)}
                    className="px-3 py-1 text-sm border border-[#e5e5e5] rounded hover:bg-[#f7f7f8] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {accounts.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE).map((account, idx) => (
                <div 
                  key={idx} 
                  className={`p-5 border rounded-xl min-h-[120px] flex flex-col ${
                    account.checkStatus === 'invalid' ? 'border-[#ef4444]/50 bg-[#fef2f2]' : 
                    account.checkStatus === 'valid' ? 'border-[#10a37f]/50 bg-[#f0fdf4]' :
                    'border-[#e5e5e5] hover:bg-[#f7f7f8]'
                  } transition-colors`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono text-sm text-[#0d0d0d] break-all flex-1" title={account.email}>
                      {account.email}
                    </p>
                    {account.checkStatus === 'valid' && (
                      <span className="px-2 py-0.5 text-xs bg-[#10a37f] text-white rounded shrink-0">有效</span>
                    )}
                    {account.checkStatus === 'invalid' && (
                      <span className="px-2 py-0.5 text-xs bg-[#ef4444] text-white rounded shrink-0">无效</span>
                    )}
                  </div>
                  <div className="flex-1" />
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#6e6e80]">{account.planType || 'free'}</span>
                      {account.label && (
                        <span className="text-[10px] text-[#8e8ea0]">{account.label}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <QuotaWindowCard
                        title="5 小时限额"
                        windowData={getFiveHourQuotaWindow(account)}
                      />
                      <QuotaWindowCard
                        title="周限额"
                        windowData={getWeeklyQuotaWindow(account)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* 配额检查模态框 */}
        {showQuotaModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowQuotaModal(false)}>
            <div className="bg-white rounded-xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-[#0d0d0d] mb-2">检查账号配额</h3>
              <p className="text-sm text-[#6e6e80] mb-4">选择要检查的范围（从当前页开始）</p>
              <p className="text-xs text-[#f59e0b] mb-4">建议不要一次性检查太多，以免请求过多</p>
              <div className="space-y-2">
                <button
                  onClick={() => handleCheckQuota(1)}
                  className="w-full py-3 text-left px-4 border border-[#e5e5e5] rounded-lg hover:bg-[#f7f7f8] transition-colors"
                >
                  <span className="font-medium">检查 1 页</span>
                  <span className="text-sm text-[#6e6e80] ml-2">({Math.min(ITEMS_PER_PAGE, accounts.length - (page - 1) * ITEMS_PER_PAGE)} 个账号)</span>
                </button>
                <button
                  onClick={() => handleCheckQuota(3)}
                  className="w-full py-3 text-left px-4 border border-[#e5e5e5] rounded-lg hover:bg-[#f7f7f8] transition-colors"
                >
                  <span className="font-medium">检查 3 页</span>
                  <span className="text-sm text-[#6e6e80] ml-2">({Math.min(ITEMS_PER_PAGE * 3, accounts.length - (page - 1) * ITEMS_PER_PAGE)} 个账号)</span>
                </button>
                <button
                  onClick={() => handleCheckQuota(5)}
                  className="w-full py-3 text-left px-4 border border-[#e5e5e5] rounded-lg hover:bg-[#f7f7f8] transition-colors"
                >
                  <span className="font-medium">检查 5 页</span>
                  <span className="text-sm text-[#6e6e80] ml-2">({Math.min(ITEMS_PER_PAGE * 5, accounts.length - (page - 1) * ITEMS_PER_PAGE)} 个账号)</span>
                </button>
                <button
                  onClick={() => handleCheckQuota('all')}
                  className="w-full py-3 text-left px-4 border border-[#ef4444]/30 rounded-lg hover:bg-[#fef2f2] transition-colors text-[#ef4444]"
                >
                  <span className="font-medium">检查全部</span>
                  <span className="text-sm ml-2">({accounts.length} 个账号)</span>
                </button>
              </div>
              <button
                onClick={() => setShowQuotaModal(false)}
                className="w-full mt-4 py-2 text-sm text-[#6e6e80] hover:text-[#0d0d0d] transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 检查状态结果弹窗 */}
        {showStatusResult && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowStatusResult(null)}>
            <div className="bg-white rounded-xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-[#0d0d0d] mb-4">检查完成</h3>
              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between p-3 bg-[#f0fdf4] rounded-lg">
                  <span className="text-[#0d0d0d]">存活账号</span>
                  <span className="text-xl font-semibold text-[#10a37f]">{showStatusResult.valid}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-[#fef2f2] rounded-lg">
                  <span className="text-[#0d0d0d]">死亡账号</span>
                  <span className="text-xl font-semibold text-[#ef4444]">{showStatusResult.invalid}</span>
                </div>
              </div>
              {showStatusResult.invalid > 0 ? (
                <div className="space-y-2">
                  <button
                    onClick={handleDeleteInvalid}
                    disabled={deleting}
                    className="w-full py-3 bg-[#ef4444] text-white rounded-lg font-medium hover:bg-[#dc2626] disabled:opacity-50 transition-colors"
                  >
                    {deleting ? '删除中...' : `删除死号 (${showStatusResult.invalid} 个)`}
                  </button>
                  <button
                    onClick={() => setShowStatusResult(null)}
                    className="w-full py-3 border border-[#e5e5e5] rounded-lg font-medium hover:bg-[#f7f7f8] transition-colors"
                  >
                    暂不处理
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowStatusResult(null)}
                  className="w-full py-3 bg-[#0d0d0d] text-white rounded-lg font-medium hover:bg-[#2d2d2d] transition-colors"
                >
                  确定
                </button>
              )}
            </div>
          </div>
        )}

        {/* 清除低配额模态框 */}
        {showCleanModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCleanModal(false)}>
            <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-[#0d0d0d] mb-4">清除低配额账号</h3>
              
              <div className="mb-4 p-3 bg-[#f7f7f8] rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-[#6e6e80]">总账号数</span>
                  <span className="font-medium">{accounts.length}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-[#6e6e80]">已查周限额</span>
                  <span className="font-medium">{accounts.filter(a => getWeeklyQuotaWindow(a)).length}</span>
                </div>
              </div>

              <p className="text-sm text-[#6e6e80] mb-4">按周限额清除配额低且短期内不会恢复的账号：</p>
              
              <div className="space-y-4 mb-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm text-[#0d0d0d]">剩余配额</label>
                    <span className="text-sm font-semibold text-[#ef4444]">&lt; {cleanThreshold.quota}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    value={cleanThreshold.quota}
                    onChange={e => setCleanThreshold(prev => ({ ...prev, quota: parseInt(e.target.value) }))}
                    className="w-full h-2 bg-[#e5e5e5] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[#0d0d0d] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm text-[#0d0d0d]">恢复还需</label>
                    <span className="text-sm font-semibold text-[#ef4444]">&gt; {cleanThreshold.days} 天</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="7"
                    value={cleanThreshold.days}
                    onChange={e => setCleanThreshold(prev => ({ ...prev, days: parseInt(e.target.value) }))}
                    className="w-full h-2 bg-[#e5e5e5] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[#0d0d0d] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
                  />
                </div>
              </div>

              <div className="p-3 bg-[#fef2f2] rounded-lg mb-4">
                <p className="text-sm text-[#ef4444]">
                  符合条件: <span className="font-semibold">{getCleanableAccounts().length}</span> 个账号将被删除
                </p>
              </div>

              <div className="space-y-2">
                <button
                  onClick={handleCleanLowQuota}
                  disabled={deleting || getCleanableAccounts().length === 0}
                  className="w-full py-3 bg-[#ef4444] text-white rounded-lg font-medium hover:bg-[#dc2626] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {deleting ? '删除中...' : `确认清除 (${getCleanableAccounts().length} 个)`}
                </button>
                <button
                  onClick={() => setShowCleanModal(false)}
                  className="w-full py-3 border border-[#e5e5e5] rounded-lg font-medium hover:bg-[#f7f7f8] transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default CodexPage
