import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { apiFetch, createApiEventSource } from './auth.js'
import { ActionButton, AppShell, InlineIcon } from './components/ui'
import { useI18n } from './i18n/useI18n'
import { MODEL_PRICING_PRESETS } from './modelPricingPresets'
import {
  loadLocalModelPricingState,
  mergeModelPricingMaps,
  migrateServerPricing,
  persistLocalModelPricingState,
} from './modelPricingState'
import {
  buildScopedCacheKey,
  type CpaInstance,
  fetchCpaInstances,
  getActiveCpaInstance,
  getCpaInstanceStatusClass,
  getCpaInstanceStatusLabel,
} from './cpaInstances'
import { buildPrimaryNav } from './navigation'
import { useTheme } from './theme/useTheme'

const DEFAULT_REQUESTS_PER_PAGE = 10
const REQUESTS_PER_PAGE_OPTIONS = [10, 20, 50, 100]
const RECENT_WINDOW_MINUTES = 30
const SERVICE_HEALTH_ROWS = 7
const SERVICE_HEALTH_COLS = 48
const SERVICE_HEALTH_BLOCK_MS = 30 * 60 * 1000
const SERVICE_HEALTH_AXIS_STEP = SERVICE_HEALTH_COLS / 4
const SERVICE_HEALTH_ACTIVITY_LABELS = ['无请求', '需关注', '平稳', '稳定', '强劲']
const SERVICE_HEALTH_PALETTES = {
  dark: {
    fills: [
      'rgba(255, 255, 255, 0.035)',
      'rgba(255, 255, 255, 0.12)',
      'rgba(255, 255, 255, 0.24)',
      'rgba(255, 255, 255, 0.42)',
      'rgba(255, 255, 255, 0.72)',
    ],
    borders: [
      'rgba(255, 255, 255, 0.08)',
      'rgba(255, 255, 255, 0.1)',
      'rgba(255, 255, 255, 0.12)',
      'rgba(255, 255, 255, 0.16)',
      'rgba(255, 255, 255, 0.22)',
    ],
  },
  light: {
    fills: [
      'rgba(17, 17, 17, 0.035)',
      'rgba(17, 17, 17, 0.12)',
      'rgba(17, 17, 17, 0.24)',
      'rgba(17, 17, 17, 0.42)',
      'rgba(17, 17, 17, 0.68)',
    ],
    borders: [
      'rgba(17, 17, 17, 0.06)',
      'rgba(17, 17, 17, 0.08)',
      'rgba(17, 17, 17, 0.12)',
      'rgba(17, 17, 17, 0.16)',
      'rgba(17, 17, 17, 0.2)',
    ],
  },
}
const SERVICE_HEALTH_AXIS_MARKERS = [
  { label: '00:00', columnStart: 1, justifySelf: 'start', translateX: '0%' },
  { label: '06:00', columnStart: SERVICE_HEALTH_AXIS_STEP + 1, justifySelf: 'start', translateX: '-50%' },
  { label: '12:00', columnStart: SERVICE_HEALTH_AXIS_STEP * 2 + 1, justifySelf: 'start', translateX: '-50%' },
  { label: '18:00', columnStart: SERVICE_HEALTH_AXIS_STEP * 3 + 1, justifySelf: 'start', translateX: '-50%' },
  { label: '24:00', columnStart: SERVICE_HEALTH_COLS, justifySelf: 'end', translateX: '0%' },
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

export function formatLocalDateKey(date) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function maskSensitiveValue(value) {
  const text = typeof value === 'string' ? value.trim() : String(value || '').trim()
  if (!text) return '-'
  if (text.length <= 8) {
    return `${text.slice(0, 2)}***${text.slice(-2)}`
  }
  return `${text.slice(0, 4)}***${text.slice(-4)}`
}

function resolveServiceHealthLevel(total, rate, maxTotal) {
  if (total <= 0 || rate < 0) return 0

  const activityWeight = maxTotal > 0
    ? Math.log(total + 1) / Math.log(maxTotal + 1)
    : 0
  const score = rate * 0.82 + activityWeight * 0.18

  if (score >= 0.97) return 4
  if (score >= 0.87) return 3
  if (score >= 0.72) return 2
  return 1
}

function getServiceHealthPalette(theme) {
  return theme === 'dark' ? SERVICE_HEALTH_PALETTES.dark : SERVICE_HEALTH_PALETTES.light
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
const INITIAL_LOCAL_MODEL_PRICING_STATE = loadLocalModelPricingState()

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
          id: `${detail?.instance_id || 'all'}-${endpoint}-${modelName}-${detail?.timestamp || index}-${index}`,
          endpoint,
          model: modelName,
          source: detail?.source || '',
          authIndex: detail?.auth_index ?? '',
          instanceId: detail?.instance_id ?? null,
          instanceName: detail?.instance_name || '',
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
      fullDate: formatLocalDateKey(bucketDate),
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

  const maxBlockTotal = blockStats.reduce(
    (max, stat) => Math.max(max, stat.success + stat.failure),
    0
  )
  let activeWindowCount = 0
  let strongWindowCount = 0
  let watchWindowCount = 0

  const blocks = blockStats.map((stat, index) => {
    const total = stat.success + stat.failure
    const startTime = windowStart + index * SERVICE_HEALTH_BLOCK_MS
    const endTime = startTime + SERVICE_HEALTH_BLOCK_MS
    const rate = total > 0 ? stat.success / total : -1
    const timeRange = formatHealthBlockTime(startTime, endTime)
    const level = resolveServiceHealthLevel(total, rate, maxBlockTotal)

    if (total > 0) {
      activeWindowCount += 1
      if (level >= 3) {
        strongWindowCount += 1
      } else if (level === 1) {
        watchWindowCount += 1
      }
    }

    return {
      key: startTime,
      total,
      success: stat.success,
      failure: stat.failure,
      rate,
      level,
      title: total > 0
        ? `${timeRange} | 成功 ${stat.success} | 失败 ${stat.failure} | 成功率 ${(rate * 100).toFixed(1)}% | 活跃度 ${SERVICE_HEALTH_ACTIVITY_LABELS[level]}`
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
    activeWindowCount,
    strongWindowCount,
    watchWindowCount,
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

function resolveCredentialStatInfo(detail, keyProviderCache) {
  const authIndexKey = detail.authIndex === undefined || detail.authIndex === null
    ? ''
    : String(detail.authIndex)
  const sourceKey = detail.source || ''
  const authInfo = authIndexKey ? keyProviderCache?.[buildScopedCacheKey(detail.instanceId, 'auth', authIndexKey)] : null
  const sourceInfo = sourceKey ? keyProviderCache?.[buildScopedCacheKey(detail.instanceId, 'source', sourceKey)] : null
  const cacheInfo = authInfo || sourceInfo || null

  const displayName =
    authInfo?.email ||
    sourceInfo?.email ||
    (cacheInfo?.channel === 'api-key'
      ? cacheInfo?.provider
      : cacheInfo?.provider || cacheInfo?.source) ||
    (authIndexKey ? `认证索引 ${authIndexKey}` : '') ||
    (sourceKey ? maskSensitiveValue(sourceKey) : '未知凭证')

  const subtitleParts = []
  if (detail.instanceName) {
    subtitleParts.push(`实例: ${detail.instanceName}`)
  }
  if (authIndexKey) {
    subtitleParts.push(`auth_index: ${authIndexKey}`)
  } else if (sourceKey) {
    subtitleParts.push(`source: ${maskSensitiveValue(sourceKey)}`)
  }

  return {
    key: authIndexKey
      ? `instance:${detail.instanceId}:auth:${authIndexKey}`
      : sourceKey
        ? `instance:${detail.instanceId}:source:${sourceKey}`
        : `unknown:${detail.id}`,
    displayName,
    subtitle: subtitleParts.join(' · '),
    type: authInfo?.channel || sourceInfo?.channel || '',
  }
}

function buildCredentialStats(requestDetails, keyProviderCache) {
  const rowsByKey = new Map()

  requestDetails.forEach((detail) => {
    const credentialInfo = resolveCredentialStatInfo(detail, keyProviderCache)
    if (!rowsByKey.has(credentialInfo.key)) {
      rowsByKey.set(credentialInfo.key, {
        key: credentialInfo.key,
        displayName: credentialInfo.displayName,
        subtitle: credentialInfo.subtitle,
        type: credentialInfo.type,
        requests: 0,
        successCount: 0,
        failureCount: 0,
        totalTokens: 0,
        totalCost: 0,
        pricedRequestCount: 0,
        lastUsedMs: 0,
        lastUsed: '',
      })
    }

    const row = rowsByKey.get(credentialInfo.key)
    row.requests += 1
    row.successCount += detail.failed ? 0 : 1
    row.failureCount += detail.failed ? 1 : 0
    row.totalTokens += detail.totalTokens
    if (detail.cost !== null) {
      row.totalCost += detail.cost
      row.pricedRequestCount += 1
    }
    if (detail.timestampMs > row.lastUsedMs) {
      row.lastUsedMs = detail.timestampMs
      row.lastUsed = detail.timestamp
    }
  })

  return Array.from(rowsByKey.values())
    .map((row) => ({
      ...row,
      successRate: row.requests > 0 ? (row.successCount / row.requests) * 100 : 100,
    }))
    .sort((a, b) => {
      if (b.requests !== a.requests) return b.requests - a.requests
      return b.lastUsedMs - a.lastUsedMs
    })
}

function resolveSourceInfo(request, keyProviderCache) {
  const authIndexKey = request.authIndex === undefined || request.authIndex === null
    ? ''
    : String(request.authIndex)

  const cacheInfo =
    keyProviderCache?.[buildScopedCacheKey(request.instanceId, 'auth', authIndexKey)] ||
    keyProviderCache?.[buildScopedCacheKey(request.instanceId, 'source', request.source)] ||
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
      className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
        active
          ? 'border border-[var(--border-color)] bg-[var(--bg-card-strong)] text-[var(--text-primary)] shadow-[var(--shadow-soft)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  )
}

function OverviewCard({ title, value, meta = null, valueClassName = 'text-[#0d0d0d]' }) {
  return (
    <div className="surface-panel-subtle rounded-[24px] border p-6">
      <p className="mb-1 text-sm text-[var(--text-secondary)]">{title}</p>
      <p className={`text-3xl font-semibold ${valueClassName}`}>{value}</p>
      {meta && <div className="mt-3 space-y-1 text-xs text-[var(--text-secondary)]">{meta}</div>}
    </div>
  )
}

function App() {
  const pricingSeededRef = useRef(INITIAL_LOCAL_MODEL_PRICING_STATE.hasStoredPricing)
  const { t } = useI18n()
  const { resolvedTheme } = useTheme()

  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastExport, setLastExport] = useState(null)
  const [activeTab, setActiveTab] = useState('requests')
  const [keyProviderCache, setKeyProviderCache] = useState({})
  const [modelPricing, setModelPricing] = useState(INITIAL_LOCAL_MODEL_PRICING_STATE.pricing)
  const [removedPresetModels, setRemovedPresetModels] = useState(
    INITIAL_LOCAL_MODEL_PRICING_STATE.removedPresetModels
  )
  const [presetOptIn, setPresetOptIn] = useState(INITIAL_LOCAL_MODEL_PRICING_STATE.presetOptIn)
  const [selectedModel, setSelectedModel] = useState('')
  const [promptPrice, setPromptPrice] = useState('')
  const [completionPrice, setCompletionPrice] = useState('')
  const [cachePrice, setCachePrice] = useState('')
  const [requestChartMode, setRequestChartMode] = useState('hourly')
  const [tokenChartMode, setTokenChartMode] = useState('hourly')
  const [modelSortBy, setModelSortBy] = useState('tokens')
  const [requestPage, setRequestPage] = useState(1)
  const [requestsPerPage, setRequestsPerPage] = useState(DEFAULT_REQUESTS_PER_PAGE)
  const [expandedApis, setExpandedApis] = useState({})
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncError, setSyncError] = useState('')
  const [instances, setInstances] = useState<CpaInstance[]>([])
  const [usageScope, setUsageScope] = useState<'instance' | 'all'>('instance')
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | ''>('')
  const [viewInstanceName, setViewInstanceName] = useState('')
  const navItems = useMemo(() => buildPrimaryNav(t), [t])
  const chartTheme = useMemo(() => (
    resolvedTheme === 'dark'
      ? {
          grid: 'rgba(255,255,255,0.11)',
          axis: 'rgba(255,255,255,0.68)',
          tooltipBg: 'rgba(10,10,10,0.92)',
          tooltipBorder: 'rgba(255,255,255,0.12)',
          requestLine: '#f8f8f4',
          tokenLine: '#93c5fd',
        }
      : {
          grid: 'rgba(17,17,17,0.08)',
          axis: 'rgba(17,17,17,0.58)',
          tooltipBg: 'rgba(255,255,255,0.94)',
          tooltipBorder: 'rgba(17,17,17,0.08)',
          requestLine: '#121212',
          tokenLine: '#0f766e',
        }
  ), [resolvedTheme])
  const serviceHealthPalette = useMemo(
    () => getServiceHealthPalette(resolvedTheme),
    [resolvedTheme]
  )
  const activeInstance = useMemo(() => getActiveCpaInstance(instances), [instances])
  const selectedInstance = useMemo(() => {
    const numericId = Number(selectedInstanceId)
    if (Number.isFinite(numericId)) {
      return instances.find((instance) => instance.id === numericId) || activeInstance || null
    }
    return activeInstance || null
  }, [activeInstance, instances, selectedInstanceId])
  const currentStatusInstance = usageScope === 'all' ? activeInstance : selectedInstance
  const currentViewLabel = usageScope === 'all'
    ? t('Total summary')
    : viewInstanceName || selectedInstance?.name || t('Current instance')
  const manualSyncDisabled = syncing || (usageScope === 'instance' && !selectedInstance?.isEnabled)

  const resolveSelectedInstanceId = (nextInstances: CpaInstance[], requestedId: number | '' = selectedInstanceId) => {
    const numericId = Number(requestedId)
    if (Number.isFinite(numericId) && nextInstances.some((instance) => instance.id === numericId)) {
      return numericId
    }

    return getActiveCpaInstance(nextInstances)?.id || nextInstances[0]?.id || null
  }

  const fetchUsage = async (nextScope: 'instance' | 'all' = usageScope, requestedInstanceId: number | '' = selectedInstanceId) => {
    try {
      const nextInstances = await fetchCpaInstances()
      setInstances(nextInstances)

      const resolvedInstanceId = resolveSelectedInstanceId(nextInstances, requestedInstanceId)
      if (nextScope === 'instance' && resolvedInstanceId !== null && resolvedInstanceId !== selectedInstanceId) {
        setSelectedInstanceId(resolvedInstanceId)
      }

      const params = new URLSearchParams()
      if (nextScope === 'all') {
        params.set('scope', 'all')
      } else {
        params.set('scope', 'instance')
        if (resolvedInstanceId !== null) {
          params.set('instanceId', String(resolvedInstanceId))
        }
      }

      const res = await apiFetch(`/api/usage?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setUsage(data.usage)
        setLastExport(data.lastExport)
        setKeyProviderCache(data.keyProviderCache || {})
        setViewInstanceName(data.instanceName || '')

        if (!pricingSeededRef.current) {
          const migratedPricing = migrateServerPricing(data.modelPricing || {})
          if (Object.keys(migratedPricing).length > 0) {
            setModelPricing((currentPricing) => mergeModelPricingMaps(currentPricing, migratedPricing))
            pricingSeededRef.current = true
          }
        }
      }
    } catch (e) {
      console.error('获取使用记录失败:', e)
      setUsage(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchUsage(usageScope, selectedInstanceId)
    const timer = setInterval(() => {
      fetchUsage(usageScope, selectedInstanceId)
    }, 30000)
    return () => clearInterval(timer)
  }, [usageScope, selectedInstanceId])

  useEffect(() => {
    persistLocalModelPricingState({
      pricing: modelPricing,
      removedPresetModels,
      presetOptIn,
    })
  }, [modelPricing, presetOptIn, removedPresetModels])

  useEffect(() => {
    const es = createApiEventSource('/api/usage/stream')
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data?.type === 'usage-updated') {
          fetchUsage(usageScope, selectedInstanceId)
        }
      } catch (e) {
        console.warn('SSE 消息解析失败:', e)
      }
    }
    return () => {
      es.close()
    }
  }, [usageScope, selectedInstanceId])

  const handleManualSync = async () => {
    setSyncing(true)
    setSyncError('')
    setSyncMessage('')

    try {
      const params = new URLSearchParams()
      if (usageScope === 'all') {
        params.set('scope', 'all')
      } else if (selectedInstance) {
        params.set('scope', 'instance')
        params.set('instanceId', String(selectedInstance.id))
      }

      const res = await apiFetch(`/api/usage/export-now?${params.toString()}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || `手动同步失败：${res.status}`)
      }
      if (data.usage) setUsage(data.usage)
      if (data.lastExport) setLastExport(data.lastExport)
      setViewInstanceName(data.instanceName || '')
      setSyncMessage(t('Manual sync succeeded'))
      fetchUsage(usageScope, selectedInstance?.id || selectedInstanceId)
    } catch (e) {
      setSyncError((e as Error).message || t('Manual sync failed'))
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

    pricingSeededRef.current = true
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
    setRemovedPresetModels((prev) => prev.filter((model) => model !== selectedModel))
    setSelectedModel('')
    setPromptPrice('')
    setCompletionPrice('')
    setCachePrice('')
  }

  const handleDeletePricing = (model) => {
    pricingSeededRef.current = true
    const nextPricing = { ...modelPricing }
    delete nextPricing[model]
    setModelPricing(nextPricing)

    if (MODEL_PRICING_PRESETS[model]) {
      setRemovedPresetModels((prev) => Array.from(new Set([...prev, model])).sort())
    }
  }

  const handleClearAllPricing = () => {
    pricingSeededRef.current = true
    setModelPricing({})
    setRemovedPresetModels(Object.keys(MODEL_PRICING_PRESETS))
    setPresetOptIn(false)
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
  const credentialStats = buildCredentialStats(requestDetails, keyProviderCache)
  const modelStats = buildModelStats(usage, modelPricing, requestDetails, modelSortBy)
  const dailyStats = buildDailyStats(dailyTrendData)
  const availableModels = useMemo(() => {
    return Array.from(new Set([
      ...getAvailableModels(usage),
      ...Object.keys(MODEL_PRICING_PRESETS),
      ...Object.keys(modelPricing),
    ])).sort()
  }, [modelPricing, usage])
  const hasAnyPricing = Object.keys(modelPricing).length > 0

  const totalRequestPages = Math.max(1, Math.ceil(requestDetails.length / requestsPerPage))
  const pagedRequestDetails = requestDetails.slice(
    (requestPage - 1) * requestsPerPage,
    requestPage * requestsPerPage
  )

  useEffect(() => {
    setRequestPage(1)
  }, [activeTab, requestDetails.length, requestsPerPage])

  return (
    <AppShell navItems={navItems} subduedParticles>
      <div className="legacy-surface space-y-6">
        <div className="surface-panel rounded-[28px] p-5 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] faint-text">{t('Overview')}</p>
              <h1 className="mt-2 text-[1.95rem] font-medium tracking-[-0.05em] text-[var(--text-primary)]">
                {t('Usage intelligence in a quieter shell')}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 muted-text">
                {t('Track request trends, service health, API and model distribution, and browser-only price estimates from one monochrome dashboard.')}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="chip">{t('Last updated')}: {formatTime(lastExport)}</span>
                <span className="chip">{t('View')}: {currentViewLabel}</span>
                {activeInstance ? <span className="chip">{t('Active instance')}: {activeInstance.name}</span> : null}
                <span className="chip">{t('Active tab')}: {activeTab}</span>
                <span className="chip">{t('Requests')}: {formatNumber(overviewStats.totalRequests)}</span>
                {currentStatusInstance ? (
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getCpaInstanceStatusClass(currentStatusInstance.status)}`}>
                    {getCpaInstanceStatusLabel(currentStatusInstance.status, t)}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:items-end">
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <ActionButton
                  size="sm"
                  variant={usageScope === 'instance' ? 'primary' : 'secondary'}
                  onClick={() => setUsageScope('instance')}
                >
                  {t('Current instance')}
                </ActionButton>
                <ActionButton
                  size="sm"
                  variant={usageScope === 'all' ? 'primary' : 'secondary'}
                  onClick={() => setUsageScope('all')}
                >
                  {t('Total summary')}
                </ActionButton>
              </div>

              {usageScope === 'instance' && instances.length > 0 ? (
                <label className="flex flex-col gap-2 text-sm text-[var(--text-secondary)] lg:min-w-[260px]">
                  <span>{t('Instance view')}</span>
                  <select
                    value={selectedInstance?.id || ''}
                    onChange={(event) => setSelectedInstanceId(Number(event.target.value) || '')}
                    className="field-select rounded-[16px] px-3 py-2"
                  >
                    {instances.map((instance) => (
                      <option key={instance.id} value={instance.id}>
                        {instance.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div className="flex flex-wrap gap-2 lg:justify-end">
              <ActionButton
                onClick={handleManualSync}
                disabled={manualSyncDisabled}
                variant="primary"
                icon={<InlineIcon name="refresh" className={syncing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
                loading={syncing}
              >
                {syncing ? t('Syncing...') : t('Manual sync')}
              </ActionButton>
              </div>
            </div>
          </div>
        </div>

        {syncMessage && <p className="text-sm text-[var(--success)]">{syncMessage}</p>}
        {syncError && <p className="text-sm text-[var(--danger)]">{syncError}</p>}

        {loading && (
          <div className="surface-panel flex min-h-[260px] flex-col items-center justify-center rounded-[32px] text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--border-color)] border-t-[var(--text-primary)]"></div>
            <p className="mt-4 text-sm muted-text">{t('Loading...')}</p>
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
              <div className="surface-panel rounded-[24px] p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold text-[#0d0d0d]">请求趋势</h3>
                  <div className="flex gap-1 rounded-xl bg-[var(--bg-secondary)] p-0.5">
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
                      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke={chartTheme.axis} />
                      <YAxis tick={{ fontSize: 10 }} stroke={chartTheme.axis} width={40} />
                      <Tooltip
                        contentStyle={{
                          fontSize: 12,
                          borderRadius: 12,
                          border: `1px solid ${chartTheme.tooltipBorder}`,
                          backgroundColor: chartTheme.tooltipBg,
                          color: resolvedTheme === 'dark' ? '#f8f8f4' : '#121212',
                        }}
                        formatter={(value) => [formatNumber(value), '请求数']}
                      />
                      <Line type="monotone" dataKey="requests" stroke={chartTheme.requestLine} strokeWidth={2.2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="surface-panel rounded-[24px] p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold text-[#0d0d0d]">Token 趋势</h3>
                  <div className="flex gap-1 rounded-xl bg-[var(--bg-secondary)] p-0.5">
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
                      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke={chartTheme.axis} />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        stroke={chartTheme.axis}
                        width={45}
                        tickFormatter={(value) => formatTokens(value)}
                      />
                      <Tooltip
                        contentStyle={{
                          fontSize: 12,
                          borderRadius: 12,
                          border: `1px solid ${chartTheme.tooltipBorder}`,
                          backgroundColor: chartTheme.tooltipBg,
                          color: resolvedTheme === 'dark' ? '#f8f8f4' : '#121212',
                        }}
                        formatter={(value) => [formatTokens(value), 'Tokens']}
                      />
                      <Line type="monotone" dataKey="totalTokens" stroke={chartTheme.tokenLine} strokeWidth={2.2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="surface-panel rounded-[24px] p-6 mb-8">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-5">
                <div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">服务健康活跃度</h3>
                  <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
                    最近 7 天，每格 30 分钟。亮度越高代表该时间窗内请求越稳定、成功率越高且活跃度更强。
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="min-w-[148px] rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3 shadow-[var(--shadow-soft)]">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">整体成功率</p>
                    <p className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
                      {hasServiceHealthData ? `${serviceHealth.successRate.toFixed(1)}%` : '--'}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      最近 7 天累计 {formatNumber(serviceHealth.totalSuccess + serviceHealth.totalFailure)} 次请求
                    </p>
                  </div>
                  <div className="min-w-[148px] rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3 shadow-[var(--shadow-soft)]">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">活跃窗口</p>
                    <p className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
                      {formatNumber(serviceHealth.activeWindowCount)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      其中 {formatNumber(serviceHealth.strongWindowCount)} 格表现稳定
                    </p>
                  </div>
                  <div className="min-w-[148px] rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3 shadow-[var(--shadow-soft)]">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">关注窗口</p>
                    <p className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
                      {formatNumber(serviceHealth.watchWindowCount)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      失败请求 {formatNumber(serviceHealth.totalFailure)} 次
                    </p>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto pb-1">
                <div className="min-w-[840px]">
                  <div className="space-y-2">
                    {serviceHealth.dayRows.map((row) => (
                      <div key={row.key} className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-3">
                        <div className="text-xs text-[var(--text-secondary)] tabular-nums">{row.label}</div>
                        <div
                          className="grid gap-[3px]"
                          style={{ gridTemplateColumns: `repeat(${SERVICE_HEALTH_COLS}, minmax(0, 1fr))` }}
                        >
                          {row.blocks.map((block) => (
                            <div
                              key={block.key}
                              title={block.title}
                              className="aspect-square w-full rounded-[4px] transition-transform duration-150 hover:-translate-y-px hover:scale-[1.06]"
                              style={{
                                backgroundColor: serviceHealthPalette.fills[block.level],
                                border: `1px solid ${serviceHealthPalette.borders[block.level]}`,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-3 mt-3">
                    <div />
                    <div
                      className="grid gap-[3px] text-[11px] text-[var(--text-tertiary)]"
                      style={{ gridTemplateColumns: `repeat(${SERVICE_HEALTH_COLS}, minmax(0, 1fr))` }}
                    >
                      {SERVICE_HEALTH_AXIS_MARKERS.map((marker) => (
                        <span
                          key={marker.label}
                          className="whitespace-nowrap"
                          style={{
                            gridColumn: `${marker.columnStart} / span 1`,
                            justifySelf: marker.justifySelf,
                            transform: `translateX(${marker.translateX})`,
                          }}
                        >
                          {marker.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-secondary)]">
                <div className="inline-flex items-center gap-2">
                  <span>较弱</span>
                  {serviceHealthPalette.fills.map((fill, level) => (
                    <span
                      key={`health-legend-${SERVICE_HEALTH_ACTIVITY_LABELS[level]}`}
                      title={SERVICE_HEALTH_ACTIVITY_LABELS[level]}
                      className="h-3.5 w-3.5 rounded-[4px]"
                      style={{
                        backgroundColor: fill,
                        border: `1px solid ${serviceHealthPalette.borders[level]}`,
                      }}
                    />
                  ))}
                  <span>更稳</span>
                </div>
                {!hasServiceHealthData && (
                  <span className="text-[var(--text-tertiary)]">最近 7 天暂无请求，当前全部显示为空闲窗口</span>
                )}
              </div>
            </div>

            <div className="flex gap-1 p-1 bg-[#f7f7f8] rounded-lg mb-6 w-fit flex-wrap">
              <TabButton active={activeTab === 'requests'} onClick={() => setActiveTab('requests')}>
                请求记录
              </TabButton>
              <TabButton active={activeTab === 'credentials'} onClick={() => setActiveTab('credentials')}>
                凭证统计
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
              <div className="table-divider-soft border rounded-xl overflow-hidden">
                <div className="table-divider-soft flex items-center justify-between gap-3 border-b bg-[#fafafa] px-4 py-3">
                  <p className="text-sm text-[#6e6e80]">
                    共 {formatNumber(requestDetails.length)} 条请求记录
                  </p>
                  <label className="flex items-center gap-2 text-sm text-[#6e6e80]">
                    每页
                    <select
                      value={requestsPerPage}
                      onChange={(event) => setRequestsPerPage(Number(event.target.value) || DEFAULT_REQUESTS_PER_PAGE)}
                      className="field-select rounded-md px-2 py-1 text-sm"
                    >
                      {REQUESTS_PER_PAGE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    行
                  </label>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1280px]">
                    <thead className="table-divider-soft bg-[#f7f7f8] border-b">
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
                    <tbody>
                      {requestDetails.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="px-4 py-12 text-center text-[#6e6e80]">暂无请求记录</td>
                        </tr>
                      ) : (
                        pagedRequestDetails.map((request) => {
                          const sourceInfo = resolveSourceInfo(request, keyProviderCache)

                          return (
                            <tr key={request.id} className="table-row-divider hover:bg-[#f7f7f8] transition-colors">
                              <td className="px-4 py-3">
                                <p className="text-sm font-medium text-[#0d0d0d]">{formatTime(request.timestamp)}</p>
                                <p className="text-xs text-[#6e6e80]">{formatRelativeTime(request.timestamp)}</p>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm text-[#0d0d0d]">{request.endpoint}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="inline-flex items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)]">
                                  {request.model}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-[#0d0d0d] truncate max-w-[220px]" title={sourceInfo.label}>
                                    {sourceInfo.label}
                                  </span>
                                  {sourceInfo.channel && (
                                    <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] font-medium uppercase text-[var(--text-secondary)]">
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
                  <div className="table-divider-soft flex items-center justify-between px-4 py-3 border-t bg-white">
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

            {activeTab === 'credentials' && (
              <div className="border border-[#e5e5e5] rounded-xl p-6">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between mb-6">
                  <div>
                    <h3 className="text-base font-semibold text-[#0d0d0d]">凭证统计</h3>
                    <p className="text-sm text-[#6e6e80] mt-1">按认证索引或来源聚合请求量、成功率和 Token 消耗</p>
                  </div>
                  <p className="text-sm text-[#6e6e80]">共 {formatNumber(credentialStats.length)} 个活跃凭证</p>
                </div>

                {credentialStats.length === 0 ? (
                  <p className="text-[#6e6e80] text-sm text-center py-8">暂无凭证统计数据</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px]">
                      <thead>
                        <tr className="border-b border-[#e5e5e5]">
                          <th className="text-left py-3 pr-4 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">凭证</th>
                          <th className="text-right py-3 px-2 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">请求</th>
                          <th className="text-right py-3 px-2 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">成功率</th>
                          <th className="text-right py-3 px-2 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">总 Token</th>
                          <th className="text-right py-3 px-2 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">费用</th>
                          <th className="text-right py-3 pl-4 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">最近使用</th>
                        </tr>
                      </thead>
                      <tbody>
                        {credentialStats.map((credential) => (
                          <tr key={credential.key} className="border-b border-[#f0f0f0] last:border-0">
                            <td className="py-3 pr-4">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-[#0d0d0d]">{credential.displayName}</span>
                                {credential.type && (
                                  <span className="inline-flex items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] font-medium uppercase text-[var(--text-secondary)]">
                                    {credential.type}
                                  </span>
                                )}
                              </div>
                              {credential.subtitle && (
                                <p className="text-xs text-[#8e8ea0] mt-1">{credential.subtitle}</p>
                              )}
                            </td>
                            <td className="py-3 px-2 text-right">
                              <p className="text-sm font-medium text-[#0d0d0d]">{formatNumber(credential.requests)}</p>
                              <p className="text-xs text-[#6e6e80] mt-1">
                                <span className="text-[#10a37f]">{formatNumber(credential.successCount)}</span>
                                {' / '}
                                <span className="text-[#ef4444]">{formatNumber(credential.failureCount)}</span>
                              </p>
                            </td>
                            <td className="py-3 px-2 text-right">
                              <span className={`text-sm font-medium ${
                                credential.successRate >= 95
                                  ? 'text-[#10a37f]'
                                  : credential.successRate >= 80
                                    ? 'text-[#f59e0b]'
                                    : 'text-[#ef4444]'
                              }`}>
                                {credential.successRate.toFixed(1)}%
                              </span>
                            </td>
                            <td className="py-3 px-2 text-right text-sm font-medium text-[#0d0d0d]">
                              {formatTokens(credential.totalTokens)}
                            </td>
                            <td className="py-3 px-2 text-right text-sm text-[#6e6e80]">
                              {hasAnyPricing && credential.pricedRequestCount > 0 ? formatUsd(credential.totalCost) : '-'}
                            </td>
                            <td className="py-3 pl-4 text-right">
                              <p className="text-sm text-[#0d0d0d]">{formatRelativeTime(credential.lastUsed)}</p>
                              <p className="text-xs text-[#8e8ea0] mt-1">{formatTime(credential.lastUsed)}</p>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
                      className="field-select w-full text-sm"
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
                      className="field-input text-sm"
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
                      className="field-input text-sm"
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
                      className="field-input text-sm"
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
    </AppShell>
  )
}

export default App
