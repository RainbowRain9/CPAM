export type ProviderOptionDraft = {
  baseURL: string
  apiKey: string
}

type ProviderOptions = {
  baseURL?: string
  apiKey?: string
}

type OpenCodeConfig = {
  provider?: Record<string, { options?: ProviderOptions }>
}

export function createProviderOptionDraft(options?: ProviderOptions | null): ProviderOptionDraft {
  return {
    baseURL: String(options?.baseURL || ''),
    apiKey: String(options?.apiKey || ''),
  }
}

export function buildProviderOptionDrafts(config?: OpenCodeConfig | null): Record<string, ProviderOptionDraft> {
  return Object.fromEntries(
    Object.entries(config?.provider || {}).map(([providerKey, providerConfig]) => [
      providerKey,
      createProviderOptionDraft(providerConfig?.options),
    ]),
  )
}

export function hasProviderOptionDraftChanges(
  config: OpenCodeConfig | null | undefined,
  providerKey: string,
  draft?: ProviderOptionDraft | null,
) {
  const currentDraft = createProviderOptionDraft(config?.provider?.[providerKey]?.options)
  const nextDraft = createProviderOptionDraft(draft)
  return currentDraft.baseURL !== nextDraft.baseURL || currentDraft.apiKey !== nextDraft.apiKey
}

export function applyProviderOptionDraft<
  T extends {
    provider?: Record<string, { options?: ProviderOptions }>
  },
>(config: T, providerKey: string, draft?: ProviderOptionDraft | null): T {
  const nextConfig = JSON.parse(JSON.stringify(config || {}))
  if (!nextConfig.provider?.[providerKey]) {
    return nextConfig
  }

  nextConfig.provider[providerKey].options = {
    baseURL: String(draft?.baseURL || '').trim(),
    apiKey: String(draft?.apiKey || '').trim(),
  }
  return nextConfig
}

export function getModelNameValidationError(
  models: Record<string, unknown> | undefined,
  currentModelKey: string,
  nextModelName: string,
) {
  const normalizedModelName = String(nextModelName || '').trim()
  if (!normalizedModelName) {
    return '模型名称不能为空'
  }

  if (normalizedModelName !== currentModelKey && models?.[normalizedModelName]) {
    return `模型 "${normalizedModelName}" 已存在`
  }

  return ''
}
