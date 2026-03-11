import { MODEL_PRICING_PRESET_VERSION, MODEL_PRICING_PRESETS } from './modelPricingPresets'
import {
  LOCAL_MODEL_PRICING_KEY,
  LOCAL_MODEL_PRICING_PRESET_OPT_IN_KEY,
  LOCAL_MODEL_PRICING_PRESET_VERSION_KEY,
  LOCAL_MODEL_PRICING_REMOVED_PRESETS_KEY,
  loadLocalModelPricingState,
  normalizeLocalPricingMap,
  persistLocalModelPricingState,
} from './modelPricingState'

describe('modelPricingState', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('seeds official presets when no local pricing exists', () => {
    const state = loadLocalModelPricingState()

    expect(state.hasStoredPricing).toBe(false)
    expect(state.presetOptIn).toBe(true)
    expect(state.removedPresetModels).toEqual([])
    expect(state.pricing['gpt-5.4']).toEqual(MODEL_PRICING_PRESETS['gpt-5.4'])
    expect(state.pricing['gemini-3-pro-preview']).toEqual(MODEL_PRICING_PRESETS['gemini-3-pro-preview'])
  })

  it('keeps stored pricing authoritative when preset version already matches', () => {
    window.localStorage.setItem(
      LOCAL_MODEL_PRICING_KEY,
      JSON.stringify({
        'custom-model': {
          promptPrice: 9,
          completionPrice: 19,
          cachePrice: 0,
        },
      }),
    )
    window.localStorage.setItem(LOCAL_MODEL_PRICING_PRESET_VERSION_KEY, MODEL_PRICING_PRESET_VERSION)

    const state = loadLocalModelPricingState()

    expect(state.hasStoredPricing).toBe(true)
    expect(state.pricing).toEqual({
      'custom-model': {
        promptPrice: 9,
        completionPrice: 19,
        cachePrice: 0,
      },
    })
  })

  it('merges new presets into older stored pricing while honoring removed preset models', () => {
    window.localStorage.setItem(
      LOCAL_MODEL_PRICING_KEY,
      JSON.stringify({
        'gpt-5.4': {
          promptPrice: 3,
          completionPrice: 20,
          cachePrice: 0.4,
        },
        'custom-model': {
          promptPrice: 1.2,
          completionPrice: 2.4,
          cachePrice: 0.1,
        },
      }),
    )
    window.localStorage.setItem(LOCAL_MODEL_PRICING_PRESET_VERSION_KEY, '2026-03-11')
    window.localStorage.setItem(
      LOCAL_MODEL_PRICING_REMOVED_PRESETS_KEY,
      JSON.stringify(['gpt-5-mini']),
    )

    const state = loadLocalModelPricingState()

    expect(state.pricing['gpt-5.4']).toEqual({
      promptPrice: 3,
      completionPrice: 20,
      cachePrice: 0.4,
    })
    expect(state.pricing['custom-model']).toEqual({
      promptPrice: 1.2,
      completionPrice: 2.4,
      cachePrice: 0.1,
    })
    expect(state.pricing['claude-sonnet-4-6']).toEqual(MODEL_PRICING_PRESETS['claude-sonnet-4-6'])
    expect(state.pricing['gpt-5-mini']).toBeUndefined()
  })

  it('disables future preset merges after clear-all style opt-out is persisted', () => {
    window.localStorage.setItem(LOCAL_MODEL_PRICING_KEY, JSON.stringify({}))
    window.localStorage.setItem(LOCAL_MODEL_PRICING_PRESET_VERSION_KEY, '2026-03-11')
    window.localStorage.setItem(LOCAL_MODEL_PRICING_PRESET_OPT_IN_KEY, 'false')

    const state = loadLocalModelPricingState()

    expect(state.presetOptIn).toBe(false)
    expect(state.pricing).toEqual({})
  })

  it('persists pricing metadata together with the current preset version', () => {
    persistLocalModelPricingState({
      pricing: {
        'grok-4-0709': {
          promptPrice: 3,
          completionPrice: 15,
          cachePrice: 0.75,
        },
      },
      removedPresetModels: ['gpt-5-mini', 'gpt-5-mini'],
      presetOptIn: false,
    })

    expect(window.localStorage.getItem(LOCAL_MODEL_PRICING_KEY)).toContain('grok-4-0709')
    expect(window.localStorage.getItem(LOCAL_MODEL_PRICING_PRESET_VERSION_KEY)).toBe(
      MODEL_PRICING_PRESET_VERSION,
    )
    expect(window.localStorage.getItem(LOCAL_MODEL_PRICING_PRESET_OPT_IN_KEY)).toBe('false')
    expect(window.localStorage.getItem(LOCAL_MODEL_PRICING_REMOVED_PRESETS_KEY)).toBe(
      JSON.stringify(['gpt-5-mini']),
    )
  })

  it('preserves explicit zero cache prices and defaults missing cache prices to prompt price', () => {
    expect(normalizeLocalPricingMap({
      'no-cache-model': {
        promptPrice: 0.5,
        completionPrice: 2.8,
        cachePrice: 0,
      },
      'implicit-cache-model': {
        promptPrice: 1.25,
        completionPrice: 10,
      },
    })).toEqual({
      'no-cache-model': {
        promptPrice: 0.5,
        completionPrice: 2.8,
        cachePrice: 0,
      },
      'implicit-cache-model': {
        promptPrice: 1.25,
        completionPrice: 10,
        cachePrice: 1.25,
      },
    })
  })
})
