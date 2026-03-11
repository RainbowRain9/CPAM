import { MODEL_PRICING_PRESETS, MODEL_PRICING_PRESET_VERSION } from './modelPricingPresets'

export type ModelPricing = {
  promptPrice: number
  completionPrice: number
  cachePrice: number
}

export type ModelPricingMap = Record<string, ModelPricing>

type LoadedModelPricingState = {
  pricing: ModelPricingMap
  hasStoredPricing: boolean
  removedPresetModels: string[]
  presetOptIn: boolean
}

export const LOCAL_MODEL_PRICING_KEY = 'api-center-local-model-pricing-v1'
export const LOCAL_MODEL_PRICING_PRESET_VERSION_KEY = 'api-center-local-model-pricing-preset-version-v1'
export const LOCAL_MODEL_PRICING_REMOVED_PRESETS_KEY = 'api-center-local-model-pricing-removed-presets-v1'
export const LOCAL_MODEL_PRICING_PRESET_OPT_IN_KEY = 'api-center-local-model-pricing-preset-opt-in-v1'

function toSafeNumber(value: unknown) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function toNonNegativeNumber(value: unknown) {
  return Math.max(0, toSafeNumber(value))
}

function clonePricingMap(pricing: ModelPricingMap) {
  return Object.fromEntries(
    Object.entries(pricing).map(([model, value]) => [model, { ...value }]),
  )
}

function readRemovedPresetModels() {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(LOCAL_MODEL_PRICING_REMOVED_PRESETS_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

function readPresetOptIn() {
  if (typeof window === 'undefined') return true

  const raw = window.localStorage.getItem(LOCAL_MODEL_PRICING_PRESET_OPT_IN_KEY)
  if (raw === null) return true
  return raw !== 'false'
}

export function normalizeLocalPricingMap(rawValue: unknown): ModelPricingMap {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return {}
  }

  const normalized: ModelPricingMap = {}

  Object.entries(rawValue).forEach(([model, value]) => {
    if (!model || !value || typeof value !== 'object' || Array.isArray(value)) return

    const pricingValue = value as Record<string, unknown>
    const promptPrice = toNonNegativeNumber(
      pricingValue.promptPrice ?? pricingValue.prompt ?? pricingValue.inputPrice,
    )
    const completionPrice = toNonNegativeNumber(
      pricingValue.completionPrice ?? pricingValue.completion ?? pricingValue.outputPrice,
    )
    const hasExplicitCachePrice =
      pricingValue.cachePrice !== undefined ||
      pricingValue.cache !== undefined ||
      pricingValue.cacheInputPrice !== undefined
    const cacheRaw = pricingValue.cachePrice ?? pricingValue.cache ?? pricingValue.cacheInputPrice
    const cachePrice = hasExplicitCachePrice
      ? toNonNegativeNumber(cacheRaw)
      : promptPrice

    normalized[model] = {
      promptPrice,
      completionPrice,
      cachePrice,
    }
  })

  return normalized
}

export function mergeModelPricingMaps(basePricing: ModelPricingMap, overridePricing: ModelPricingMap) {
  return {
    ...clonePricingMap(basePricing),
    ...clonePricingMap(overridePricing),
  }
}

export function migrateServerPricing(serverPricing: unknown) {
  return normalizeLocalPricingMap(serverPricing)
}

export function loadLocalModelPricingState(): LoadedModelPricingState {
  if (typeof window === 'undefined') {
    return {
      pricing: clonePricingMap(MODEL_PRICING_PRESETS),
      hasStoredPricing: false,
      removedPresetModels: [],
      presetOptIn: true,
    }
  }

  const removedPresetModels = readRemovedPresetModels()
  const removedPresetModelSet = new Set(removedPresetModels)
  const presetOptIn = readPresetOptIn()

  try {
    const rawPricing = window.localStorage.getItem(LOCAL_MODEL_PRICING_KEY)
    const storedVersion = window.localStorage.getItem(LOCAL_MODEL_PRICING_PRESET_VERSION_KEY)

    if (!rawPricing) {
      return {
        pricing: clonePricingMap(MODEL_PRICING_PRESETS),
        hasStoredPricing: false,
        removedPresetModels,
        presetOptIn,
      }
    }

    const storedPricing = normalizeLocalPricingMap(JSON.parse(rawPricing))
    const needsPresetMerge = presetOptIn && storedVersion !== MODEL_PRICING_PRESET_VERSION

    if (!needsPresetMerge) {
      return {
        pricing: storedPricing,
        hasStoredPricing: true,
        removedPresetModels,
        presetOptIn,
      }
    }

    const mergedPricing = mergeModelPricingMaps(MODEL_PRICING_PRESETS, storedPricing)
    removedPresetModelSet.forEach((model) => {
      delete mergedPricing[model]
    })

    return {
      pricing: mergedPricing,
      hasStoredPricing: true,
      removedPresetModels,
      presetOptIn,
    }
  } catch {
    return {
      pricing: clonePricingMap(MODEL_PRICING_PRESETS),
      hasStoredPricing: false,
      removedPresetModels,
      presetOptIn,
    }
  }
}

export function persistLocalModelPricingState({
  pricing,
  removedPresetModels,
  presetOptIn,
}: {
  pricing: ModelPricingMap
  removedPresetModels: string[]
  presetOptIn: boolean
}) {
  try {
    if (typeof window === 'undefined') return

    window.localStorage.setItem(LOCAL_MODEL_PRICING_KEY, JSON.stringify(pricing))
    window.localStorage.setItem(
      LOCAL_MODEL_PRICING_PRESET_VERSION_KEY,
      MODEL_PRICING_PRESET_VERSION,
    )
    window.localStorage.setItem(
      LOCAL_MODEL_PRICING_REMOVED_PRESETS_KEY,
      JSON.stringify(Array.from(new Set(removedPresetModels)).sort()),
    )
    window.localStorage.setItem(
      LOCAL_MODEL_PRICING_PRESET_OPT_IN_KEY,
      presetOptIn ? 'true' : 'false',
    )
  } catch {
    console.warn('保存本地模型价格失败')
  }
}
