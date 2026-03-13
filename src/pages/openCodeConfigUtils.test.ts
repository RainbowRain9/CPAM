import { describe, expect, it } from 'vitest'

import {
  applyProviderOptionDraft,
  buildProviderOptionDrafts,
  createProviderOptionDraft,
  getModelNameValidationError,
  hasProviderOptionDraftChanges,
} from './openCodeConfigUtils'

describe('openCodeConfigUtils', () => {
  it('builds provider option drafts from config safely', () => {
    expect(buildProviderOptionDrafts({
      provider: {
        primary: {
          options: {
            baseURL: 'http://localhost:8317/v1',
            apiKey: 'secret',
          },
        },
      },
    })).toEqual({
      primary: {
        baseURL: 'http://localhost:8317/v1',
        apiKey: 'secret',
      },
    })

    expect(createProviderOptionDraft()).toEqual({
      baseURL: '',
      apiKey: '',
    })
  })

  it('detects pending provider option changes and applies trimmed drafts', () => {
    const config = {
      provider: {
        primary: {
          options: {
            baseURL: 'http://localhost:8317/v1',
            apiKey: 'secret',
          },
        },
      },
    }

    expect(hasProviderOptionDraftChanges(config, 'primary', {
      baseURL: 'http://localhost:8317/v1',
      apiKey: 'secret',
    })).toBe(false)

    expect(hasProviderOptionDraftChanges(config, 'primary', {
      baseURL: ' http://localhost:8317/v2 ',
      apiKey: 'secret',
    })).toBe(true)

    expect(applyProviderOptionDraft(config, 'primary', {
      baseURL: ' http://localhost:8317/v2 ',
      apiKey: ' updated-secret ',
    })).toEqual({
      provider: {
        primary: {
          options: {
            baseURL: 'http://localhost:8317/v2',
            apiKey: 'updated-secret',
          },
        },
      },
    })
  })

  it('rejects blank or duplicate model names while allowing unchanged saves', () => {
    const models = {
      'gpt-4o': {},
      'gpt-4.1': {},
    }

    expect(getModelNameValidationError(models, 'gpt-4o', '   ')).toBe('模型名称不能为空')
    expect(getModelNameValidationError(models, 'gpt-4o', 'gpt-4.1')).toBe('模型 "gpt-4.1" 已存在')
    expect(getModelNameValidationError(models, 'gpt-4o', ' gpt-4o ')).toBe('')
  })
})
