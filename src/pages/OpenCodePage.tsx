import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../auth.js'
import { ActionButton, AppShell, GlassPanel, InlineIcon } from '../components/ui'
import { useI18n } from '../i18n/useI18n'
import { buildPrimaryNav } from '../navigation'

const MODALITY_OPTIONS = ['text', 'image', 'pdf', 'audio', 'video']

const AGENT_DESC = {
  'sisyphus': '主编排器，规划并委派任务给专家，驱动并行执行',
  'hephaestus': '自主深度工作者，探索代码库并端到端执行',
  'prometheus': '策略规划师，先访谈确认范围再制定详细计划',
  'atlas': '轻量辅助 Agent',
  'oracle': '架构分析与调试专家',
  'librarian': '文档与代码搜索专家',
  'explore': '快速代码库搜索',
  'multimodal-looker': '多模态内容分析',
  'metis': '计划顾问，辅助 Prometheus 审查方案',
  'momus': '代码审查与批评',
  'sisyphus-junior': 'Sisyphus 轻量版，处理简单任务',
}

const CATEGORY_DESC = {
  'visual-engineering': '前端与视觉工程任务',
  'ultrabrain': '最高能力任务，深度推理',
  'deep': '深度工作，复杂逻辑实现',
  'artistry': '设计与创意相关任务',
  'quick': '快速简单任务',
  'writing': '文档与写作任务',
}

function OpenCodePage({ openCodeEnabled = true }) {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [expandedProvider, setExpandedProvider] = useState(null)
  const [editingModel, setEditingModel] = useState(null) // { providerKey, modelKey }
  const [showAddProvider, setShowAddProvider] = useState(false)
  const [showAddModel, setShowAddModel] = useState(null) // providerKey
  const [newProviderForm, setNewProviderForm] = useState({ key: '', npm: '@ai-sdk/openai-compatible', baseURL: '', apiKey: '' })
  const [newModelForm, setNewModelForm] = useState({ name: '', context: 200000, output: 16000, inputMods: ['text'], outputMods: ['text'], attachment: true })
  // Oh My OpenCode
  const [ohMyConfig, setOhMyConfig] = useState(null)
  const [ohMyExpanded, setOhMyExpanded] = useState(false)
  const [ohMyEditingAgent, setOhMyEditingAgent] = useState(null)
  const [ohMyEditingCat, setOhMyEditingCat] = useState(null)
  const [ohMyNewAgent, setOhMyNewAgent] = useState({ name: '', model: '' })
  const [ohMyNewCat, setOhMyNewCat] = useState({ name: '', model: '', variant: '' })
  const [showAddAgent, setShowAddAgent] = useState(false)
  const [showAddCat, setShowAddCat] = useState(false)
  const { t } = useI18n()
  const navItems = useMemo(() => buildPrimaryNav(t, openCodeEnabled), [openCodeEnabled, t])

  useEffect(() => {
    fetchConfig()
    fetchOhMy()
  }, [])

  const fetchConfig = async () => {
    try {
      const res = await apiFetch('/api/opencode/config')
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '加载失败')
        setLoading(false)
        return
      }
      const data = await res.json()
      setConfig(data)
    } catch (e) {
      setError('连接失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const saveConfig = async (newConfig) => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await apiFetch('/api/opencode/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '保存失败')
        return false
      }
      setConfig(newConfig)
      setSuccess('已保存')
      setTimeout(() => setSuccess(''), 2000)
      return true
    } catch (e) {
      setError('保存失败: ' + e.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleAddProvider = async () => {
    const { key, npm, baseURL, apiKey } = newProviderForm
    if (!key) return setError('提供商名称不能为空')
    if (config.provider?.[key]) return setError('提供商已存在')

    const newConfig = { ...config }
    if (!newConfig.provider) newConfig.provider = {}
    newConfig.provider[key] = {
      models: {},
      npm: npm || '@ai-sdk/openai-compatible',
      options: { baseURL, apiKey }
    }
    if (await saveConfig(newConfig)) {
      setShowAddProvider(false)
      setNewProviderForm({ key: '', npm: '@ai-sdk/openai-compatible', baseURL: '', apiKey: '' })
      setExpandedProvider(key)
    }
  }

  const handleDeleteProvider = async (providerKey) => {
    if (!confirm(`确定要删除提供商 "${providerKey}" 及其所有模型吗？`)) return
    const newConfig = { ...config }
    delete newConfig.provider[providerKey]
    await saveConfig(newConfig)
  }

  const handleAddModel = async (providerKey) => {
    const { name, context, output, inputMods, outputMods, attachment } = newModelForm
    if (!name) return setError('模型名称不能为空')
    if (config.provider[providerKey].models[name]) return setError('模型已存在')

    const newConfig = JSON.parse(JSON.stringify(config))
    const model = { name }
    if (context || output) {
      model.limit = {}
      if (context) model.limit.context = parseInt(context)
      if (output) model.limit.output = parseInt(output)
    }
    if (inputMods.length > 0 || outputMods.length > 0) {
      model.modalities = {}
      if (inputMods.length > 0) model.modalities.input = [...inputMods]
      if (outputMods.length > 0) model.modalities.output = [...outputMods]
    }
    if (!attachment) model.attachment = false
    newConfig.provider[providerKey].models[name] = model

    if (await saveConfig(newConfig)) {
      setShowAddModel(null)
      setNewModelForm({ name: '', context: 200000, output: 16000, inputMods: ['text'], outputMods: ['text'], attachment: true })
    }
  }

  const handleUpdateModel = async (providerKey, oldModelKey, modelData) => {
    const newConfig = JSON.parse(JSON.stringify(config))
    // 如果名称改了，删旧的加新的
    if (oldModelKey !== modelData.name) {
      delete newConfig.provider[providerKey].models[oldModelKey]
    }
    newConfig.provider[providerKey].models[modelData.name] = modelData
    if (await saveConfig(newConfig)) {
      setEditingModel(null)
    }
  }

  const handleDeleteModel = async (providerKey, modelKey) => {
    if (!confirm(`确定要删除模型 "${modelKey}" 吗？`)) return
    const newConfig = JSON.parse(JSON.stringify(config))
    delete newConfig.provider[providerKey].models[modelKey]
    await saveConfig(newConfig)
  }

  const handleUpdateProviderOptions = async (providerKey, field, value) => {
    const newConfig = JSON.parse(JSON.stringify(config))
    if (!newConfig.provider[providerKey].options) newConfig.provider[providerKey].options = {}
    newConfig.provider[providerKey].options[field] = value
    await saveConfig(newConfig)
  }

  // Oh My OpenCode
  const fetchOhMy = async () => {
    try {
      const res = await apiFetch('/api/opencode/oh-my')
      if (res.ok) setOhMyConfig(await res.json())
    } catch (e) { /* ignore */ }
  }

  const saveOhMy = async (newConf) => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await apiFetch('/api/opencode/oh-my', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConf)
      })
      if (!res.ok) { setError('保存失败'); return }
      setOhMyConfig(newConf)
      setSuccess('已保存')
      setTimeout(() => setSuccess(''), 2000)
    } catch (e) {
      setError('保存失败: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  // 从 opencode.json 提取所有 provider/model 选项
  const getModelOptions = () => {
    if (!config?.provider) return []
    const options = []
    Object.entries(config.provider).forEach(([provKey, provData]) => {
      if (provData.models) {
        Object.keys(provData.models).forEach(modelKey => {
          options.push(`${provKey}/${modelKey}`)
        })
      }
    })
    return options.sort()
  }

  const modelOptions = getModelOptions()

  const formatNum = (n) => {
    if (!n) return '0'
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(0) + 'K'
    return n.toString()
  }

  if (loading) {
    return (
      <AppShell navItems={navItems} subduedParticles>
        <div className="flex min-h-[72vh] items-center justify-center">
          <div className="surface-panel flex flex-col items-center gap-4 rounded-[28px] px-8 py-10">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--border-color)] border-t-[var(--text-primary)]" />
            <p className="text-sm muted-text">{t('Loading...')}</p>
          </div>
        </div>
      </AppShell>
    )
  }

  const providers = config?.provider ? Object.entries(config.provider) : []

  return (
    <AppShell navItems={navItems} subduedParticles>
      <div className="legacy-surface space-y-6">
        <GlassPanel tone="strong" className="rounded-[28px] p-5 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] faint-text">{t('OpenCode')}</p>
              <h1 className="mt-2 text-[1.9rem] font-medium tracking-[-0.05em] text-[var(--text-primary)]">
                {t('Shape providers, models, and orchestration presets')}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 muted-text">
                {t('Tune provider endpoints, model capabilities, and Oh My OpenCode presets inside the same shell that holds usage and CodeX operations.')}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="chip">{t('Providers')}: {providers.length}</span>
                {ohMyConfig ? <span className="chip">Oh My: {Object.keys(ohMyConfig.agents || {}).length + Object.keys(ohMyConfig.categories || {}).length}</span> : null}
                {saving ? <span className="chip">{t('Saving...')}</span> : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <ActionButton onClick={() => setShowAddProvider(true)} variant="primary" icon={<InlineIcon name="plus" />}>
                {t('Add provider')}
              </ActionButton>
            </div>
          </div>
        </GlassPanel>

        {/* 状态提示 */}
        {error && (
          <div className="mb-4 px-4 py-3 bg-[#fef2f2] border border-[#fecaca] rounded-lg text-sm text-[#ef4444] flex items-center justify-between">
            {error}
            <button onClick={() => setError('')} className="text-[#ef4444] hover:text-[#dc2626]">✕</button>
          </div>
        )}
        {success && (
          <div className="mb-4 px-4 py-3 bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg text-sm text-[#10a37f]">{success}</div>
        )}

        {/* Oh My OpenCode */}
        {ohMyConfig && (
          <div className="mb-6">
            <div className="border border-[#e5e5e5] rounded-xl overflow-hidden">
              <div
                className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-[#f7f7f8] transition-colors"
                onClick={() => setOhMyExpanded(!ohMyExpanded)}
              >
                <div className="flex items-center gap-3">
                  <svg className={`w-4 h-4 text-[#6e6e80] transition-transform ${ohMyExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <h2 className="text-lg font-semibold text-[#0d0d0d]">Oh My OpenCode</h2>
                  <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-[#f0f0f0] text-[#6e6e80]">
                    {Object.keys(ohMyConfig.agents || {}).length} agents · {Object.keys(ohMyConfig.categories || {}).length} categories
                  </span>
                </div>
              </div>

              {ohMyExpanded && (
                <div className="border-t border-[#e5e5e5]">
                  {/* Agents */}
                  <div className="px-6 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-[#6e6e80]">Agents</h3>
                      <button onClick={() => setShowAddAgent(!showAddAgent)} className="text-xs text-[#6e6e80] hover:text-[#0d0d0d] transition-colors inline-flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        添加
                      </button>
                    </div>
                    {showAddAgent && (
                      <div className="flex items-center gap-2 mb-3 p-3 bg-[#fafafa] rounded-lg border border-[#e5e5e5]">
                        <input type="text" value={ohMyNewAgent.name} onChange={e => setOhMyNewAgent(f => ({ ...f, name: e.target.value }))}
                          placeholder="Agent 名称" className="w-40 px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]" />
                        <select value={ohMyNewAgent.model} onChange={e => setOhMyNewAgent(f => ({ ...f, model: e.target.value }))}
                          className="flex-1 px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d] bg-white">
                          <option value="">选择模型</option>
                          {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <button onClick={() => {
                          if (!ohMyNewAgent.name || !ohMyNewAgent.model) return
                          const c = JSON.parse(JSON.stringify(ohMyConfig))
                          if (!c.agents) c.agents = {}
                          c.agents[ohMyNewAgent.name] = { model: ohMyNewAgent.model }
                          saveOhMy(c)
                          setOhMyNewAgent({ name: '', model: '' })
                          setShowAddAgent(false)
                        }} className="px-4 py-2 text-sm font-medium text-white bg-[#0d0d0d] rounded-lg hover:bg-[#2d2d2d]">添加</button>
                        <button onClick={() => setShowAddAgent(false)} className="px-4 py-2 text-sm text-[#6e6e80] border border-[#e5e5e5] rounded-lg hover:bg-[#f7f7f8]">取消</button>
                      </div>
                    )}
                    <div className="space-y-1">
                      {Object.entries(ohMyConfig.agents || {}).map(([name, data]) => (
                        <div key={name} className="flex items-center justify-between px-4 py-2.5 rounded-lg hover:bg-[#f7f7f8] transition-colors group">
                          {ohMyEditingAgent === name ? (
                            <div className="flex items-center gap-2 flex-1">
                              <span className="text-sm font-medium text-[#0d0d0d] w-36">{name}</span>
                              <select value={data.model} onChange={e => {
                                const c = JSON.parse(JSON.stringify(ohMyConfig))
                                c.agents[name].model = e.target.value
                                saveOhMy(c)
                                setOhMyEditingAgent(null)
                              }} className="flex-1 px-3 py-1.5 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d] bg-white">
                                {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                              <button onClick={() => setOhMyEditingAgent(null)} className="text-xs text-[#6e6e80]">取消</button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-4 min-w-0">
                                <span className="text-base font-semibold text-[#0d0d0d]">{name}</span>
                                {AGENT_DESC[name] && <span className="text-xs text-[#acacac] hidden sm:inline">{AGENT_DESC[name]}</span>}
                                <span className="text-sm text-[#6e6e80] shrink-0">{data.model}</span>
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => setOhMyEditingAgent(name)} className="p-1.5 text-[#acacac] hover:text-[#0d0d0d] rounded-md hover:bg-[#f0f0f0]">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Categories */}
                  <div className="px-6 py-4 border-t border-[#e5e5e5]">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-[#6e6e80]">Categories</h3>
                      <button onClick={() => setShowAddCat(!showAddCat)} className="text-xs text-[#6e6e80] hover:text-[#0d0d0d] transition-colors inline-flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        添加
                      </button>
                    </div>
                    {showAddCat && (
                      <div className="flex items-center gap-2 mb-3 p-3 bg-[#fafafa] rounded-lg border border-[#e5e5e5]">
                        <input type="text" value={ohMyNewCat.name} onChange={e => setOhMyNewCat(f => ({ ...f, name: e.target.value }))}
                          placeholder="Category 名称" className="w-36 px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]" />
                        <select value={ohMyNewCat.model} onChange={e => setOhMyNewCat(f => ({ ...f, model: e.target.value }))}
                          className="flex-1 px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d] bg-white">
                          <option value="">选择模型</option>
                          {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <input type="text" value={ohMyNewCat.variant} onChange={e => setOhMyNewCat(f => ({ ...f, variant: e.target.value }))}
                          placeholder="variant (可选)" className="w-28 px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]" />
                        <button onClick={() => {
                          if (!ohMyNewCat.name || !ohMyNewCat.model) return
                          const c = JSON.parse(JSON.stringify(ohMyConfig))
                          if (!c.categories) c.categories = {}
                          const cat = { model: ohMyNewCat.model }
                          if (ohMyNewCat.variant) cat.variant = ohMyNewCat.variant
                          c.categories[ohMyNewCat.name] = cat
                          saveOhMy(c)
                          setOhMyNewCat({ name: '', model: '', variant: '' })
                          setShowAddCat(false)
                        }} className="px-4 py-2 text-sm font-medium text-white bg-[#0d0d0d] rounded-lg hover:bg-[#2d2d2d]">添加</button>
                        <button onClick={() => setShowAddCat(false)} className="px-4 py-2 text-sm text-[#6e6e80] border border-[#e5e5e5] rounded-lg hover:bg-[#f7f7f8]">取消</button>
                      </div>
                    )}
                    <div className="space-y-1">
                      {Object.entries(ohMyConfig.categories || {}).map(([name, data]) => (
                        <div key={name} className="flex items-center justify-between px-4 py-2.5 rounded-lg hover:bg-[#f7f7f8] transition-colors group">
                          {ohMyEditingCat === name ? (
                            <div className="flex items-center gap-2 flex-1">
                              <span className="text-sm font-medium text-[#0d0d0d] w-32">{name}</span>
                              <select value={data.model} onChange={e => {
                                const c = JSON.parse(JSON.stringify(ohMyConfig))
                                c.categories[name].model = e.target.value
                                saveOhMy(c)
                              }} className="flex-1 px-3 py-1.5 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d] bg-white">
                                {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                              <input type="text" value={data.variant || ''} onChange={e => {
                                const c = JSON.parse(JSON.stringify(ohMyConfig))
                                if (e.target.value) c.categories[name].variant = e.target.value
                                else delete c.categories[name].variant
                                saveOhMy(c)
                              }} placeholder="variant" className="w-24 px-3 py-1.5 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]" />
                              <button onClick={() => setOhMyEditingCat(null)} className="text-xs text-[#6e6e80]">完成</button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-4 min-w-0">
                                <span className="text-base font-semibold text-[#0d0d0d]">{name}</span>
                                {CATEGORY_DESC[name] && <span className="text-xs text-[#acacac] hidden sm:inline">{CATEGORY_DESC[name]}</span>}
                                <span className="text-sm text-[#6e6e80] shrink-0">{data.model}</span>
                                {data.variant && <span className="px-1.5 py-0.5 text-xs rounded bg-[#f0f0f0] text-[#6e6e80] shrink-0">{data.variant}</span>}
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => setOhMyEditingCat(name)} className="p-1.5 text-[#acacac] hover:text-[#0d0d0d] rounded-md hover:bg-[#f0f0f0]">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 提供商列表 */}
        {providers.length === 0 ? (
          <div className="text-center py-20 text-[#6e6e80]">
            <p className="text-lg">暂无提供商</p>
            <p className="text-sm mt-2">点击上方"添加提供商"开始配置</p>
          </div>
        ) : (
          <div className="space-y-4">
            {providers.map(([provKey, provData]) => {
              const models = provData.models ? Object.entries(provData.models) : []
              const isExpanded = expandedProvider === provKey

              return (
                <div key={provKey} className="border border-[#e5e5e5] rounded-xl overflow-hidden">
                  {/* 提供商头部 */}
                  <div
                    className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-[#f7f7f8] transition-colors"
                    onClick={() => setExpandedProvider(isExpanded ? null : provKey)}
                  >
                    <div className="flex items-center gap-3">
                      <svg className={`w-4 h-4 text-[#6e6e80] transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <h2 className="text-lg font-semibold text-[#0d0d0d]">{provKey}</h2>
                      <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-[#f0f0f0] text-[#6e6e80]">
                        {models.length} 模型
                      </span>
                    </div>
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <span className="text-xs text-[#acacac] mr-2">{provData.npm || ''}</span>
                      <button
                        onClick={() => handleDeleteProvider(provKey)}
                        className="p-1.5 text-[#acacac] hover:text-[#ef4444] rounded-md hover:bg-[#fef2f2] transition-colors"
                        title="删除提供商"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* 展开内容 */}
                  {isExpanded && (
                    <div className="border-t border-[#e5e5e5]">
                      {/* 提供商选项 */}
                      <div className="px-6 py-4 bg-[#fafafa] border-b border-[#e5e5e5]">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs text-[#6e6e80] mb-1">Base URL</label>
                            <input
                              type="text"
                              value={provData.options?.baseURL || ''}
                              onChange={e => handleUpdateProviderOptions(provKey, 'baseURL', e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]"
                              placeholder="http://localhost:8317/v1"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-[#6e6e80] mb-1">API Key</label>
                            <input
                              type="password"
                              value={provData.options?.apiKey || ''}
                              onChange={e => handleUpdateProviderOptions(provKey, 'apiKey', e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]"
                              placeholder="sk-..."
                            />
                          </div>
                        </div>
                      </div>

                      {/* 模型列表 */}
                      <div className="divide-y divide-[#e5e5e5]">
                        {models.map(([modelKey, modelData]) => (
                          <ModelRow
                            key={modelKey}
                            modelKey={modelKey}
                            modelData={modelData}
                            isEditing={editingModel?.providerKey === provKey && editingModel?.modelKey === modelKey}
                            onEdit={() => setEditingModel({ providerKey: provKey, modelKey })}
                            onCancelEdit={() => setEditingModel(null)}
                            onSave={(data) => handleUpdateModel(provKey, modelKey, data)}
                            onDelete={() => handleDeleteModel(provKey, modelKey)}
                            formatNum={formatNum}
                          />
                        ))}
                      </div>

                      {/* 添加模型 */}
                      {showAddModel === provKey ? (
                        <div className="px-6 py-4 border-t border-[#e5e5e5] bg-[#fafafa]">
                          <h4 className="text-sm font-medium text-[#0d0d0d] mb-3">添加模型</h4>
                          <div className="grid grid-cols-3 gap-3 mb-3">
                            <div>
                              <label className="block text-xs text-[#6e6e80] mb-1">模型名称</label>
                              <input
                                type="text"
                                value={newModelForm.name}
                                onChange={e => setNewModelForm(f => ({ ...f, name: e.target.value }))}
                                className="w-full px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]"
                                placeholder="gpt-4o"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-[#6e6e80] mb-1">上下文限制</label>
                              <input
                                type="number"
                                value={newModelForm.context}
                                onChange={e => setNewModelForm(f => ({ ...f, context: e.target.value }))}
                                className="w-full px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-[#6e6e80] mb-1">输出限制</label>
                              <input
                                type="number"
                                value={newModelForm.output}
                                onChange={e => setNewModelForm(f => ({ ...f, output: e.target.value }))}
                                className="w-full px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]"
                              />
                            </div>
                          </div>
                          <div className="flex gap-6 mb-3">
                            <div>
                              <label className="block text-xs text-[#6e6e80] mb-1">输入能力</label>
                              <div className="flex gap-2">
                                {MODALITY_OPTIONS.map(m => (
                                  <label key={m} className="flex items-center gap-1 text-xs text-[#0d0d0d]">
                                    <input
                                      type="checkbox"
                                      checked={newModelForm.inputMods.includes(m)}
                                      onChange={e => {
                                        setNewModelForm(f => ({
                                          ...f,
                                          inputMods: e.target.checked ? [...f.inputMods, m] : f.inputMods.filter(x => x !== m)
                                        }))
                                      }}
                                      className="rounded"
                                    />
                                    {m}
                                  </label>
                                ))}
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs text-[#6e6e80] mb-1">输出能力</label>
                              <div className="flex gap-2">
                                {MODALITY_OPTIONS.map(m => (
                                  <label key={m} className="flex items-center gap-1 text-xs text-[#0d0d0d]">
                                    <input
                                      type="checkbox"
                                      checked={newModelForm.outputMods.includes(m)}
                                      onChange={e => {
                                        setNewModelForm(f => ({
                                          ...f,
                                          outputMods: e.target.checked ? [...f.outputMods, m] : f.outputMods.filter(x => x !== m)
                                        }))
                                      }}
                                      className="rounded"
                                    />
                                    {m}
                                  </label>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAddModel(provKey)}
                              className="px-4 py-2 text-sm font-medium text-white bg-[#0d0d0d] rounded-lg hover:bg-[#2d2d2d]"
                            >
                              添加
                            </button>
                            <button
                              onClick={() => setShowAddModel(null)}
                              className="px-4 py-2 text-sm text-[#6e6e80] border border-[#e5e5e5] rounded-lg hover:bg-[#f7f7f8]"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="px-6 py-3 border-t border-[#e5e5e5]">
                          <button
                            onClick={() => setShowAddModel(provKey)}
                            className="text-sm text-[#6e6e80] hover:text-[#0d0d0d] inline-flex items-center gap-1 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            添加模型
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 添加提供商弹窗 */}
        {showAddProvider && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowAddProvider(false)}>
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-[#0d0d0d] mb-4">添加提供商</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-[#6e6e80] mb-1">提供商名称（唯一标识）</label>
                  <input
                    type="text"
                    value={newProviderForm.key}
                    onChange={e => setNewProviderForm(f => ({ ...f, key: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]"
                    placeholder="如 cpa, openai, deepseek"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#6e6e80] mb-1">NPM 包</label>
                  <input
                    type="text"
                    value={newProviderForm.npm}
                    onChange={e => setNewProviderForm(f => ({ ...f, npm: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]"
                    placeholder="@ai-sdk/openai-compatible"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#6e6e80] mb-1">Base URL</label>
                  <input
                    type="text"
                    value={newProviderForm.baseURL}
                    onChange={e => setNewProviderForm(f => ({ ...f, baseURL: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]"
                    placeholder="http://localhost:8317/v1"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#6e6e80] mb-1">API Key</label>
                  <input
                    type="text"
                    value={newProviderForm.apiKey}
                    onChange={e => setNewProviderForm(f => ({ ...f, apiKey: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]"
                    placeholder="sk-..."
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button
                  onClick={handleAddProvider}
                  className="flex-1 py-2 text-sm font-medium text-white bg-[#0d0d0d] rounded-lg hover:bg-[#2d2d2d]"
                >
                  添加
                </button>
                <button
                  onClick={() => setShowAddProvider(false)}
                  className="flex-1 py-2 text-sm text-[#6e6e80] border border-[#e5e5e5] rounded-lg hover:bg-[#f7f7f8]"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

// 解析 variant 条目：从原始 variants 对象转为 [{name, type, value}] 数组
function parseVariants(variants) {
  if (!variants || typeof variants !== 'object') return []
  return Object.entries(variants).map(([name, config]) => {
    if (config?.thinkingConfig?.thinkingBudget !== undefined) {
      return { name, type: 'thinkingBudget', value: String(config.thinkingConfig.thinkingBudget) }
    }
    if (config?.thinkingLevel !== undefined) {
      return { name, type: 'thinkingLevel', value: config.thinkingLevel }
    }
    // 未知结构，保留原始数据
    return { name, type: 'raw', value: config }
  })
}

// 将 [{name, type, value}] 数组转回 variants 对象
function buildVariants(entries) {
  if (!entries || entries.length === 0) return undefined
  const result = {}
  entries.forEach(({ name, type, value }) => {
    if (!name) return
    if (type === 'thinkingBudget') {
      result[name] = { thinkingConfig: { thinkingBudget: parseInt(value) || 0 } }
    } else if (type === 'thinkingLevel') {
      result[name] = { thinkingLevel: value }
    } else {
      result[name] = value // raw 类型原样保留
    }
  })
  return Object.keys(result).length > 0 ? result : undefined
}

const VARIANT_TYPES = [
  { value: 'thinkingBudget', label: '思考预算' },
  { value: 'thinkingLevel', label: '思考等级' },
]

function ModelRow({ modelKey, modelData, isEditing, onEdit, onCancelEdit, onSave, onDelete, formatNum }) {
  const [form, setForm] = useState(null)

  useEffect(() => {
    if (isEditing) {
      setForm({
        name: modelData.name || modelKey,
        context: modelData.limit?.context || '',
        output: modelData.limit?.output || '',
        inputMods: modelData.modalities?.input || [],
        outputMods: modelData.modalities?.output || [],
        attachment: modelData.attachment !== false,
        variants: parseVariants(modelData.variants)
      })
    }
  }, [isEditing])

  const handleSave = () => {
    const data = { name: form.name }
    if (form.context || form.output) {
      data.limit = {}
      if (form.context) data.limit.context = parseInt(form.context)
      if (form.output) data.limit.output = parseInt(form.output)
    }
    if (form.inputMods.length > 0 || form.outputMods.length > 0) {
      data.modalities = {}
      if (form.inputMods.length > 0) data.modalities.input = [...form.inputMods]
      if (form.outputMods.length > 0) data.modalities.output = [...form.outputMods]
    }
    if (!form.attachment) data.attachment = false
    const builtVariants = buildVariants(form.variants)
    if (builtVariants) data.variants = builtVariants
    onSave(data)
  }

  const updateVariant = (idx, field, val) => {
    setForm(f => {
      const variants = [...f.variants]
      variants[idx] = { ...variants[idx], [field]: val }
      return { ...f, variants }
    })
  }

  const removeVariant = (idx) => {
    setForm(f => ({ ...f, variants: f.variants.filter((_, i) => i !== idx) }))
  }

  const addVariant = () => {
    const defaultType = form.variants.length > 0 ? form.variants[0].type : 'thinkingBudget'
    setForm(f => ({ ...f, variants: [...f.variants, { name: '', type: defaultType, value: '' }] }))
  }

  if (isEditing && form) {
    return (
      <div className="px-6 py-4 bg-[#fafafa] border-t border-[#e5e5e5]">
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs text-[#6e6e80] mb-1">模型名称</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]" />
          </div>
          <div>
            <label className="block text-xs text-[#6e6e80] mb-1">上下文限制</label>
            <input type="number" value={form.context} onChange={e => setForm(f => ({ ...f, context: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]" />
          </div>
          <div>
            <label className="block text-xs text-[#6e6e80] mb-1">输出限制</label>
            <input type="number" value={form.output} onChange={e => setForm(f => ({ ...f, output: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-[#e5e5e5] rounded-lg focus:outline-none focus:border-[#0d0d0d]" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-[#6e6e80] mb-2">输入能力</label>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {MODALITY_OPTIONS.map(m => (
                <label key={m} className="flex items-center gap-2 text-sm text-[#0d0d0d] cursor-pointer select-none">
                  <input type="checkbox" checked={form.inputMods.includes(m)}
                    onChange={e => setForm(f => ({ ...f, inputMods: e.target.checked ? [...f.inputMods, m] : f.inputMods.filter(x => x !== m) }))}
                    className="w-4 h-4 accent-[#0d0d0d]" />
                  {m}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-[#6e6e80] mb-2">输出能力</label>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {MODALITY_OPTIONS.map(m => (
                <label key={m} className="flex items-center gap-2 text-sm text-[#0d0d0d] cursor-pointer select-none">
                  <input type="checkbox" checked={form.outputMods.includes(m)}
                    onChange={e => setForm(f => ({ ...f, outputMods: e.target.checked ? [...f.outputMods, m] : f.outputMods.filter(x => x !== m) }))}
                    className="w-4 h-4 accent-[#0d0d0d]" />
                  {m}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="mb-4">
          <label className="flex items-center gap-2 text-sm text-[#0d0d0d] cursor-pointer select-none">
            <input type="checkbox" checked={form.attachment} onChange={e => setForm(f => ({ ...f, attachment: e.target.checked }))} className="w-4 h-4 accent-[#0d0d0d]" />
            允许附件
          </label>
        </div>
        {/* Variants 编辑 */}
        {form.variants.length > 0 && (
          <div className="mb-4">
            <label className="block text-xs text-[#6e6e80] mb-2">Variants</label>
            <div className="space-y-2">
              {form.variants.map((v, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-white border border-[#e5e5e5] rounded-lg px-3 py-2">
                  <input type="text" value={v.name} onChange={e => updateVariant(idx, 'name', e.target.value)}
                    placeholder="名称" className="w-24 px-2 py-1.5 text-xs border border-[#e5e5e5] rounded-md focus:outline-none focus:border-[#0d0d0d]" />
                  {v.type !== 'raw' && (
                    <select value={v.type} onChange={e => updateVariant(idx, 'type', e.target.value)}
                      className="px-2 py-1.5 text-xs border border-[#e5e5e5] rounded-md focus:outline-none focus:border-[#0d0d0d] bg-white">
                      {VARIANT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  )}
                  {v.type === 'thinkingBudget' && (
                    <input type="number" value={v.value} onChange={e => updateVariant(idx, 'value', e.target.value)}
                      placeholder="Token 数" className="w-28 px-2 py-1.5 text-xs border border-[#e5e5e5] rounded-md focus:outline-none focus:border-[#0d0d0d]" />
                  )}
                  {v.type === 'thinkingLevel' && (
                    <input type="text" value={v.value} onChange={e => updateVariant(idx, 'value', e.target.value)}
                      placeholder="如 low, medium, high" className="w-36 px-2 py-1.5 text-xs border border-[#e5e5e5] rounded-md focus:outline-none focus:border-[#0d0d0d]" />
                  )}
                  {v.type === 'raw' && (
                    <span className="text-[10px] text-[#acacac]">自定义配置（保持不变）</span>
                  )}
                  <button onClick={() => removeVariant(idx)} className="ml-auto p-1 text-[#acacac] hover:text-[#ef4444] transition-colors" title="删除">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={handleSave} className="px-4 py-1.5 text-sm font-medium text-white bg-[#0d0d0d] rounded-lg hover:bg-[#2d2d2d] transition-colors">保存</button>
          <button onClick={onCancelEdit} className="px-4 py-1.5 text-sm text-[#6e6e80] border border-[#e5e5e5] rounded-lg hover:bg-[#f7f7f8] transition-colors">取消</button>
          <button onClick={addVariant} className="px-4 py-1.5 text-sm text-[#6e6e80] hover:text-[#0d0d0d] transition-colors">+ Variant</button>
        </div>
      </div>
    )
  }

  const inputMods = modelData.modalities?.input || []
  const outputMods = modelData.modalities?.output || []
  const hasVariants = modelData.variants && Object.keys(modelData.variants).length > 0

  return (
    <div className="px-6 py-3 flex items-center justify-between hover:bg-[#f7f7f8] transition-colors group">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-sm font-medium text-[#0d0d0d]">{modelData.name || modelKey}</span>
        {modelData.limit && (
          <span className="text-[10px] text-[#acacac]">
            ctx {formatNum(modelData.limit.context)} · out {formatNum(modelData.limit.output)}
          </span>
        )}
        <div className="flex gap-1">
          {inputMods.map(m => (
            <span key={m} className="px-1.5 py-0.5 text-[10px] rounded bg-[#e8f5e9] text-[#2e7d32]">{m}</span>
          ))}
          {outputMods.filter(m => !inputMods.includes(m)).map(m => (
            <span key={m} className="px-1.5 py-0.5 text-[10px] rounded bg-[#e3f2fd] text-[#1565c0]">{m}↑</span>
          ))}
        </div>
        {hasVariants && (
          <span className="text-[10px] text-[#acacac]">{Object.keys(modelData.variants).length} variants</span>
        )}
        {modelData.attachment === false && (
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-[#fef2f2] text-[#ef4444]">无附件</span>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} className="p-1.5 text-[#acacac] hover:text-[#0d0d0d] rounded-md hover:bg-[#f0f0f0]" title="编辑">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button onClick={onDelete} className="p-1.5 text-[#acacac] hover:text-[#ef4444] rounded-md hover:bg-[#fef2f2]" title="删除">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default OpenCodePage
