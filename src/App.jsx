import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function App({ openCodeEnabled }) {
  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastExport, setLastExport] = useState(null)
  const [activeTab, setActiveTab] = useState('requests') // 'requests' | 'models' | 'daily'
  const [keyProviderCache, setKeyProviderCache] = useState({})
  const [modelPricing, setModelPricing] = useState({})
  const [showPricingModal, setShowPricingModal] = useState(false)
  const [selectedModel, setSelectedModel] = useState('')
  const [inputPrice, setInputPrice] = useState('')
  const [outputPrice, setOutputPrice] = useState('')
  const [requestChartMode, setRequestChartMode] = useState('hourly') // 'hourly' | 'daily'
  const [tokenChartMode, setTokenChartMode] = useState('hourly') // 'hourly' | 'daily'
  const [modelCompareChartMode, setModelCompareChartMode] = useState('hourly') // 'hourly' | 'daily' - 独立于 tokenChartMode
  const [selectedModelsForChart, setSelectedModelsForChart] = useState([])
  const [showModelSelectModal, setShowModelSelectModal] = useState(false)
  const [modelCompareExpanded, setModelCompareExpanded] = useState(false)
  const [modelSortBy, setModelSortBy] = useState('tokens') // 'tokens' | 'recent'
  const [requestPage, setRequestPage] = useState(1)
  const [openaiProviders, setOpenaiProviders] = useState([])
  const [editingProvider, setEditingProvider] = useState(null)
  const [providerForm, setProviderForm] = useState({ name: '', baseUrl: '', apiKeys: '', models: '' })
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncError, setSyncError] = useState('')

  const MODEL_COLORS = [
    '#0d0d0d', '#10a37f', '#ef4444', '#3b82f6', '#f59e0b', 
    '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316'
  ]
  const REQUESTS_PER_PAGE = 50

  const fetchUsage = async () => {
    try {
      const res = await fetch('/api/usage')
      if (res.ok) {
        const data = await res.json()
        setUsage(data.usage)
        setLastExport(data.lastExport)
        setKeyProviderCache(data.keyProviderCache || {})
        setModelPricing(data.modelPricing || {})
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
    es.onerror = () => {
      // EventSource 会自动重连，这里不手动处理
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

  const formatNumber = (num) => {
    if (!num) return '0'
    return num.toLocaleString()
  }

  const formatTokens = (num) => {
    if (!num || num === 0) return '0'
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + 'M'
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K'
    }
    return num.toString()
  }

  const getAvailableModels = () => {
    if (!usage?.apis) return []
    const models = new Set()
    Object.values(usage.apis).forEach(api => {
      if (api.models) {
        Object.keys(api.models).forEach(name => models.add(name))
      }
    })
    return Array.from(models).sort()
  }

  const handleSavePricing = async () => {
    if (!selectedModel) return
    try {
      const res = await fetch('/api/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          inputPrice: inputPrice,
          outputPrice: outputPrice
        })
      })
      if (res.ok) {
        const data = await res.json()
        setModelPricing(data.pricing)
        setSelectedModel('')
        setInputPrice('')
        setOutputPrice('')
      }
    } catch (e) {
      console.error('保存计费失败:', e)
    }
  }

  const handleDeletePricing = async (model) => {
    try {
      const res = await fetch(`/api/pricing/${encodeURIComponent(model)}`, { method: 'DELETE' })
      if (res.ok) {
        const newPricing = { ...modelPricing }
        delete newPricing[model]
        setModelPricing(newPricing)
      }
    } catch (e) {
      console.error('删除计费失败:', e)
    }
  }

  const calculateCost = (inputTokens, outputTokens, model) => {
    const pricing = modelPricing[model]
    if (!pricing) return null
    const inputCost = (inputTokens || 0) / 1000000 * pricing.inputPrice
    const outputCost = (outputTokens || 0) / 1000000 * pricing.outputPrice
    return inputCost + outputCost
  }

  const getHourlyChartData = () => {
    const data = []
    for (let i = 0; i < 24; i++) {
      const hour = i.toString().padStart(2, '0')
      data.push({
        label: `${hour}:00`,
        requests: usage?.requests_by_hour?.[hour] || 0,
        tokens: usage?.tokens_by_hour?.[hour] || 0
      })
    }
    return data
  }

  const getDailyChartData = () => {
    const data = []
    const today = new Date()
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      data.push({
        label: dateStr.slice(5),
        requests: usage?.requests_by_day?.[dateStr] || 0,
        tokens: usage?.tokens_by_day?.[dateStr] || 0
      })
    }
    return data
  }

  const requestChartData = requestChartMode === 'hourly' ? getHourlyChartData() : getDailyChartData()
  const tokenChartData = tokenChartMode === 'hourly' ? getHourlyChartData() : getDailyChartData()

  const getModelChartData = (mode) => {
    if (selectedModelsForChart.length === 0) return []
    
    const data = []
    if (mode === 'hourly') {
      for (let i = 0; i < 24; i++) {
        const hour = i.toString().padStart(2, '0')
        const point = { label: `${hour}:00` }
        selectedModelsForChart.forEach(model => {
          point[model] = 0
        })
        data.push(point)
      }
    } else {
      const today = new Date()
      for (let i = 29; i >= 0; i--) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateStr = date.toISOString().split('T')[0]
        const point = { label: dateStr.slice(5) }
        selectedModelsForChart.forEach(model => {
          point[model] = 0
        })
        data.push(point)
      }
    }

    if (usage?.apis) {
      Object.values(usage.apis).forEach(api => {
        if (api.models) {
          selectedModelsForChart.forEach(modelName => {
            const modelData = api.models[modelName]
            if (modelData?.details) {
              modelData.details.forEach(detail => {
                const ts = new Date(detail.timestamp)
                if (mode === 'hourly') {
                  const hour = ts.getHours().toString().padStart(2, '0')
                  const idx = data.findIndex(d => d.label === `${hour}:00`)
                  if (idx >= 0) {
                    data[idx][modelName] += detail.tokens?.total_tokens || 0
                  }
                } else {
                  const dateStr = ts.toISOString().split('T')[0].slice(5)
                  const idx = data.findIndex(d => d.label === dateStr)
                  if (idx >= 0) {
                    data[idx][modelName] += detail.tokens?.total_tokens || 0
                  }
                }
              })
            }
          })
        }
      })
    }
    return data
  }

  const modelCompareData = getModelChartData(modelCompareChartMode)

  const toggleModelForChart = (model) => {
    setSelectedModelsForChart(prev => 
      prev.includes(model) 
        ? prev.filter(m => m !== model)
        : [...prev, model]
    )
  }

  const formatTime = (isoString) => {
    if (!isoString) return '-'
    return new Date(isoString).toLocaleString('zh-CN')
  }

  const formatRelativeTime = (isoString) => {
    if (!isoString) return '-'
    const date = new Date(isoString)
    const now = new Date()
    const diff = now - date
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    if (hours < 24) return `${hours}小时前`
    return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  // 获取所有请求详情列表
  const getRequestDetails = () => {
    if (!usage?.apis) return []
    const requests = []
    Object.entries(usage.apis).forEach(([apiKey, api]) => {
      if (api.models) {
        Object.entries(api.models).forEach(([modelName, modelData]) => {
          if (modelData.details) {
            modelData.details.forEach(detail => {
              requests.push({
                model: modelName,
                source: detail.source || '-',
                authIndex: detail.auth_index || '-',
                timestamp: detail.timestamp,
                tokens: detail.tokens || {},
                failed: detail.failed,
                apiKey: apiKey
              })
            })
          }
        })
      }
    })
    return requests.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  }

  // 获取模型统计
  const getModelStats = () => {
    if (!usage?.apis) return []
    const modelMap = new Map()
    Object.values(usage.apis).forEach(api => {
      if (api.models) {
        Object.entries(api.models).forEach(([name, data]) => {
          const details = data.details || []
          const failed = details.filter(d => d.failed).length
          const success = details.length - failed
          const timestamps = details.map(d => new Date(d.timestamp).getTime()).filter(t => !isNaN(t))
          const lastUsed = timestamps.length > 0 ? Math.max(...timestamps) : null

          if (!modelMap.has(name)) {
            modelMap.set(name, {
              name,
              requests: 0,
              tokens: 0,
              failed: 0,
              success: 0,
              lastUsed: null
            })
          }

          const current = modelMap.get(name)
          current.requests += data.requests || details.length || 0
          current.tokens += data.total_tokens || 0
          current.failed += failed
          current.success += success
          if (lastUsed && (!current.lastUsed || lastUsed > current.lastUsed)) {
            current.lastUsed = lastUsed
          }
        })
      }
    })
    const models = Array.from(modelMap.values())
    if (modelSortBy === 'recent') {
      return models.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
    }
    return models.sort((a, b) => b.tokens - a.tokens)
  }

  // 获取每日统计
  const getDailyStats = () => {
    if (!usage?.requests_by_day) return []
    return Object.entries(usage.requests_by_day)
      .map(([date, count]) => ({ date, count, tokens: usage.tokens_by_day?.[date] || 0 }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 7)
  }

  const requestDetails = getRequestDetails()
  const totalRequestPages = Math.max(1, Math.ceil(requestDetails.length / REQUESTS_PER_PAGE))
  const pagedRequestDetails = requestDetails.slice(
    (requestPage - 1) * REQUESTS_PER_PAGE,
    requestPage * REQUESTS_PER_PAGE
  )
  const modelStats = getModelStats()
  const dailyStats = getDailyStats()

  useEffect(() => {
    setRequestPage(1)
  }, [activeTab, requestDetails.length])

  return (
    <div className="min-h-screen pt-10 pb-20 px-6 bg-white">
      <div className="max-w-7xl mx-auto">
        {/* 右上角管理按钮 */}
        <div className="flex justify-end gap-3 mb-8">
          <Link
            to="/checkin"
            className="px-4 py-2 text-sm font-medium text-[#0d0d0d] border border-[#e5e5e5] rounded-lg hover:bg-[#f7f7f8] transition-colors inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            签到中心
          </Link>
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
          <Link
            to="/config"
            className="px-4 py-2 text-sm font-medium text-white bg-[#0d0d0d] rounded-lg hover:bg-[#2d2d2d] transition-colors inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            站点管理
          </Link>
        </div>

        {/* 头部区域 */}
        <div className="mb-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold text-[#0d0d0d] mb-2">使用统计</h1>
              <p className="text-[#6e6e80]">
                CLI Proxy API 使用记录 · 最后更新: {formatTime(lastExport)}
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

        {/* 加载状态 */}
        {loading && (
          <div className="text-center py-20">
            <div className="inline-block w-8 h-8 border-2 border-[#e5e5e5] border-t-[#0d0d0d] rounded-full animate-spin"></div>
            <p className="mt-4 text-[#6e6e80]">加载中...</p>
          </div>
        )}

        {!loading && (
          <>
            {/* 概览卡片 */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-8">
              <div className="p-6 border border-[#e5e5e5] rounded-xl">
                <p className="text-sm text-[#6e6e80] mb-1">总请求数</p>
                <p className="text-3xl font-semibold text-[#0d0d0d]">{formatNumber(usage?.total_requests)}</p>
              </div>
              <div className="p-6 border border-[#e5e5e5] rounded-xl">
                <p className="text-sm text-[#6e6e80] mb-1">成功请求</p>
                <p className="text-3xl font-semibold text-[#10a37f]">{formatNumber(usage?.success_count)}</p>
              </div>
              <div className="p-6 border border-[#e5e5e5] rounded-xl">
                <p className="text-sm text-[#6e6e80] mb-1">失败请求</p>
                <p className="text-3xl font-semibold text-[#ef4444]">{formatNumber(usage?.failure_count)}</p>
              </div>
              <div className="p-6 border border-[#e5e5e5] rounded-xl">
                <p className="text-sm text-[#6e6e80] mb-1">总Token数</p>
                <div className="flex items-end justify-between">
                  <p className="text-3xl font-semibold text-[#0d0d0d]">{formatTokens(usage?.total_tokens)}</p>
                  <div className="text-right leading-tight mb-0.5">
                    <p className="text-[11px] text-[#6e6e80]">思考 {formatTokens((() => { let t = 0; if (usage?.apis) Object.values(usage.apis).forEach(a => { if (a.models) Object.values(a.models).forEach(m => { (m.details || []).forEach(d => { t += d.tokens?.reasoning_tokens || 0 }) }) }); return t })())}</p>
                    <p className="text-[11px] text-[#6e6e80]">缓存 {formatTokens((() => { let t = 0; if (usage?.apis) Object.values(usage.apis).forEach(a => { if (a.models) Object.values(a.models).forEach(m => { (m.details || []).forEach(d => { t += d.tokens?.cached_tokens || 0 }) }) }); return t })())}</p>
                  </div>
                </div>
              </div>
              <div className="p-6 border border-[#e5e5e5] rounded-xl">
                <p className="text-sm text-[#6e6e80] mb-1">总消耗金额</p>
                <p className="text-3xl font-semibold text-[#0d0d0d]">
                  ${(() => {
                    let total = 0
                    if (usage?.apis) {
                      Object.values(usage.apis).forEach(api => {
                        if (api.models) {
                          Object.entries(api.models).forEach(([modelName, modelData]) => {
                            if (modelData.details) {
                              modelData.details.forEach(detail => {
                                const cost = calculateCost(detail.tokens?.input_tokens, detail.tokens?.output_tokens, modelName)
                                if (cost) total += cost
                              })
                            }
                          })
                        }
                      })
                    }
                    return total.toFixed(4)
                  })()}
                </p>
              </div>
            </div>

            {/* 趋势图表 */}
            <div className="grid gap-6 lg:grid-cols-2 mb-8">
              {/* 请求趋势 */}
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
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={requestChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#6e6e80" />
                      <YAxis tick={{ fontSize: 10 }} stroke="#6e6e80" width={35} />
                      <Tooltip 
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e5e5' }}
                        formatter={(value) => [value, '请求数']}
                      />
                      <Line type="monotone" dataKey="requests" stroke="#0d0d0d" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Token使用趋势 */}
              <div className="border border-[#e5e5e5] rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold text-[#0d0d0d]">Token 使用趋势</h3>
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
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={tokenChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#6e6e80" />
                      <YAxis tick={{ fontSize: 10 }} stroke="#6e6e80" width={40} tickFormatter={(v) => v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'K' : v} />
                      <Tooltip 
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e5e5' }}
                        formatter={(value) => [formatTokens(value), 'Tokens']}
                      />
                      <Line type="monotone" dataKey="tokens" stroke="#10a37f" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* 模型对比图表 - 可折叠 */}
            <div className="border border-[#e5e5e5] rounded-xl mb-8 overflow-hidden">
              <button
                onClick={() => setModelCompareExpanded(!modelCompareExpanded)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-[#f7f7f8] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-semibold text-[#0d0d0d]">模型 Token 对比</h3>
                  {selectedModelsForChart.length > 0 && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[#f0f0f0] text-[#6e6e80]">
                      {selectedModelsForChart.length} 个模型
                    </span>
                  )}
                </div>
                <svg 
                  className={`w-5 h-5 text-[#6e6e80] transition-transform ${modelCompareExpanded ? 'rotate-180' : ''}`} 
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {modelCompareExpanded && (
                <div className="px-6 pb-6 border-t border-[#e5e5e5]">
                  <div className="flex items-center justify-between py-4">
                    <button
                      onClick={() => setShowModelSelectModal(true)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#e5e5e5] text-[#6e6e80] hover:border-[#0d0d0d] hover:text-[#0d0d0d] transition-colors flex items-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      选择模型
                    </button>
                    <div className="flex gap-1 p-0.5 bg-[#f7f7f8] rounded-md">
                      <button
                        onClick={() => setModelCompareChartMode('hourly')}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                          modelCompareChartMode === 'hourly' ? 'bg-white text-[#0d0d0d] shadow-sm' : 'text-[#6e6e80]'
                        }`}
                      >
                        24小时
                      </button>
                      <button
                        onClick={() => setModelCompareChartMode('daily')}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                          modelCompareChartMode === 'daily' ? 'bg-white text-[#0d0d0d] shadow-sm' : 'text-[#6e6e80]'
                        }`}
                      >
                        30天
                      </button>
                    </div>
                  </div>

                  {selectedModelsForChart.length === 0 ? (
                    <div className="h-56 flex items-center justify-center text-[#6e6e80] text-sm">
                      <button 
                        onClick={() => setShowModelSelectModal(true)}
                        className="flex items-center gap-2 hover:text-[#0d0d0d] transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        点击选择模型添加到对比图表
                      </button>
                    </div>
                  ) : (
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={modelCompareData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#6e6e80" />
                          <YAxis tick={{ fontSize: 10 }} stroke="#6e6e80" width={45} tickFormatter={(v) => v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'K' : v} />
                          <Tooltip 
                            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e5e5' }}
                            formatter={(value, name) => [formatTokens(value), name]}
                          />
                          {selectedModelsForChart.map((model, idx) => (
                            <Line 
                              key={model}
                              type="monotone" 
                              dataKey={model} 
                              stroke={MODEL_COLORS[selectedModelsForChart.indexOf(model) % MODEL_COLORS.length]} 
                              strokeWidth={2} 
                              dot={false} 
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* 图例 - 可点击移除 */}
                  {selectedModelsForChart.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[#e5e5e5]">
                      {selectedModelsForChart.map((model, idx) => (
                        <button
                          key={model}
                          onClick={() => toggleModelForChart(model)}
                          className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-full hover:bg-[#f7f7f8] transition-colors group"
                        >
                          <span 
                            className="w-2.5 h-2.5 rounded-full" 
                            style={{ backgroundColor: MODEL_COLORS[selectedModelsForChart.indexOf(model) % MODEL_COLORS.length] }}
                          ></span>
                          <span className="text-[#6e6e80]">{model}</span>
                          <svg className="w-3 h-3 text-[#6e6e80] opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tab 切换 */}
            <div className="flex gap-1 p-1 bg-[#f7f7f8] rounded-lg mb-6 w-fit">
              <button
                onClick={() => setActiveTab('requests')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'requests' 
                    ? 'bg-white text-[#0d0d0d] shadow-sm' 
                    : 'text-[#6e6e80] hover:text-[#0d0d0d]'
                }`}
              >
                请求记录
              </button>
              <button
                onClick={() => setActiveTab('models')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'models' 
                    ? 'bg-white text-[#0d0d0d] shadow-sm' 
                    : 'text-[#6e6e80] hover:text-[#0d0d0d]'
                }`}
              >
                模型统计
              </button>
              <button
                onClick={() => setActiveTab('daily')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'daily' 
                    ? 'bg-white text-[#0d0d0d] shadow-sm' 
                    : 'text-[#6e6e80] hover:text-[#0d0d0d]'
                }`}
              >
                每日统计
              </button>
              <button
                onClick={() => setActiveTab('pricing')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'pricing' 
                    ? 'bg-white text-[#0d0d0d] shadow-sm' 
                    : 'text-[#6e6e80] hover:text-[#0d0d0d]'
                }`}
              >
                模型计费
              </button>
            </div>

            {/* 请求记录列表 */}
            {activeTab === 'requests' && (
              <div className="border border-[#e5e5e5] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-[#f7f7f8] border-b border-[#e5e5e5]">
                      <tr>
                        <th className="text-left px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">时间</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">模型</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">来源账号</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">输入</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">输出</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">缓存</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">总计</th>
                        <th className="text-center px-4 py-3 text-xs font-medium text-[#6e6e80] uppercase tracking-wider">状态</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e5e5e5]">
                      {requestDetails.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-12 text-center text-[#6e6e80]">暂无请求记录</td>
                        </tr>
                      ) : (
                        pagedRequestDetails.map((req, idx) => (
                          <tr key={idx} className="hover:bg-[#f7f7f8] transition-colors">
                            <td className="px-4 py-3">
                              <p className="text-sm font-medium text-[#0d0d0d]">{formatTime(req.timestamp)}</p>
                              <p className="text-xs text-[#6e6e80]">{formatRelativeTime(req.timestamp)}</p>
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-[#f0f0f0] text-[#0d0d0d]">
                                {req.model}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {(() => {
                                const cacheInfo = keyProviderCache[req.authIndex] || keyProviderCache[req.source];
                                const isApiKey = cacheInfo?.channel === 'api-key';
                                
                                if (cacheInfo) {
                                  return (
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm text-[#0d0d0d] truncate max-w-[180px]" title={req.source}>
                                        {isApiKey ? cacheInfo.provider : req.source}
                                      </span>
                                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[#e5e5e5] text-[#6e6e80] uppercase flex-shrink-0">
                                        {isApiKey ? 'api-key' : cacheInfo.channel}
                                      </span>
                                    </div>
                                  );
                                }
                                return (
                                  <span className="text-sm text-[#0d0d0d] truncate max-w-[200px]" title={req.source}>
                                    {req.source}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm text-[#6e6e80]">{formatTokens(req.tokens.input_tokens)}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm text-[#6e6e80]">{formatTokens(req.tokens.output_tokens)}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={`text-sm ${req.tokens.cached_tokens > 0 ? 'font-medium text-[#10a37f]' : 'text-[#6e6e80]'}`}>{formatTokens(req.tokens.cached_tokens || 0)}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm font-medium text-[#0d0d0d]">{formatTokens(req.tokens.total_tokens)}</span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              {req.failed ? (
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
                        ))
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
                        onClick={() => setRequestPage(p => Math.max(1, p - 1))}
                        disabled={requestPage === 1}
                        className="px-3 py-1.5 text-xs border border-[#e5e5e5] rounded-md text-[#0d0d0d] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#f7f7f8]"
                      >
                        上一页
                      </button>
                      <button
                        onClick={() => setRequestPage(p => Math.min(totalRequestPages, p + 1))}
                        disabled={requestPage === totalRequestPages}
                        className="px-3 py-1.5 text-xs border border-[#e5e5e5] rounded-md text-[#0d0d0d] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#f7f7f8]"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 模型统计 */}
            {activeTab === 'models' && (
              <div className="border border-[#e5e5e5] rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm text-[#6e6e80]">共 {modelStats.length} 个模型</span>
                  <div className="flex gap-1 p-0.5 bg-[#f7f7f8] rounded-md">
                    <button
                      onClick={() => setModelSortBy('tokens')}
                      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                        modelSortBy === 'tokens' ? 'bg-white text-[#0d0d0d] shadow-sm' : 'text-[#6e6e80]'
                      }`}
                    >
                      按用量
                    </button>
                    <button
                      onClick={() => setModelSortBy('recent')}
                      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                        modelSortBy === 'recent' ? 'bg-white text-[#0d0d0d] shadow-sm' : 'text-[#6e6e80]'
                      }`}
                    >
                      按最近
                    </button>
                  </div>
                </div>
                {modelStats.length === 0 ? (
                  <p className="text-[#6e6e80] text-sm text-center py-8">暂无数据</p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {modelStats.map(model => (
                      <div key={model.name} className="p-4 bg-[#f7f7f8] rounded-xl">
                        <p className="text-sm font-medium text-[#0d0d0d] truncate mb-3">{model.name}</p>
                        <div className="flex justify-between items-end">
                          <div>
                            <p className="text-2xl font-semibold text-[#0d0d0d]">{model.requests}</p>
                            <p className="text-xs text-[#6e6e80]">次请求</p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-medium text-[#6e6e80]">{formatTokens(model.tokens)}</p>
                            <p className="text-xs text-[#6e6e80]">tokens</p>
                          </div>
                        </div>
                        <div className="mt-2 space-y-1">
                          <p className="text-xs text-[#10a37f]">{model.success} 次成功</p>
                          {model.failed > 0 && (
                            <p className="text-xs text-[#ef4444]">{model.failed} 次失败</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 每日统计 */}
            {activeTab === 'daily' && (
              <div className="border border-[#e5e5e5] rounded-xl p-6">
                {dailyStats.length === 0 ? (
                  <p className="text-[#6e6e80] text-sm text-center py-8">暂无数据</p>
                ) : (
                  <div className="space-y-3">
                    {dailyStats.map(day => (
                      <div key={day.date} className="flex items-center justify-between p-4 bg-[#f7f7f8] rounded-xl">
                        <div>
                          <p className="text-base font-medium text-[#0d0d0d]">{day.date}</p>
                          <p className="text-sm text-[#6e6e80]">{formatTokens(day.tokens)} tokens</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-semibold text-[#0d0d0d]">{day.count}</p>
                          <p className="text-xs text-[#6e6e80]">次请求</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 模型计费 */}
            {activeTab === 'pricing' && (
              <div className="border border-[#e5e5e5] rounded-xl p-6">
                {/* 添加新计费 */}
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-[#0d0d0d] mb-3">设置模型费用</h3>
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-[#6e6e80] mb-1">选择模型</label>
                      <select
                        value={selectedModel}
                        onChange={e => {
                          setSelectedModel(e.target.value)
                          const existing = modelPricing[e.target.value]
                          if (existing) {
                            setInputPrice(existing.inputPrice.toString())
                            setOutputPrice(existing.outputPrice.toString())
                          } else {
                            setInputPrice('')
                            setOutputPrice('')
                          }
                        }}
                        className="w-full px-3 py-2 border border-[#e5e5e5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0d0d0d]"
                      >
                        <option value="">选择模型...</option>
                        {getAvailableModels().map(model => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-32">
                      <label className="block text-xs text-[#6e6e80] mb-1">输入 ($/M)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={inputPrice}
                        onChange={e => setInputPrice(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 border border-[#e5e5e5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0d0d0d]"
                      />
                    </div>
                    <div className="w-32">
                      <label className="block text-xs text-[#6e6e80] mb-1">输出 ($/M)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={outputPrice}
                        onChange={e => setOutputPrice(e.target.value)}
                        placeholder="0.00"
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
                </div>

                {/* 已设置的计费列表 */}
                {Object.keys(modelPricing).length > 0 ? (
                  <div>
                    <h3 className="text-sm font-medium text-[#0d0d0d] mb-3">已设置的模型 ({Object.keys(modelPricing).length})</h3>
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {Object.entries(modelPricing).map(([model, pricing]) => (
                        <div key={model} className="flex items-center justify-between p-4 bg-[#f7f7f8] rounded-xl">
                          <div>
                            <p className="text-sm font-medium text-[#0d0d0d] truncate">{model}</p>
                            <p className="text-xs text-[#6e6e80] mt-1">
                              输入: ${pricing.inputPrice}/M · 输出: ${pricing.outputPrice}/M
                            </p>
                          </div>
                          <button
                            onClick={() => handleDeletePricing(model)}
                            className="text-[#ef4444] hover:text-[#dc2626] p-1 ml-2 flex-shrink-0"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-[#6e6e80] text-sm text-center py-8">暂未设置任何模型计费</p>
                )}
              </div>
            )}

            {/* 无数据提示 */}
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

      {/* 模型选择模态框 */}
      {showModelSelectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowModelSelectModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[#e5e5e5] flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#0d0d0d]">选择对比模型</h2>
              <button onClick={() => setShowModelSelectModal(false)} className="text-[#6e6e80] hover:text-[#0d0d0d]">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <p className="text-sm text-[#6e6e80] mb-4">点击模型添加或移除对比（已选 {selectedModelsForChart.length} 个）</p>
              <div className="space-y-2">
                {getAvailableModels().map((model, idx) => (
                  <button
                    key={model}
                    onClick={() => toggleModelForChart(model)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      selectedModelsForChart.includes(model)
                        ? 'border-[#0d0d0d] bg-[#f7f7f8]'
                        : 'border-[#e5e5e5] hover:border-[#0d0d0d]'
                    }`}
                  >
                    <span className="text-sm text-[#0d0d0d]">{model}</span>
                    {selectedModelsForChart.includes(model) && (
                      <svg className="w-5 h-5 text-[#10a37f]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
              
              {getAvailableModels().length === 0 && (
                <p className="text-center text-[#6e6e80] text-sm py-8">暂无可用模型</p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[#e5e5e5] flex gap-3">
              <button
                onClick={() => setSelectedModelsForChart([])}
                className="flex-1 py-2 text-sm font-medium text-[#6e6e80] hover:text-[#0d0d0d] transition-colors"
              >
                清空选择
              </button>
              <button
                onClick={() => setShowModelSelectModal(false)}
                className="flex-1 py-2 bg-[#0d0d0d] text-white text-sm font-medium rounded-lg hover:bg-[#2d2d2d] transition-colors"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
