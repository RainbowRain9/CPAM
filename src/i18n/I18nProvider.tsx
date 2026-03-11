import { createContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { messages, type SupportedLocale } from './messages'

type I18nContextValue = {
  locale: SupportedLocale
  t: (key: string, vars?: Record<string, string | number>) => string
}

export const I18nContext = createContext<I18nContextValue | null>(null)

function detectLocale(): SupportedLocale {
  if (typeof navigator === 'undefined') return 'zh-CN'
  const language = navigator.language.toLowerCase()
  if (language.startsWith('ru')) return 'ru'
  if (language.startsWith('zh')) return 'zh-CN'
  return 'en'
}

function interpolate(template: string, vars: Record<string, string | number> = {}) {
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''))
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = detectLocale()

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    t: (key, vars) => {
      const localized = messages[locale][key as keyof typeof messages[typeof locale]]
      const fallback = messages['zh-CN'][key as keyof typeof messages['zh-CN']]
      return interpolate((localized || fallback || key) as string, vars)
    },
  }), [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
