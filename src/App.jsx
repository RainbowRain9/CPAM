import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const REQUESTS_PER_PAGE = 50
const RECENT_WINDOW_MINUTES = 30
const LOCAL_MODEL_PRICING_KEY = 'api-center-local-model-pricing-v1'
const SERVICE_HEALTH_ROWS = 7
const SERVICE_HEALTH_COLS = 96
const SERVICE_HEALTH_BLOCK_MS = 15 * 60 * 1000
const SERVICE_HEALTH_COLOR_STOPS = [
  { r: 239, g: 68, b: 68 },
  { r: 245, g: 158, b: 11 },
  { r: 34, g: 197, b: 94 },
]

function toSafeNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function toNonNegativeNumber(value) {
  return Math.max(0, toSafeNumber(value))
}

function formatNumber(value) {
  return toSafeNumber(value).toLocaleString('zh-CN')
}

function formatTokens(value) {
  const num = toNonNegativeNumber(value)
  if (num === 0) return '0'
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toLocaleString('zh-CN')
}

function formatUsd(value) {
  return `$${toSafeNumber(value).toFixed(4)}`
}

function formatPerMinute(value) {
  const num = toSafeNumber(value)
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  if (num >= 100) return num.toFixed(0)
  if (num >= 10) return num.toFixed(1)
  return num.toFixed(2)
}

function formatTime(isoString) {
  if (!isoString) return '-'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN')
}

function formatRelativeTime(isoString) {
  if (!isoString) return '-'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '-'
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function interpolateColor(from, to, ratio) {
  const clampedRatio = Math.max(0, Math.min(1, ratio))
  const r = Math.round(from.r + (to.r - from.r) * clampedRatio)
  const g = Math.round(from.g + (to.g - from.g) * clampedRatio)
  const b = Math.round(from.b + (to.b - from.b) * clampedRatio)
  return `rgb(${r}, ${g}, ${b})`
}

function rateToHealthColor(rate) {
  if (rate < 0) return '#f8fafc'
  if (rate <= 0.5) {
    return interpolateColor(
      SERVICE_HEALTH_COLOR_STOPS[0],
      SERVICE_HEALTH_COLOR_STOPS[1],
      rate * 2
    )
  }

  return interpolateColor(
    SERVICE_HEALTH_COLOR_STOPS[1],
    SERVICE_HEALTH_COLOR_STOPS[2],
    (rate - 0.5) * 2
  )
}

function formatHealthBlockTime(startTime, endTime) {
  const start = new Date(startTime)
  const end = new Date(endTime)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '-'

  const startLabel = start.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const endLabel = end.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return `${startLabel} - ${endLabel}`
}

function getCachedTokens(tokens = {}) {
  return Math.max(
    toNonNegativeNumber(tokens.cached_tokens),
    toNonNegativeNumber(tokens.cache_tokens)
  )
}

function getReasoningTokens(tokens = {}) {
  return toNonNegativeNumber(tokens.reasoning_tokens)
}

function getInputTokens(tokens = {}) {
  return toNonNegativeNumber(tokens.input_tokens)
}

function getOutputTokens(tokens = {}) {
  return toNonNegativeNumber(tokens.output_tokens)
}

function getTotalTokens(tokens = {}) {
  const total = toSafeNumber(tokens.total_tokens)
  if (total > 0) return total
  return getInputTokens(tokens) + getOutputTokens(tokens) + getCachedTokens(tokens) + getReasoningTokens(tokens)
}

function normalizeLocalPricingMap(rawValue) {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return {}
  }

  const normalized = {}
  Object.entries(rawValue).forEach(([model, value]) => {
    if (!model || !value || typeof value !== 'object' || Array.isArray(value)) return

    const promptPrice = toNonNegativeNumber(value.promptPrice ?? value.prompt ?? value.inputPrice)
    const completionPrice = toNonNegativeNumber(value.completionPrice ?? value.completion ?? value.outputPrice)
    const cacheRaw = value.cachePrice ?? value.cache ?? value.inputPrice ?? value.promptPrice ?? value.prompt
    const cachePrice = toNonNegativeNumber(cacheRaw)

    normalized[model] = {
      promptPrice,
      completionPrice,
      cachePrice: cachePrice > 0 ? cachePrice : promptPrice,
    }
  })

  return normalized
}

function loadLocalModelPricing() {
  try {
    if (typeof window === 'undefined') return {}
    const raw = window.localStorage.getItem(LOCAL_MODEL_PRICING_KEY)
    if (!raw) return {}
    return normalizeLocalPricingMap(JSON.parse(raw))
  } catch {
    return {}
  }
}

function persistLocalModelPricing(pricing) {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LOCAL_MODEL_PRICING_KEY, JSON.stringify(pricing))
  } catch {
    console.warn('保存本地模型价格失败')
  }
}

function migrateServerPricing(serverPricing) {
  return normalizeLocalPricingMap(serverPricing)
}

const INITIAL_LOCAL_MODEL_PRICING = loadLocalModelPricing()

function calculateAggregateCost(modelName, inputTokens, outputTokens, cachedTokens, pricingMap) {
  const pricing = pricingMap[modelName]
  if (!pricing) return null

  const promptTokens = Math.max(toNonNegativeNumber(inputTokens) - toNonNegativeNumber(cachedTokens), 0)
  const promptCost = (promptTokens / 1000000) * toNonNegativeNumber(pricing.promptPrice)
  const completionCost = (toNonNegativeNumber(outputTokens) / 1000000) * toNonNegativeNumber(pricing.completionPrice)
  const cacheCost = (toNonNegativeNumber(cachedTokens) / 1000000) * toNonNegativeNumber(pricing.cachePrice)

  return promptCost + completionCost + cacheCost
}

function buildRequestDetails(usage, pricingMap) {
  const details = []

  if (!usage?.apis) return details

  Object.entries(usage.apis).forEach(([endpoint, api]) => {
    if (!api?.models) return

    Object.entries(api.models).forEach(([modelName, modelData]) => {
      const modelDetails = Array.isArray(modelData?.details) ? modelData.details : []

      modelDetails.forEach((detail, index) => {
        const tokens = detail?.tokens || {}
        const inputTokens = getInputTokens(tokens)
        const outputTokens = getOutputTokens(tokens)
        const cachedTokens = getCachedTokens(tokens)
        const reasoningTokens = getReasoningTokens(tokens)
        const totalTokens = getTotalTokens(tokens)
        const cost = calculateAggregateCost(modelName, inputTokens, outputTokens, cachedTokens, pricingMap)
        const timestampMs = Date.parse(detail?.timestamp || '')

        details.push({
          id: `${endpoint}-${modelName}-${detail?.timestamp || index}-${index}`,
          endpoint,
          model: modelName,
          source: detail?.source || '',
          authIndex: detail?.auth_index ?? '',
          timestamp: detail?.timestamp || '',
          timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
          failed: detail?.failed === true,
          inputTokens,
          outputTokens,
          cachedTokens,
          reasoningTokens,
          totalTokens,
          cost,
          hasPrice: Boolean(pricingMap[modelName]),
        })
      })
    })
  })

  return details.sort((a, b) => b.timestampMs - a.timestampMs)
}

function buildOverviewStats(usage, requestDetails) {
  let totalCost = 0
  let fallbackInputTokens = 0
  let fallbackOutputTokens = 0
  let fallbackCachedTokens = 0
  let fallbackReasoningTokens = 0

  requestDetails.forEach((detail) => {
    fallbackInputTokens += detail.inputTokens
    fallbackOutputTokens += detail.outputTokens
    fallbackCachedTokens += detail.cachedTokens
    fallbackReasoningTokens += detail.reasoningTokens
    if (detail.cost !== null) {
      totalCost += detail.cost
    }
  })

  return {
    totalRequests: toNonNegativeNumber(usage?.total_requests),
    successCount: toNonNegativeNumber(usage?.success_count),
    failureCount: toNonNegativeNumber(usage?.failure_count),
    totalTokens: toNonNegativeNumber(usage?.total_tokens),
    totalInputTokens: toNonNegativeNumber(usage?.total_input_tokens) || fallbackInputTokens,
    totalOutputTokens: toNonNegativeNumber(usage?.total_output_tokens) || fallbackOutputTokens,
    totalCachedTokens: toNonNegativeNumber(usage?.total_cached_tokens) || fallbackCachedTokens,
    totalReasoningTokens: toNonNegativeNumber(usage?.total_reasoning_tokens) || fallbackReasoningTokens,
    totalCost,
  }
}

function createHourlyBuckets(hours = 24) {
  const current = new Date()
  current.setMinutes(0, 0, 0)

  const buckets = []
  for (let offset = hours - 1; offset >= 0; offset -= 1) {
    const bucketDate = new Date(current.getTime() - offset * 3600000)
    buckets.push({
      key: bucketDate.getTime(),
      label: bucketDate.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    })
  }
  return buckets
}

function createDailyBuckets(days = 30) {
  const current = new Date()
  current.setHours(0, 0, 0, 0)

  const buckets = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const bucketDate = new Date(current)
    bucketDate.setDate(bucketDate.getDate() - offset)
    buckets.push({
      key: bucketDate.getTime(),
      label: bucketDate.toLocaleDateString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
      }),
      fullDate: bucketDate.toISOString().slice(0, 10),
    })
  }
  return buckets
}

function buildTrendData(requestDetails, mode) {
  const buckets = mode === 'hourly' ? createHourlyBuckets(24) : createDailyBuckets(30)
  const rows = buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    fullDate: bucket.fullDate || '',
    requests: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    cost: 0,
  }))

  const rowIndexByKey = new Map(rows.map((row, index) => [row.key, index]))

  requestDetails.forEach((detail) => {
    if (!detail.timestampMs) return

    const bucketDate = new Date(detail.timestampMs)
    if (mode === 'hourly') {
      bucketDate.setMinutes(0, 0, 0)
    } else {
      bucketDate.setHours(0, 0, 0, 0)
    }

    const rowIndex = rowIndexByKey.get(bucketDate.getTime())
    if (rowIndex === undefined) return

    const row = rows[rowIndex]
    row.requests += 1
    row.totalTokens += detail.totalTokens
    row.inputTokens += detail.inputTokens
    row.outputTokens += detail.outputTokens
    row.cachedTokens += detail.cachedTokens
    row.reasoningTokens += detail.reasoningTokens
    if (detail.cost !== null) {
      row.cost += detail.cost
    }
  })

  return rows
}

function buildRecentWindowStats(requestDetails, windowMinutes = RECENT_WINDOW_MINUTES) {
  const now = Date.now()
  const windowStart = now - windowMinutes * 60 * 1000

  let requestCount = 0
  let tokenCount = 0

  requestDetails.forEach((detail) => {
    if (!detail.timestampMs || detail.timestampMs < windowStart || detail.timestampMs > now) return
    requestCount += 1
    tokenCount += detail.totalTokens
  })

  return {
    requestCount,
    tokenCount,
    rpm: requestCount / windowMinutes,
    tpm: tokenCount / windowMinutes,
    windowMinutes,
  }
}

function buildServiceHealthData(requestDetails) {
  const blockCount = SERVICE_HEALTH_ROWS * SERVICE_HEALTH_COLS
  const windowStartDate = new Date()
  windowStartDate.setHours(0, 0, 0, 0)
  windowStartDate.setDate(windowStartDate.getDate() - (SERVICE_HEALTH_ROWS - 1))

  const windowStart = windowStartDate.getTime()
  const windowEnd = windowStart + blockCount * SERVICE_HEALTH_BLOCK_MS
  const blockStats = Array.from({ length: blockCount }, () => ({ success: 0, failure: 0 }))

  let totalSuccess = 0
  let totalFailure = 0

  requestDetails.forEach((detail) => {
    const timestampMs = detail.timestampMs
    if (!timestampMs || timestampMs < windowStart || timestampMs >= windowEnd) return

    const blockIndex = Math.floor((timestampMs - windowStart) / SERVICE_HEALTH_BLOCK_MS)
    if (blockIndex < 0 || blockIndex >= blockCount) return

    if (detail.failed) {
      blockStats[blockIndex].failure += 1
      totalFailure += 1
      return
    }

    blockStats[blockIndex].success += 1
    totalSuccess += 1
  })

  const blocks = blockStats.map((stat, index) => {
    const total = stat.success + stat.failure
    const startTime = windowStart + index * SERVICE_HEALTH_BLOCK_MS
    const endTime = startTime + SERVICE_HEALTH_BLOCK_MS
    const rate = total > 0 ? stat.success / total : -1
    const timeRange = formatHealthBlockTime(startTime, endTime)

    return {
      key: startTime,
      total,
      success: stat.success,
      failure: stat.failure,
      rate,
      color: rateToHealthColor(rate),
      title: total > 0
        ? `${timeRange} | 成功 ${stat.success} | 失败 ${stat.failure} | 成功率 ${(rate * 100).toFixed(1)}%`
        : `${timeRange} | 无请求`,
    }
  })

  const dayRows = Array.from({ length: SERVICE_HEALTH_ROWS }, (_, rowIndex) => {
    const startIndex = rowIndex * SERVICE_HEALTH_COLS
    const rowStartTime = windowStart + startIndex * SERVICE_HEALTH_BLOCK_MS

    return {
      key: rowStartTime,
      label: new Date(rowStartTime).toLocaleDateString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
      }),
      blocks: blocks.slice(startIndex, startIndex + SERVICE_HEALTH_COLS),
    }
  })

  const totalRequests = totalSuccess + totalFailure

  return {
    dayRows,
    totalSuccess,
    totalFailure,
    successRate: totalRequests > 0 ? (totalSuccess / totalRequests) * 100 : 100,
  }
}

function buildApiStats(usage, pricingMap) {
  if (!usage?.apis) return []

  return Object.entries(usage.apis)
    .map(([endpoint, api]) => {
      const modelRows = api?.models
        ? Object.entries(api.models).map(([modelName, modelData]) => {
            const requests = toNonNegativeNumber(modelData?.total_requests ?? modelData?.requests)
            const successCount = toNonNegativeNumber(modelData?.success_count)
            const failureCount = toNonNegativeNumber(modelData?.failure_count)
            const inputTokens = toNonNegativeNumber(modelData?.input_tokens)
            const outputTokens = toNonNegativeNumber(modelData?.output_tokens)
            const cachedTokens = toNonNegativeNumber(modelData?.cached_tokens)
            const reasoningTokens = toNonNegativeNumber(modelData?.reasoning_tokens)
            const totalTokens = toNonNegativeNumber(modelData?.total_tokens)
            const cost = calculateAggregateCost(modelName, inputTokens, outputTokens, cachedTokens, pricingMap)

            return {
              model: modelName,
              requests,
              successCount,
              failureCount,
              inputTokens,
              outputTokens,
              cachedTokens,
              reasoningTokens,
              totalTokens,
              cost,
            }
          })
        : []

      const fallbackRequests = modelRows.reduce((sum, row) => sum + row.requests, 0)
      const fallbackSuccess = modelRows.reduce((sum, row) => sum + row.successCount, 0)
      const fallbackFailure = modelRows.reduce((sum, row) => sum + row.failureCount, 0)
      const fallbackInput = modelRows.reduce((sum, row) => sum + row.inputTokens, 0)
      const fallbackOutput = modelRows.reduce((sum, row) => sum + row.outputTokens, 0)
      const fallbackCached = modelRows.reduce((sum, row) => sum + row.cachedTokens, 0)
      const fallbackReasoning = modelRows.reduce((sum, row) => sum + row.reasoningTokens, 0)
      const fallbackTokens = modelRows.reduce((sum, row) => sum + row.totalTokens, 0)
      const fallbackCost = modelRows.reduce((sum, row) => sum + (row.cost || 0), 0)

      return {
        endpoint,
        requests: toNonNegativeNumber(api?.total_requests) || fallbackRequests,
        successCount: toNonNegativeNumber(api?.success_count) || fallbackSuccess,
        failureCount: toNonNegativeNumber(api?.failure_count) || fallbackFailure,
        inputTokens: toNonNegativeNumber(api?.input_tokens) || fallbackInput,
        outputTokens: toNonNegativeNumber(api?.output_tokens) || fallbackOutput,
        cachedTokens: toNonNegativeNumber(api?.cached_tokens) || fallbackCached,
        reasoningTokens: toNonNegativeNumber(api?.reasoning_tokens) || fallbackReasoning,
        totalTokens: toNonNegativeNumber(api?.total_tokens) || fallbackTokens,
        cost: fallbackCost,
        models: modelRows.sort((a, b) => b.requests - a.requests),
      }
    })
    .sort((a, b) => b.requests - a.requests)
}

function buildModelStats(usage, pricingMap, requestDetails, sortBy) {
  const lastUsedMap = {}
  requestDetails.forEach((detail) => {
    if (!detail.model || !detail.timestampMs) return
    if (!lastUsedMap[detail.model] || detail.timestampMs > lastUsedMap[detail.model]) {
      lastUsedMap[detail.model] = detail.timestampMs
    }
  })

  const summaryRows = Array.isArray(usage?.models_summary)
    ? usage.models_summary
    : []

  const rows = summaryRows.length > 0
    ? summaryRows.map((row) => {
        const model = row.model
        const inputTokens = toNonNegativeNumber(row.input_tokens)
        const outputTokens = toNonNegativeNumber(row.output_tokens)
        const cachedTokens = toNonNegativeNumber(row.cached_tokens)
        const reasoningTokens = toNonNegativeNumber(row.reasoning_tokens)

        return {
          model,
          requests: toNonNegativeNumber(row.total_requests ?? row.requests),
          successCount: toNonNegativeNumber(row.success_count),
          failureCount: toNonNegativeNumber(row.failure_count),
          inputTokens,
          outputTokens,
          cachedTokens,
          reasoningTokens,
          totalTokens: toNonNegativeNumber(row.total_tokens),
          cost: calculateAggregateCost(model, inputTokens, outputTokens, cachedTokens, pricingMap),
          lastUsed: row.last_used || (lastUsedMap[model] ? new Date(lastUsedMap[model]).toISOString() : ''),
        }
      })
    : []

  if (rows.length === 0 && usage?.apis) {
    const modelMap = new Map()
    Object.values(usage.apis).forEach((api) => {
      Object.entries(api?.models || {}).forEach(([model, modelData]) => {
        if (!modelMap.has(model)) {
          modelMap.set(model, {
            model,
            requests: 0,
            successCount: 0,
            failureCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
            cost: null,
            lastUsed: lastUsedMap[model] ? new Date(lastUsedMap[model]).toISOString() : '',
          })
        }

        const row = modelMap.get(model)
        row.requests += toNonNegativeNumber(modelData?.total_requests ?? modelData?.requests)
        row.successCount += toNonNegativeNumber(modelData?.success_count)
        row.failureCount += toNonNegativeNumber(modelData?.failure_count)
        row.inputTokens += toNonNegativeNumber(modelData?.input_tokens)
        row.outputTokens += toNonNegativeNumber(modelData?.output_tokens)
        row.cachedTokens += toNonNegativeNumber(modelData?.cached_tokens)
        row.reasoningTokens += toNonNegativeNumber(modelData?.reasoning_tokens)
        row.totalTokens += toNonNegativeNumber(modelData?.total_tokens)
        row.cost = calculateAggregateCost(model, row.inputTokens, row.outputTokens, row.cachedTokens, pricingMap)
      })
    })

    rows.push(...Array.from(modelMap.values()))
  }

  if (sortBy === 'recent') {
    return rows.sort((a, b) => Date.parse(b.lastUsed || '') - Date.parse(a.lastUsed || ''))
  }

  if (sortBy === 'cost') {
    return rows.sort((a, b) => toSafeNumber(b.cost) - toSafeNumber(a.cost))
  }

  return rows.sort((a, b) => b.totalTokens - a.totalTokens)
}

function buildDailyStats(dailyTrendData) {
  return [...dailyTrendData]
    .filter((row) => row.requests > 0)
    .reverse()
}

function getAvailableModels(usage) {
  if (Array.isArray(usage?.models_summary) && usage.models_summary.length > 0) {
    return usage.models_summary.map((row) => row.model).filter(Boolean).sort()
  }

  if (!usage?.apis) return []

  const models = new Set()
  Object.values(usage.apis).forEach((api) => {
    Object.keys(api?.models || {}).forEach((model) => {
      if (model) {
        models.add(model)
      }
    })
  })
  return Array.from(models).sort()
}

function resolveSourceInfo(request, keyProviderCache) {
  const authIndexKey = request.authIndex === undefined || request.authIndex === null
    ? ''
    : String(request.authIndex)

  const cacheInfo =
    keyProviderCache?.[authIndexKey] ||
    keyProviderCache?.[request.source] ||
    null

  if (!cacheInfo) {
    return {
      label: request.source || '-',
      channel: '',
    }
  }

  if (cacheInfo.channel === 'api-key') {
    return {
      label: cacheInfo.provider || request.source || '-',
      channel: 'api-key',
    }
  }

  return {
    label: cacheInfo.email || cacheInfo.source || request.source || '-',
    channel: cacheInfo.channel || '',
  }
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
        active
          ? 'bg-white text-[#0d0d0d] shadow-sm'
          : 'text-[#6e6e80] hover:text-[#0d0d0d]'
      }`}
    >
      {children}
    </button>
  )
}

function OverviewCard({ title, value, meta = null, valueClassName = 'text-[#0d0d0d]' }) {
  return (
    <div className="p-6 border border-[#e5e5e5] rounded-xl">
      <p className="text-sm text-[#6e6e80] mb-1">{title}</p>
      <p className={`text-3xl font-semibold ${valueClassName}`}>{value}</p>
      {meta && <div className="mt-3 text-xs text-[#6e6e80] space-y-1">{meta}</div>}
    </div>
  )
}

function App({ openCodeEnabled }) {
  const pricingSeededRef = useRef(Object.keys(INITIAL_LOCAL_MODEL_PRICING).length > 0)

  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastExport, setLastExport] = useState(null)
  const [activeTab, setActiveTab] = useState('requests')
  const [keyProviderCache, setKeyProviderCache] = useState({})
  const [modelPricing, setModelPricing] = useState(INITIAL_LOCAL_MODEL_PRICING)
  const [selectedModel, setSelectedModel] = useState('')
  const [promptPrice, setPromptPrice] = useState('')
  const [completionPrice, setCompletionPrice] = useState('')
  const [cachePrice, setCachePrice] = useState('')
  const [requestChartMode, setRequestChartMode] = useState('hourly')
  const [tokenChartMode, setTokenChartMode] = useState('hourly')
  const [modelSortBy, setModelSortBy] = useState('tokens')
  const [requestPage, setRequestPage] = useState(1)
  const [expandedApis, setExpandedApis] = useState({})
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncError, setSyncError] = useState('')

  const fetchUsage = async () => {
    try {
      const res = await fetch('/api/usage')
      if (res.ok) {
        const data = await res.json()
        setUsage(data.usage)
        setLastExport(data.lastExport)
        setKeyProviderCache(data.keyProviderCache || {})

        if (!pricingSeededRef.current) {
          const migratedPricing = migrateServerPricing(data.modelPricing || {})
          if (Object.keys(migratedPricing).length > 0) {
            setModelPricing(migratedPricing)
            pricingSeededRef.current = true
          }
        }
      }
    } catch (e) {
      console.error('获取使用记录失败:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsage()
    const timer = setInterval(fetchUsage, 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    persistLocalModelPricing(modelPricing)
  }, [modelPricing])

  useEffect(() => {
    if (Object.keys(modelPricing).length > 0) {
      pricingSeededRef.current = true
    }
  }, [modelPricing])

  useEffect(() => {
    const es = new EventSource('/api/usage/stream')
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data?.type === 'usage-updated') {
          fetchUsage()
        }
      } catch (e) {
        console.warn('SSE 消息解析失败:', e)
      }
    }
    return () => {
      es.close()
    }
  }, [])

  const handleManualSync = async () => {
    setSyncing(true)
    setSyncError('')
    setSyncMessage('')

    try {
      const res = await fetch('/api/usage/export-now', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || `手动同步失败：${res.status}`)
      }
      if (data.usage) setUsage(data.usage)
      if (data.lastExport) setLastExport(data.lastExport)
      setSyncMessage('手动同步成功')
      fetchUsage()
    } catch (e) {
      setSyncError(e.message || '手动同步失败')
    } finally {
      setSyncing(false)
    }
  }

  const handleSelectPricingModel = (value) => {
    setSelectedModel(value)
    const existing = modelPricing[value]
    if (existing) {
      setPromptPrice(existing.promptPrice.toString())
      setCompletionPrice(existing.completionPrice.toString())
      setCachePrice(existing.cachePrice.toString())
      return
    }
    setPromptPrice('')
    setCompletionPrice('')
    setCachePrice('')
  }

  const handleSavePricing = () => {
    if (!selectedModel) return

    const nextPricing = {
      ...modelPricing,
      [selectedModel]: {
        promptPrice: toNonNegativeNumber(promptPrice),
        completionPrice: toNonNegativeNumber(completionPrice),
        cachePrice: cachePrice.trim() === ''
          ? toNonNegativeNumber(promptPrice)
          : toNonNegativeNumber(cachePrice),
      },
    }

    setModelPricing(nextPricing)
    setSelectedModel('')
    setPromptPrice('')
    setCompletionPrice('')
    setCachePrice('')
  }

  const handleDeletePricing = (model) => {
    const nextPricing = { ...modelPricing }
    delete nextPricing[model]
    setModelPricing(nextPricing)
  }

  const handleClearAllPricing = () => {
    setModelPricing({})
    setSelectedModel('')
    setPromptPrice('')
    setCompletionPrice('')
    setCachePrice('')
  }

  const toggleApiExpand = (endpoint) => {
    setExpandedApis((prev) => ({
      ...prev,
      [endpoint]: !prev[endpoint],
    }))
  }

  const requestDetails = buildRequestDetails(usage, modelPricing)
  const overviewStats = buildOverviewStats(usage, requestDetails)
  const hourlyTrendData = buildTrendData(requestDetails, 'hourly')
  const dailyTrendData = buildTrendData(requestDetails, 'daily')
  const requestChartData = requestChartMode === 'hourly' ? hourlyTrendData : dailyTrendData
  const tokenChartData = tokenChartMode === 'hourly' ? hourlyTrendData : dailyTrendData
  const recentWindowStats = buildRecentWindowStats(requestDetails, RECENT_WINDOW_MINUTES)
  const serviceHealth = buildServiceHealthData(requestDetails)
  const hasServiceHealthData = serviceHealth.totalSuccess + serviceHealth.totalFailure > 0
  const apiStats = buildApiStats(usage, modelPricing)
  const modelStats = buildModelStats(usage, modelPricing, requestDetails, modelSortBy)
  const dailyStats = buildDailyStats(dailyTrendData)
  const availableModels = getAvailableModels(usage)
  const hasAnyPricing = Object.keys(modelPricing).length > 0

  const totalRequestPages = Math.max(1, Math.ceil(requestDetails.length / REQUESTS_PER_PAGE))
  const pagedRequestDetails = requestDetails.slice(
    (requestPage - 1) * REQUESTS_PER_PAGE,
    requestPage * REQUESTS_PER_PAGE
  )

  useEffect(() => {
    setRequestPage(1)
  }, [activeTab, requestDetails.length])

  return (
    <div className="min-h-screen pt-10 pb-20 px-6 bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-end gap-3 mb-8">
          <Link
            to="/codex"
            className="px-4 py-2 text-sm font-medium text-[#0d0d0d] border border-[#e5e5e5] rounded-lg hover:bg-[#f7f7f8] transition-colors inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            CodeX 管理
          </Link>
          {openCodeEnabled && (
            <Link
              to="/opencode"
              className="px-4 py-2 text-sm font-medium text-[#0d0d0d] border border-[#e5e5e5] rounded-lg hover:bg-[#f7f7f8] transition-colors inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              OpenCode
            </Link>
          )}
        </div>

        <div className="mb-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold text-[#0d0d0d] mb-2">使用统计</h1>
              <p className="text-[#6e6e80]">
                按小时与按天查看请求趋势、API 与模型分布、服务健康监测和费用估算 · 最后更新: {formatTime(lastExport)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleManualSync}
                disabled={syncing}
                className="px-4 py-2 text-sm font-medium text-white bg-[#0d0d0d] rounded-lg hover:bg-[#2d2d2d] disabled:opacity-50 transition-colors inline-flex items-center gap-2"
              >
                <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {syncing ? '同步中...' : '手动同步'}
              </button>
            </div>
          </div>
          {syncMessage && <p className="text-sm text-[#10a37f] mt-3">{syncMessage}</p>}
          {syncError && <p className="text-sm text-[#ef4444] mt-3">{syncError}</p>}
        </div>

        {loading && (
          <div className="text-center py-20">
            <div className="inline-block w-8 h-8 border-2 border-[#e5e5e5] border-t-[#0d0d0d] rounded-full animate-spin"></div>
            <p className="mt-4 text-[#6e6e80]">加载中...</p>
          </div>
        )}

        {!loading && (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-8">
              <OverviewCard
                title="总请求数"
                value={formatNumber(overviewStats.totalRequests)}
                meta={
                  <>
                    <p>成功 {formatNumber(overviewStats.successCount)}</p>
                    <p>失败 {formatNumber(overviewStats.failureCount)}</p>
                  </>
                }
              />
              <OverviewCard
                title="总 Token"
                value={formatTokens(overviewStats.totalTokens)}
                meta={
                  <>
                    <p>输入 {formatTokens(overviewStats.totalInputTokens)}</p>
                    <p>输出 {formatTokens(overviewStats.totalOutputTokens)}</p>
                    <p>缓存 {formatTokens(overviewStats.totalCachedTokens)}</p>
                    <p>推理 {formatTokens(overviewStats.totalReasoningTokens)}</p>
                  </>
                }
              />
              <OverviewCard
                title={`RPM (${RECENT_WINDOW_MINUTES} 分钟)`}
                value={formatPerMinute(recentWindowStats.rpm)}
                meta={<p>窗口内请求 {formatNumber(recentWindowStats.requestCount)}</p>}
                valueClassName="text-[#10a37f]"
              />
              <OverviewCard
                title={`TPM (${RECENT_WINDOW_MINUTES} 分钟)`}
                value={formatPerMinute(recentWindowStats.tpm)}
                meta={<p>窗口内 Token {formatTokens(recentWindowStats.tokenCount)}</p>}
                valueClassName="text-[#f59e0b]"
              />
              <OverviewCard
                title="预估费用"
                value={hasAnyPricing ? formatUsd(overviewStats.totalCost) : '--'}
                meta={
                  hasAnyPricing
                    ? <p>按当前浏览器保存的模型价格估算</p>
                    : <p>设置模型价格后可显示费用</p>
                }
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-2 mb-8">
              <div className="border border-[#e5e5e5] rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold text-[#0d0d0d]">请求趋势</h3>
                  <div className="flex gap-1 p-0.5 bg-[#f7f7f8] rounded-md">
                    <button
                      onClick={() => setRequestChartMode('hourly')}
                      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                        requestChartMode === 'hourly' ? 'bg-white text-[#0d0d0d] shadow-sm' : 'text-[#6e6e80]'
                      }`}
                    >
                      24小时
                    </button>
                    <button
                      onClick={() => setRequestChartMode('daily')}
                      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                        requestChartMode === 'daily' ? 'bg-white text-[#0d0d0d] shadow-sm' : 'text-[#6e6e80]'
                      }`}
                    >
                      30天
                    </button>
                  </div>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={requestChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#6e6e80" />
                      <YAxis tick={{ fontSize: 10 }} stroke="#6e6e80" width={40} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e5e5' }}
                        formatter={(value) => [formatNumber(value), '请求数']}
                      />
                      <Line type="monotone" dataKey="requests" stroke="#0d0d0d" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="border border-[#e5e5e5] rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold text-[#0d0d0d]">Token 趋势</h3>
                  <div className="flex gap-1 p-0.5 bg-[#f7f7f8] rounded-md">
                    <button
                      onClick={() => setTokenChartMode('hourly')}
                      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                        tokenChartMode === 'hourly' ? 'bg-white text-[#0d0d0d] shadow-sm' : 'text-[#6e6e80]'
                      }`}
                    >
                      24小时
                    </button>
                    <button
                      onClick={() => setTokenChartMode('daily')}
                      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                        tokenChartMode === 'daily' ? 'bg-white text-[#0d0d0d] shadow-sm' : 'text-[#6e6e80]'
                      }`}
                    >
                      30天
                    </button>
                  </div>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={tokenChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#6e6e80" />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        stroke="#6e6e80"
                        width={45}
                        tickFormatter={(value) => formatTokens(value)}
                      />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e5e5' }}
                        formatter={(value) => [formatTokens(value), 'Tokens']}
                      />
                      <Line type="monotone" dataKey="totalTokens" stroke="#10a37f" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="border border-[#e5e5e5] rounded-xl p-6 mb-8">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-5">
                <div>
                  <h3 className="text-base font-semibold text-[#0d0d0d]">服务健康监测</h3>
                  <p className="text-sm text-[#6e6e80] mt-1">最近 7 天，每格 15 分钟，按请求成功率显示服务健康状态</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="min-w-[140px] rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-4 py-3">
                    <p className="text-xs text-[#6e6e80]">整体成功率</p>
                    <p className={`mt-1 text-lg font-semibold ${
                      !hasServiceHealthData
                        ? 'text-[#0d0d0d]'
                        : serviceHealth.successRate >= 99
                          ? 'text-[#15803d]'
                          : serviceHealth.successRate >= 95
                            ? 'text-[#b45309]'
                            : 'text-[#dc2626]'
                    }`}>
                      {hasServiceHealthData ? `${serviceHealth.successRate.toFixed(1)}%` : '--'}
                    </p>
                  </div>
                  <div className="min-w-[140px] rounded-lg border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3">
                    <p className="text-xs text-[#166534]">成功请求</p>
                    <p className="mt-1 text-lg font-semibold text-[#166534]">
                      {formatNumber(serviceHealth.totalSuccess)}
                    </p>
                  </div>
                  <div className="min-w-[140px] rounded-lg border border-[#fecaca] bg-[#fef2f2] px-4 py-3">
                    <p className="text-xs text-[#b91c1c]">失败请求</p>
                    <p className="mt-1 text-lg font-semibold text-[#b91c1c]">
                      {formatNumber(serviceHealth.totalFailure)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto pb-1">
                <div className="min-w-[1120px]">
                  <div className="space-y-2">
                    {serviceHealth.dayRows.map((row) => (
                      <div key={row.key} className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-3">
                        <div className="text-xs text-[#6e6e80] tabular-nums">{row.label}</div>
                        <div
                          className="grid gap-1"
                          style={{ gridTemplateColumns: `repeat(${SERVICE_HEALTH_COLS}, minmax(0, 1fr))` }}
                        >
                          {row.blocks.map((block) => (
                            <div
                              key={block.key}
                              title={block.title}
                              className={`h-2.5 rounded-[3px] transition-transform duration-150 hover:scale-y-125 ${
                                block.total === 0 ? 'border border-[#e2e8f0]' : ''
                              }`}
                              style={{ backgroundColor: block.color }}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-3 mt-3">
                    <div />
                    <div
                      className="grid text-[11px] text-[#94a3b8]"
                      style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
                    >
                      <span className="text-left">00:00</span>
                      <span className="text-center">06:00</span>
                      <span className="text-center">12:00</span>
                      <span className="text-center">18:00</span>
                      <span className="text-right">24:00</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-[#6e6e80]">
                <span>图例</span>
                <span className="inline-flex items-center gap-2">
                  <span className="w-3 h-3 rounded-[3px] border border-[#e2e8f0] bg-[#f8fafc]" />
                  空闲
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="w-3 h-3 rounded-[3px] bg-[#ef4444]" />
                  失败较多
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="w-3 h-3 rounded-[3px] bg-[#f59e0b]" />
                  部分失败
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="w-3 h-3 rounded-[3px] bg-[#22c55e]" />
                  健康
                </span>
                {!hasServiceHealthData && (
                  <span className="text-[#94a3b8]">最近 7 天暂无请求，当前全部显示为空闲窗口</span>
                )}
              </div>
            </div>

            <div className="flex gap-1 p-1 bg-[#f7f7f8] rounded-lg mb-6 w-fit flex-wrap">
              <TabButton active={activeTab === 'requests'} onClick={() => setActiveTab('requests')}>
                请求记录
              </TabButton>
              <TabButton active={activeTab === 'apis'} onClick={() => setActiveTab('apis')}>
                API 统计
              </TabButton>
              <TabButton active={activeTab === 'models'} onClick={() => setActiveTab('models')}>
                模型统计
              </TabButton>
              <TabButton active={activeTab === 'daily'} onClick={() => setActiveTab('daily')}>
                每日汇总
              </TabButton>
              <TabButton active={activeTab === 'pricing'} onClick={() => setActiveTab('pricing')}>
                模型价格
              </TabButton>
            </div>

            {activeTab === 'requests' && (
              <div className="border border-[#e5e5e5] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1280px]">
                    <thead className="bg-[#f7f7f8] border-b border-[#e5e5e5]">
                      <tr>
                        <th className="text-left px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">时间</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">API</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">模型</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">来源</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">输入</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">输出</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">缓存</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">推理</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">总计</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">费用</th>
                        <th className="text-center px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">状态</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e5e5e5]">
                      {requestDetails.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="px-4 py-12 text-center text-[#6e6e80]">暂无请求记录</td>
                        </tr>
                      ) : (
                        pagedRequestDetails.map((request) => {
                          const sourceInfo = resolveSourceInfo(request, keyProviderCache)

                          return (
                            <tr key={request.id} className="hover:bg-[#f7f7f8] transition-colors">
                              <td className="px-4 py-3">
                                <p className="text-sm font-medium text-[#0d0d0d]">{formatTime(request.timestamp)}</p>
                                <p className="text-xs text-[#6e6e80]">{formatRelativeTime(request.timestamp)}</p>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm text-[#0d0d0d]">{request.endpoint}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-[#f0f0f0] text-[#0d0d0d]">
                                  {request.model}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-[#0d0d0d] truncate max-w-[220px]" title={sourceInfo.label}>
                                    {sourceInfo.label}
                                  </span>
                                  {sourceInfo.channel && (
                                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[#e5e5e5] text-[#6e6e80] uppercase">
                                      {sourceInfo.channel}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right text-sm text-[#6e6e80]">{formatTokens(request.inputTokens)}</td>
                              <td className="px-4 py-3 text-right text-sm text-[#6e6e80]">{formatTokens(request.outputTokens)}</td>
                              <td className="px-4 py-3 text-right text-sm text-[#3b82f6]">{formatTokens(request.cachedTokens)}</td>
                              <td className="px-4 py-3 text-right text-sm text-[#f59e0b]">{formatTokens(request.reasoningTokens)}</td>
                              <td className="px-4 py-3 text-right text-sm font-medium text-[#0d0d0d]">{formatTokens(request.totalTokens)}</td>
                              <td className="px-4 py-3 text-right text-sm text-[#6e6e80]">
                                {request.hasPrice ? formatUsd(request.cost) : '-'}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {request.failed ? (
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[#fef2f2] text-[#ef4444]">
                                    失败
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[#f0fdf4] text-[#10a37f]">
                                    成功
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {requestDetails.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-[#e5e5e5] bg-white">
                    <p className="text-xs text-[#6e6e80]">
                      第 {requestPage} / {totalRequestPages} 页 · 共 {requestDetails.length} 条
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setRequestPage((page) => Math.max(1, page - 1))}
                        disabled={requestPage === 1}
                        className="px-3 py-1.5 text-xs font-medium border border-[#e5e5e5] rounded-md text-[#6e6e80] hover:text-[#0d0d0d] hover:border-[#0d0d0d] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        上一页
                      </button>
                      <button
                        onClick={() => setRequestPage((page) => Math.min(totalRequestPages, page + 1))}
                        disabled={requestPage === totalRequestPages}
                        className="px-3 py-1.5 text-xs font-medium border border-[#e5e5e5] rounded-md text-[#6e6e80] hover:text-[#0d0d0d] hover:border-[#0d0d0d] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'apis' && (
              <div className="space-y-4">
                {apiStats.length === 0 ? (
                  <div className="border border-[#e5e5e5] rounded-xl p-8 text-center text-[#6e6e80]">
                    暂无 API 统计数据
                  </div>
                ) : (
                  apiStats.map((api) => (
                    <div key={api.endpoint} className="border border-[#e5e5e5] rounded-xl overflow-hidden">
                      <button
                        onClick={() => toggleApiExpand(api.endpoint)}
                        className="w-full px-6 py-5 flex items-start justify-between gap-4 hover:bg-[#f7f7f8] transition-colors text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-base font-semibold text-[#0d0d0d] break-all">{api.endpoint}</p>
                          <div className="flex flex-wrap gap-2 mt-3 text-xs">
                            <span className="px-2 py-1 rounded-full bg-[#f7f7f8] text-[#0d0d0d]">请求 {formatNumber(api.requests)}</span>
                            <span className="px-2 py-1 rounded-full bg-[#f0fdf4] text-[#10a37f]">成功 {formatNumber(api.successCount)}</span>
                            <span className="px-2 py-1 rounded-full bg-[#fef2f2] text-[#ef4444]">失败 {formatNumber(api.failureCount)}</span>
                            <span className="px-2 py-1 rounded-full bg-[#eff6ff] text-[#2563eb]">缓存 {formatTokens(api.cachedTokens)}</span>
                            <span className="px-2 py-1 rounded-full bg-[#fff7ed] text-[#c2410c]">推理 {formatTokens(api.reasoningTokens)}</span>
                            <span className="px-2 py-1 rounded-full bg-[#f7f7f8] text-[#0d0d0d]">总 Token {formatTokens(api.totalTokens)}</span>
                            {hasAnyPricing && (
                              <span className="px-2 py-1 rounded-full bg-[#fffbeb] text-[#b45309]">费用 {formatUsd(api.cost)}</span>
                            )}
                          </div>
                        </div>
                        <svg
                          className={`w-5 h-5 text-[#6e6e80] transition-transform ${expandedApis[api.endpoint] ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {expandedApis[api.endpoint] && (
                        <div className="px-6 pb-6 border-t border-[#e5e5e5]">
                          <div className="overflow-x-auto mt-4">
                            <table className="w-full min-w-[920px]">
                              <thead>
                                <tr className="border-b border-[#e5e5e5]">
                                  <th className="text-left py-3 pr-4 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">模型</th>
                                  <th className="text-right py-3 px-2 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">请求</th>
                                  <th className="text-right py-3 px-2 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">成功</th>
                                  <th className="text-right py-3 px-2 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">失败</th>
                                  <th className="text-right py-3 px-2 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">缓存</th>
                                  <th className="text-right py-3 px-2 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">推理</th>
                                  <th className="text-right py-3 px-2 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">总 Token</th>
                                  <th className="text-right py-3 pl-4 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">费用</th>
                                </tr>
                              </thead>
                              <tbody>
                                {api.models.map((model) => (
                                  <tr key={`${api.endpoint}-${model.model}`} className="border-b border-[#f0f0f0] last:border-0">
                                    <td className="py-3 pr-4 text-sm font-medium text-[#0d0d0d]">{model.model}</td>
                                    <td className="py-3 px-2 text-right text-sm text-[#6e6e80]">{formatNumber(model.requests)}</td>
                                    <td className="py-3 px-2 text-right text-sm text-[#10a37f]">{formatNumber(model.successCount)}</td>
                                    <td className="py-3 px-2 text-right text-sm text-[#ef4444]">{formatNumber(model.failureCount)}</td>
                                    <td className="py-3 px-2 text-right text-sm text-[#2563eb]">{formatTokens(model.cachedTokens)}</td>
                                    <td className="py-3 px-2 text-right text-sm text-[#c2410c]">{formatTokens(model.reasoningTokens)}</td>
                                    <td className="py-3 px-2 text-right text-sm font-medium text-[#0d0d0d]">{formatTokens(model.totalTokens)}</td>
                                    <td className="py-3 pl-4 text-right text-sm text-[#6e6e80]">
                                      {hasAnyPricing && model.cost !== null ? formatUsd(model.cost) : '-'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'models' && (
              <div className="border border-[#e5e5e5] rounded-xl p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-base font-semibold text-[#0d0d0d]">模型统计</h3>
                  <div className="flex gap-1 p-0.5 bg-[#f7f7f8] rounded-md">
                    <button
                      onClick={() => setModelSortBy('tokens')}
                      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                        modelSortBy === 'tokens' ? 'bg-white text-[#0d0d0d] shadow-sm' : 'text-[#6e6e80]'
                      }`}
                    >
                      按 Token
                    </button>
                    <button
                      onClick={() => setModelSortBy('recent')}
                      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                        modelSortBy === 'recent' ? 'bg-white text-[#0d0d0d] shadow-sm' : 'text-[#6e6e80]'
                      }`}
                    >
                      按最近
                    </button>
                    <button
                      onClick={() => setModelSortBy('cost')}
                      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                        modelSortBy === 'cost' ? 'bg-white text-[#0d0d0d] shadow-sm' : 'text-[#6e6e80]'
                      }`}
                    >
                      按费用
                    </button>
                  </div>
                </div>

                {modelStats.length === 0 ? (
                  <p className="text-[#6e6e80] text-sm text-center py-8">暂无模型统计数据</p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {modelStats.map((model) => (
                      <div key={model.model} className="p-5 bg-[#f7f7f8] rounded-xl border border-[#ececec]">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-base font-semibold text-[#0d0d0d] break-all">{model.model}</p>
                            <p className="text-xs text-[#6e6e80] mt-1">最近使用 {formatRelativeTime(model.lastUsed)}</p>
                          </div>
                          <span className="text-xs px-2 py-1 rounded-full bg-white text-[#6e6e80] border border-[#e5e5e5]">
                            {formatNumber(model.requests)} 次
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                          <div className="p-3 bg-white rounded-lg border border-[#e5e5e5]">
                            <p className="text-[#6e6e80] text-xs">总 Token</p>
                            <p className="text-[#0d0d0d] font-semibold mt-1">{formatTokens(model.totalTokens)}</p>
                          </div>
                          <div className="p-3 bg-white rounded-lg border border-[#e5e5e5]">
                            <p className="text-[#6e6e80] text-xs">预估费用</p>
                            <p className="text-[#0d0d0d] font-semibold mt-1">
                              {hasAnyPricing && model.cost !== null ? formatUsd(model.cost) : '-'}
                            </p>
                          </div>
                          <div className="p-3 bg-white rounded-lg border border-[#e5e5e5]">
                            <p className="text-[#6e6e80] text-xs">缓存 Token</p>
                            <p className="text-[#2563eb] font-semibold mt-1">{formatTokens(model.cachedTokens)}</p>
                          </div>
                          <div className="p-3 bg-white rounded-lg border border-[#e5e5e5]">
                            <p className="text-[#6e6e80] text-xs">推理 Token</p>
                            <p className="text-[#c2410c] font-semibold mt-1">{formatTokens(model.reasoningTokens)}</p>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2 text-xs">
                          <span className="px-2 py-1 rounded-full bg-[#f0fdf4] text-[#10a37f]">成功 {formatNumber(model.successCount)}</span>
                          <span className="px-2 py-1 rounded-full bg-[#fef2f2] text-[#ef4444]">失败 {formatNumber(model.failureCount)}</span>
                          <span className="px-2 py-1 rounded-full bg-white text-[#6e6e80] border border-[#e5e5e5]">输入 {formatTokens(model.inputTokens)}</span>
                          <span className="px-2 py-1 rounded-full bg-white text-[#6e6e80] border border-[#e5e5e5]">输出 {formatTokens(model.outputTokens)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'daily' && (
              <div className="border border-[#e5e5e5] rounded-xl p-6">
                {dailyStats.length === 0 ? (
                  <p className="text-[#6e6e80] text-sm text-center py-8">暂无每日汇总数据</p>
                ) : (
                  <div className="space-y-3">
                    {dailyStats.map((day) => (
                      <div key={day.key} className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-4 bg-[#f7f7f8] rounded-xl">
                        <div>
                          <p className="text-base font-medium text-[#0d0d0d]">{day.fullDate || day.label}</p>
                          <div className="flex flex-wrap gap-2 mt-2 text-xs text-[#6e6e80]">
                            <span>输入 {formatTokens(day.inputTokens)}</span>
                            <span>输出 {formatTokens(day.outputTokens)}</span>
                            <span>缓存 {formatTokens(day.cachedTokens)}</span>
                            <span>推理 {formatTokens(day.reasoningTokens)}</span>
                            {hasAnyPricing && <span>费用 {formatUsd(day.cost)}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-right">
                          <div>
                            <p className="text-xs text-[#6e6e80]">请求</p>
                            <p className="text-2xl font-semibold text-[#0d0d0d]">{formatNumber(day.requests)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-[#6e6e80]">总 Token</p>
                            <p className="text-xl font-semibold text-[#0d0d0d]">{formatTokens(day.totalTokens)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'pricing' && (
              <div className="border border-[#e5e5e5] rounded-xl p-6">
                <div className="flex flex-col gap-2 mb-6">
                  <h3 className="text-base font-semibold text-[#0d0d0d]">模型价格</h3>
                  <p className="text-sm text-[#6e6e80]">
                    价格仅保存在当前浏览器，用于费用估算，不会写回服务器配置。
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_140px_140px_140px_auto] items-end mb-8">
                  <div>
                    <label className="block text-xs text-[#6e6e80] mb-1">选择模型</label>
                    <select
                      value={selectedModel}
                      onChange={(event) => handleSelectPricingModel(event.target.value)}
                      className="w-full px-3 py-2 border border-[#e5e5e5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0d0d0d]"
                    >
                      <option value="">选择模型...</option>
                      {availableModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[#6e6e80] mb-1">Prompt ($/1M)</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={promptPrice}
                      onChange={(event) => setPromptPrice(event.target.value)}
                      placeholder="0.0000"
                      className="w-full px-3 py-2 border border-[#e5e5e5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0d0d0d]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6e6e80] mb-1">Completion ($/1M)</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={completionPrice}
                      onChange={(event) => setCompletionPrice(event.target.value)}
                      placeholder="0.0000"
                      className="w-full px-3 py-2 border border-[#e5e5e5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0d0d0d]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6e6e80] mb-1">Cache ($/1M)</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={cachePrice}
                      onChange={(event) => setCachePrice(event.target.value)}
                      placeholder="默认同 Prompt"
                      className="w-full px-3 py-2 border border-[#e5e5e5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0d0d0d]"
                    />
                  </div>
                  <button
                    onClick={handleSavePricing}
                    disabled={!selectedModel}
                    className="px-4 py-2 bg-[#0d0d0d] text-white text-sm font-medium rounded-lg hover:bg-[#2d2d2d] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    保存
                  </button>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-[#0d0d0d]">已保存的模型价格</h4>
                  {Object.keys(modelPricing).length > 0 && (
                    <button
                      onClick={handleClearAllPricing}
                      className="text-xs text-[#ef4444] hover:text-[#dc2626] transition-colors"
                    >
                      清空全部
                    </button>
                  )}
                </div>

                {Object.keys(modelPricing).length === 0 ? (
                  <p className="text-[#6e6e80] text-sm text-center py-8">暂未设置任何模型价格</p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {Object.entries(modelPricing).map(([model, pricing]) => (
                      <div key={model} className="flex items-start justify-between gap-3 p-4 bg-[#f7f7f8] rounded-xl border border-[#ececec]">
                        <div>
                          <p className="text-sm font-medium text-[#0d0d0d] break-all">{model}</p>
                          <div className="text-xs text-[#6e6e80] mt-2 space-y-1">
                            <p>Prompt: {formatUsd(pricing.promptPrice)}/1M</p>
                            <p>Completion: {formatUsd(pricing.completionPrice)}/1M</p>
                            <p>Cache: {formatUsd(pricing.cachePrice)}/1M</p>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => handleSelectPricingModel(model)}
                            className="px-3 py-1.5 text-xs font-medium border border-[#e5e5e5] rounded-md text-[#6e6e80] hover:text-[#0d0d0d] hover:border-[#0d0d0d] transition-colors"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleDeletePricing(model)}
                            className="px-3 py-1.5 text-xs font-medium border border-[#fecaca] rounded-md text-[#ef4444] hover:text-[#dc2626] hover:border-[#fca5a5] transition-colors"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!usage && activeTab !== 'pricing' && (
              <div className="text-center py-16 text-[#6e6e80]">
                <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <p className="text-lg">暂无使用记录</p>
                <p className="text-sm mt-2">等待 CLI Proxy 产生使用数据后自动同步</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default App
