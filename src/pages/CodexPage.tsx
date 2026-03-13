import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../auth.js'
import {
  type CpaInstance,
  fetchCpaInstances,
  getActiveCpaInstance,
  getCpaInstanceStatusClass,
  getCpaInstanceStatusLabel,
} from '../cpaInstances'
import { ActionButton, AppShell, EmptyState, GlassPanel, InlineIcon, SectionFrame } from '../components/ui'
import { useI18n } from '../i18n/useI18n'
import { buildPrimaryNav } from '../navigation'

const ITEMS_PER_PAGE = 12

type QuotaWindow = {
  remainingPercent?: number
  usedPercent?: number
  resetAt?: number
}

type Account = {
  email?: string
  planType?: string
  label?: string
  authIndex?: string | number
  checkStatus?: 'valid' | 'invalid'
  quota?: number
  usedPercent?: number
  resetAt?: number
  fiveHourWindow?: QuotaWindow | null
  weeklyWindow?: QuotaWindow | null
}

function hasAccountIdentifier(value: unknown): value is string | number {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function formatQuotaResetAt(resetAt: number | undefined, locale: string, t: (key: string) => string) {
  if (!resetAt) return t('Returned no time')

  const date = new Date(resetAt * 1000)
  if (Number.isNaN(date.getTime())) return t('Invalid time')

  return date.toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function getLegacyQuotaWindow(account: Account) {
  if (account?.quota === undefined && account?.usedPercent === undefined && !account?.resetAt) {
    return null
  }

  return {
    remainingPercent: account.quota,
    usedPercent: account.usedPercent,
    resetAt: account.resetAt,
  }
}

function getFiveHourQuotaWindow(account: Account) {
  return account?.fiveHourWindow || getLegacyQuotaWindow(account)
}

function getWeeklyQuotaWindow(account: Account) {
  return account?.weeklyWindow || null
}

function QuotaWindowCard({
  title,
  windowData,
  locale,
  t,
}: {
  title: string
  windowData: QuotaWindow | null
  locale: string
  t: (key: string) => string
}) {
  const remainingPercent = Number.isFinite(Number(windowData?.remainingPercent))
    ? Math.max(0, Math.min(100, Number(windowData?.remainingPercent)))
    : null

  const toneClass = remainingPercent === null
    ? 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
    : remainingPercent > 50
      ? 'border-[color-mix(in_srgb,var(--success)_22%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,var(--bg-card-strong))]'
      : remainingPercent > 20
        ? 'border-[color-mix(in_srgb,var(--warning)_26%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,var(--bg-card-strong))]'
        : 'border-[color-mix(in_srgb,var(--danger)_26%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,var(--bg-card-strong))]'

  return (
    <div className={`rounded-[22px] border px-3 py-3 ${toneClass}`}>
      <p className="text-[11px] uppercase tracking-[0.16em] faint-text">{title}</p>
      <div className="mt-3 flex items-end justify-between">
        <span className="text-2xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">
          {remainingPercent !== null ? `${Math.round(remainingPercent)}%` : '--'}
        </span>
        <span className="text-[10px] faint-text">
          {remainingPercent !== null ? t('Remaining') : t('Unchecked')}
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-primary)]/20">
        <div
          className="h-full rounded-full bg-[var(--text-primary)] transition-all"
          style={{ width: `${remainingPercent ?? 0}%`, opacity: remainingPercent === null ? 0.25 : 0.9 }}
        />
      </div>
      <p className="mt-3 text-[10px] faint-text">
        {windowData?.resetAt ? formatQuotaResetAt(windowData.resetAt, locale, t) : t('Shown after a quota scan')}
      </p>
    </div>
  )
}

function OverlayDialog({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="modal-backdrop z-50 flex items-center justify-center px-4" onClick={onClose}>
      <GlassPanel tone="strong" className="w-full max-w-md rounded-[28px] p-6" onClick={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-medium tracking-[-0.04em] text-[var(--text-primary)]">{title}</h3>
            {subtitle ? <p className="mt-2 text-sm leading-6 muted-text">{subtitle}</p> : null}
          </div>
          <ActionButton size="sm" variant="ghost" onClick={onClose} icon={<InlineIcon name="close" />}>
            <span className="sr-only">{title}</span>
          </ActionButton>
        </div>
        {children}
      </GlassPanel>
    </div>
  )
}

export default function CodexPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [currentInstance, setCurrentInstance] = useState<CpaInstance | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [checkingQuota, setCheckingQuota] = useState(false)
  const [results, setResults] = useState<Record<string, unknown> | null>(null)
  const [page, setPage] = useState(1)
  const [showQuotaModal, setShowQuotaModal] = useState(false)
  const [showStatusResult, setShowStatusResult] = useState<null | {
    valid: number
    invalid: number
    invalidAccounts: Array<{ name?: string; email?: string }>
  }>(null)
  const [pageError, setPageError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [showCleanModal, setShowCleanModal] = useState(false)
  const [cleanThreshold, setCleanThreshold] = useState({ quota: 20, days: 5 })
  const { t, locale } = useI18n()

  const navItems = useMemo(() => buildPrimaryNav(t), [t])

  const fetchAccounts = async () => {
    try {
      const nextInstances = await fetchCpaInstances()
      setCurrentInstance(getActiveCpaInstance(nextInstances))

      const res = await apiFetch('/api/codex/accounts')
      if (res.ok) {
        const data = await res.json()
        setAccounts(data)
        setPageError('')
      } else {
        const data = await res.json().catch(() => ({}))
        setAccounts([])
        setPageError(data.error || t('Failed to load CodeX accounts'))
      }
    } catch (error) {
      console.error('Failed to fetch CodeX accounts:', error)
      setPageError((error as Error).message || t('Failed to load CodeX accounts'))
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
        if (data.invalidAccounts) {
          const invalidEmails = new Set(data.invalidAccounts.map((account: { email: string }) => account.email))
          setAccounts((prev) => prev.map((account) => ({
            ...account,
            checkStatus: invalidEmails.has(account.email || '') ? 'invalid' : 'valid',
          })))
        }
        setShowStatusResult({
          valid: data.valid || 0,
          invalid: data.invalid || 0,
          invalidAccounts: data.invalidAccounts || [],
        })
      }
    } catch (error) {
      console.error('Failed to check CodeX status:', error)
    } finally {
      setCheckingStatus(false)
    }
  }

  const getCleanableAccounts = () => {
    const now = Date.now() / 1000
    const thresholdSeconds = cleanThreshold.days * 24 * 60 * 60
    return accounts.filter((account) => {
      const weeklyWindow = getWeeklyQuotaWindow(account)
      const weeklyQuota = weeklyWindow?.remainingPercent
      const weeklyResetAt = weeklyWindow?.resetAt

      if (!Number.isFinite(Number(weeklyQuota))) return false
      if (Number(weeklyQuota) > cleanThreshold.quota) return false
      if (!weeklyResetAt) return false
      return weeklyResetAt - now > thresholdSeconds
    })
  }

  const handleCleanLowQuota = async () => {
    const toClean = getCleanableAccounts()
    if (toClean.length === 0) return

    setDeleting(true)
    try {
      const authIndexes = toClean
        .map((account) => account.authIndex)
        .filter(hasAccountIdentifier)
      const res = await apiFetch('/api/codex/delete-by-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authIndexes }),
      })
      if (res.ok) {
        const data = await res.json()
        setShowCleanModal(false)
        fetchAccounts()
        setResults({ type: 'clean', deleted: data.deleted })
      }
    } catch (error) {
      console.error('Failed to clean low quota accounts:', error)
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteInvalid = async () => {
    if (!showStatusResult?.invalidAccounts?.length) return
    setDeleting(true)

    try {
      const names = showStatusResult.invalidAccounts.map((account) => account.name).filter(Boolean)
      const res = await apiFetch('/api/codex/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      })
      if (res.ok) {
        const data = await res.json()
        setShowStatusResult(null)
        fetchAccounts()
        setResults({ type: 'delete', deleted: data.deleted })
      }
    } catch (error) {
      console.error('Failed to delete invalid accounts:', error)
    } finally {
      setDeleting(false)
    }
  }

  const handleCheckQuota = async (pageCount: number | 'all') => {
    setShowQuotaModal(false)
    setCheckingQuota(true)
    setResults(null)

    let startIdx: number
    let endIdx: number
    if (pageCount === 'all') {
      startIdx = 0
      endIdx = accounts.length
    } else {
      startIdx = (page - 1) * ITEMS_PER_PAGE
      endIdx = Math.min(startIdx + pageCount * ITEMS_PER_PAGE, accounts.length)
    }

    const authIndexes = accounts
      .slice(startIdx, endIdx)
      .map((account) => account.authIndex)
      .filter(hasAccountIdentifier)

    try {
      const res = await apiFetch('/api/codex/quota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authIndexes }),
      })
      if (res.ok) {
        const data = await res.json()
        setResults({ type: 'quota', ...data })
        if (data.quotas) {
          setAccounts((prev) => prev.map((account) => {
            const quota = data.quotas.find((entry: { authIndex: string | number }) => entry.authIndex === account.authIndex)
            return quota ? {
              ...account,
              quota: quota.completionQuota,
              usedPercent: quota.usedPercent,
              resetAt: quota.resetAt,
              fiveHourWindow: quota.fiveHourWindow || null,
              weeklyWindow: quota.weeklyWindow || null,
            } : account
          }))
        }
      }
    } catch (error) {
      console.error('Failed to check CodeX quota:', error)
    } finally {
      setCheckingQuota(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(accounts.length / ITEMS_PER_PAGE))
  const pagedAccounts = accounts.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
  const cleanableAccounts = getCleanableAccounts()

  return (
    <AppShell navItems={navItems} subduedParticles>
      <div className="space-y-6">
        <GlassPanel tone="strong" className="rounded-[28px] p-5 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] faint-text">{t('CodeX account control')}</p>
              <h1 className="mt-2 text-[1.9rem] font-medium tracking-[-0.05em] text-[var(--text-primary)]">
                {t('Manage and verify CodeX accounts backed by CLI-Proxy.')}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 muted-text">
                {t('Inspect account health, review quota windows, and remove low-value seats without leaving the monochrome shell.')}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {currentInstance ? <span className="chip">{t('Active instance')}: {currentInstance.name}</span> : null}
                <span className="chip">{t('Live accounts')}: {accounts.filter((account) => account.checkStatus === 'valid').length}</span>
                <span className="chip">{t('Quota cleanup')}: {cleanableAccounts.length}</span>
                {results?.deleted ? <span className="chip">{t('Deleted')}: {String(results.deleted)}</span> : null}
                {currentInstance ? (
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getCpaInstanceStatusClass(currentInstance.status)}`}>
                    {getCpaInstanceStatusLabel(currentInstance.status, t)}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <ActionButton
                onClick={handleCheckStatus}
                disabled={checkingStatus || checkingQuota || accounts.length === 0}
                variant="primary"
                icon={<InlineIcon name="check" />}
                loading={checkingStatus}
              >
                {checkingStatus ? t('Checking...') : t('Check account status')}
              </ActionButton>
              <ActionButton
                onClick={() => setShowQuotaModal(true)}
                disabled={checkingStatus || checkingQuota || accounts.length === 0}
                variant="secondary"
                icon={<InlineIcon name="refresh" />}
                loading={checkingQuota}
              >
                {checkingQuota ? t('Checking...') : t('Check quotas')}
              </ActionButton>
              <ActionButton
                onClick={() => setShowCleanModal(true)}
                disabled={checkingStatus || checkingQuota || deleting}
                variant="ghost"
                icon={<InlineIcon name="trash" />}
              >
                {t('Remove low quota')}
              </ActionButton>
            </div>
          </div>
        </GlassPanel>

        {pageError ? <p className="text-sm text-[var(--danger)]">{pageError}</p> : null}

        <SectionFrame
          title={t('CodeX')}
          description={t('Review account state, page through seats, and inspect both 5-hour and weekly quota windows.')}
          actions={accounts.length > ITEMS_PER_PAGE ? (
            <div className="flex items-center gap-2">
              <ActionButton size="sm" variant="ghost" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>
                {t('Previous')}
              </ActionButton>
              <span className="text-sm muted-text">{t('Page {page} of {total}', { page, total: totalPages })}</span>
              <ActionButton size="sm" variant="ghost" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>
                {t('Next')}
              </ActionButton>
            </div>
          ) : null}
        >
          {loading ? (
            <div className="flex min-h-[240px] items-center justify-center">
              <div className="surface-panel-subtle flex flex-col items-center gap-4 rounded-[28px] px-8 py-8">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--border-color)] border-t-[var(--text-primary)]" />
                <p className="text-sm muted-text">{t('Loading...')}</p>
              </div>
            </div>
          ) : accounts.length === 0 ? (
            <EmptyState
              icon={<InlineIcon name="codex" className="h-16 w-16 opacity-45" strokeWidth={1} />}
              title={t('No CodeX accounts yet')}
              description={t('Configure CodeX accounts inside CLI-Proxy first.')}
            />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm muted-text">{t('Total {count} accounts', { count: accounts.length })}</p>
                <div className="flex flex-wrap gap-2">
                  <span className="chip">{t('Checked')}: {accounts.filter((account) => account.checkStatus).length}</span>
                  <span className="chip">{t('Quota cleanup')}: {cleanableAccounts.length}</span>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {pagedAccounts.map((account, index) => (
                  <GlassPanel key={`${account.email}-${index}`} tone="default" className="rounded-[28px] p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-all font-mono text-sm text-[var(--text-primary)]" title={account.email}>
                          {account.email}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="chip">{account.planType || t('Free')}</span>
                          {account.label ? <span className="chip">{account.label}</span> : null}
                        </div>
                      </div>
                      {account.checkStatus === 'valid' ? (
                        <span className="rounded-full border border-[color-mix(in_srgb,var(--success)_24%,transparent)] px-3 py-1 text-xs text-[var(--success)]">
                          {t('Valid')}
                        </span>
                      ) : null}
                      {account.checkStatus === 'invalid' ? (
                        <span className="rounded-full border border-[color-mix(in_srgb,var(--danger)_24%,transparent)] px-3 py-1 text-xs text-[var(--danger)]">
                          {t('Invalid')}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <QuotaWindowCard title={t('5h quota')} windowData={getFiveHourQuotaWindow(account)} locale={locale} t={t} />
                      <QuotaWindowCard title={t('Weekly quota')} windowData={getWeeklyQuotaWindow(account)} locale={locale} t={t} />
                    </div>
                  </GlassPanel>
                ))}
              </div>
            </div>
          )}
        </SectionFrame>
      </div>

      {showQuotaModal ? (
        <OverlayDialog
          title={t('Check quota scope')}
          subtitle={t('Choose how much to scan starting from the current page.')}
          onClose={() => setShowQuotaModal(false)}
        >
          <p className="mb-4 text-xs faint-text">{t('Scanning too many accounts at once can generate excessive requests.')}</p>
          <div className="space-y-2">
            {[1, 3, 5].map((value) => (
              <button
                key={value}
                onClick={() => handleCheckQuota(value)}
                className="surface-panel-subtle flex w-full items-center justify-between rounded-[22px] px-4 py-4 text-left"
              >
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {t(`Scan ${value} page${value > 1 ? 's' : ''}`)}
                </span>
                <span className="text-sm muted-text">
                  {Math.min(ITEMS_PER_PAGE * value, accounts.length - (page - 1) * ITEMS_PER_PAGE)}
                </span>
              </button>
            ))}
            <button
              onClick={() => handleCheckQuota('all')}
              className="surface-panel-subtle flex w-full items-center justify-between rounded-[22px] px-4 py-4 text-left text-[var(--danger)]"
            >
              <span className="text-sm font-medium">{t('Scan all')}</span>
              <span className="text-sm">{accounts.length}</span>
            </button>
          </div>
          <div className="mt-5">
            <ActionButton className="w-full" onClick={() => setShowQuotaModal(false)} variant="ghost">
              {t('Cancel')}
            </ActionButton>
          </div>
        </OverlayDialog>
      ) : null}

      {showStatusResult ? (
        <OverlayDialog
          title={t('Status check complete')}
          onClose={() => setShowStatusResult(null)}
        >
          <div className="space-y-3">
            <div className="surface-panel-subtle flex items-center justify-between rounded-[22px] px-4 py-4">
              <span className="text-sm muted-text">{t('Active')}</span>
              <span className="text-2xl font-semibold text-[var(--success)]">{showStatusResult.valid}</span>
            </div>
            <div className="surface-panel-subtle flex items-center justify-between rounded-[22px] px-4 py-4">
              <span className="text-sm muted-text">{t('Dead')}</span>
              <span className="text-2xl font-semibold text-[var(--danger)]">{showStatusResult.invalid}</span>
            </div>
          </div>
          <div className="mt-5 space-y-2">
            {showStatusResult.invalid > 0 ? (
              <>
                <ActionButton
                  className="w-full"
                  onClick={handleDeleteInvalid}
                  disabled={deleting}
                  loading={deleting}
                  variant="danger"
                  icon={<InlineIcon name="trash" />}
                >
                  {deleting ? t('Deleting...') : t('Delete invalid accounts ({count})', { count: showStatusResult.invalid })}
                </ActionButton>
                <ActionButton className="w-full" onClick={() => setShowStatusResult(null)} variant="ghost">
                  {t('Keep for now')}
                </ActionButton>
              </>
            ) : (
              <ActionButton className="w-full" onClick={() => setShowStatusResult(null)} variant="primary">
                {t('Confirm')}
              </ActionButton>
            )}
          </div>
        </OverlayDialog>
      ) : null}

      {showCleanModal ? (
        <OverlayDialog
          title={t('Remove low quota accounts')}
          subtitle={t('Remove accounts with low weekly quota and slow recovery.')}
          onClose={() => setShowCleanModal(false)}
        >
          <div className="space-y-4">
            <div className="surface-panel-subtle rounded-[22px] px-4 py-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="muted-text">{t('Total accounts')}</span>
                <span className="text-[var(--text-primary)]">{accounts.length}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="muted-text">{t('Weekly quota scanned')}</span>
                <span className="text-[var(--text-primary)]">{accounts.filter((account) => getWeeklyQuotaWindow(account)).length}</span>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm muted-text">{t('Remaining quota')}</label>
                <span className="text-sm text-[var(--danger)]">{t('Under {count}%', { count: cleanThreshold.quota })}</span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                value={cleanThreshold.quota}
                onChange={(event) => setCleanThreshold((prev) => ({ ...prev, quota: parseInt(event.target.value, 10) }))}
                className="w-full"
              />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm muted-text">{t('Recovery time')}</label>
                <span className="text-sm text-[var(--danger)]">{t('Over {count} days', { count: cleanThreshold.days })}</span>
              </div>
              <input
                type="range"
                min="1"
                max="7"
                value={cleanThreshold.days}
                onChange={(event) => setCleanThreshold((prev) => ({ ...prev, days: parseInt(event.target.value, 10) }))}
                className="w-full"
              />
            </div>
            <div className="surface-danger rounded-[22px] px-4 py-4 text-sm">
              {t('{count} accounts will be deleted', { count: cleanableAccounts.length })}
            </div>
          </div>
          <div className="mt-5 space-y-2">
            <ActionButton
              className="w-full"
              onClick={handleCleanLowQuota}
              disabled={deleting || cleanableAccounts.length === 0}
              loading={deleting}
              variant="danger"
              icon={<InlineIcon name="trash" />}
            >
              {deleting ? t('Deleting...') : t('Confirm removal ({count})', { count: cleanableAccounts.length })}
            </ActionButton>
            <ActionButton className="w-full" onClick={() => setShowCleanModal(false)} variant="ghost">
              {t('Cancel')}
            </ActionButton>
          </div>
        </OverlayDialog>
      ) : null}
    </AppShell>
  )
}
