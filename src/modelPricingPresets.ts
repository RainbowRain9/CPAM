// Official list pricing reviewed on 2026-03-12.
// Sources:
// - OpenAI: https://openai.com/api/pricing/
// - Anthropic: https://claude.com/pricing
// - Google Vertex AI: https://cloud.google.com/vertex-ai/generative-ai/pricing
// - DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
// - xAI: https://docs.x.ai/developers/models
// - Together AI: https://www.together.ai/pricing
//
// App note:
// - The current UI supports a single cache price.
// - Anthropic lists cache write/read separately; presets store the read price.

const createPricing = (promptPrice: number, completionPrice: number, cachePrice = promptPrice) => ({
  promptPrice,
  completionPrice,
  cachePrice,
})

const withAliases = (
  pricing: { promptPrice: number; completionPrice: number; cachePrice: number },
  names: string[]
) => Object.fromEntries(names.map((name) => [name, { ...pricing }]))

export const MODEL_PRICING_PRESET_VERSION = '2026-03-12-market-defaults-v2'

export const MODEL_PRICING_PRESETS = {
  ...withAliases(createPricing(2.5, 15, 0.25), ['gpt-5.4']),
  ...withAliases(createPricing(1.25, 10, 0.125), [
    'gpt-5',
    'gpt-5-chat-latest',
    'gpt-5-codex',
  ]),
  ...withAliases(createPricing(0.25, 2, 0.025), [
    'gpt-5-mini',
    'gpt-5.1-codex-mini',
  ]),
  ...withAliases(createPricing(0.05, 0.4, 0.005), ['gpt-5-nano']),
  ...withAliases(createPricing(2, 8, 0.5), ['gpt-4.1', 'o3']),
  ...withAliases(createPricing(0.4, 1.6, 0.1), ['gpt-4.1-mini']),
  ...withAliases(createPricing(0.1, 0.4, 0.025), ['gpt-4.1-nano']),
  ...withAliases(createPricing(2.5, 10, 1.25), ['gpt-4o']),
  ...withAliases(createPricing(0.15, 0.6, 0.075), ['gpt-4o-mini']),
  ...withAliases(createPricing(1.1, 4.4, 0.275), ['o4-mini']),
  ...withAliases(createPricing(1.1, 4.4, 0.55), ['o3-mini']),
  ...withAliases(createPricing(1.5, 6, 0.375), ['codex-mini-latest']),

  ...withAliases(createPricing(5, 25, 0.5), ['claude-opus-4-6']),
  ...withAliases(createPricing(3, 15, 0.3), [
    'claude-sonnet-4-6',
    'claude-sonnet-4',
    'claude-sonnet-4-20250514',
    'claude-3-7-sonnet',
    'claude-3-7-sonnet-latest',
    'claude-3-7-sonnet-20250219',
  ]),
  ...withAliases(createPricing(1, 5, 0.1), [
    'claude-haiku-4-5',
    'claude-haiku-4-5-20251001',
  ]),
  ...withAliases(createPricing(0.8, 4, 0.08), [
    'claude-3-5-haiku',
    'claude-3-5-haiku-latest',
    'claude-3-5-haiku-20241022',
  ]),
  ...withAliases(createPricing(0.25, 1.25, 0.03), ['claude-3-haiku-20240307']),

  ...withAliases(createPricing(1.25, 10, 0.125), ['gemini-2.5-pro']),
  ...withAliases(createPricing(0.3, 2.5, 0.03), ['gemini-2.5-flash']),
  ...withAliases(createPricing(0.1, 0.4, 0.01), ['gemini-2.5-flash-lite']),
  ...withAliases(createPricing(2, 12, 0.2), ['gemini-3-pro-preview']),
  ...withAliases(createPricing(0.5, 3, 0.05), ['gemini-3-flash-preview']),

  ...withAliases(createPricing(3, 15, 0.75), [
    'grok-4',
    'grok-4-latest',
    'grok-4-0709',
  ]),
  ...withAliases(createPricing(0.2, 0.5, 0.05), [
    'grok-4-fast',
    'grok-4-fast-reasoning',
    'grok-4-fast-non-reasoning',
    'grok-4-1-fast',
    'grok-4-1-fast-reasoning',
    'grok-4-1-fast-non-reasoning',
  ]),
  ...withAliases(createPricing(0.2, 1.5), ['grok-code-fast-1']),
  ...withAliases(createPricing(0.3, 0.5, 0.07), ['grok-3-mini']),

  ...withAliases(createPricing(0.28, 0.42, 0.028), ['deepseek-chat']),
  ...withAliases(createPricing(0.28, 0.42, 0.028), ['deepseek-reasoner']),

  ...withAliases(createPricing(1, 3.2, 0), ['GLM-5']),
  ...withAliases(createPricing(0.5, 2.8, 0), ['Kimi K2.5']),
  ...withAliases(createPricing(0.6, 1.7, 0), ['DeepSeek-V3.1']),
  ...withAliases(createPricing(0.2, 0.6, 0), ['Qwen3 235B A22B Instruct 2507 FP8']),
  ...withAliases(createPricing(0.27, 0.85, 0), ['Llama 4 Maverick']),
}
