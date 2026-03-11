import { createContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { getSystemTheme, readStoredTheme, writeStoredTheme, type ResolvedTheme, type ThemeMode } from './themeStorage'

type ThemeContextValue = {
  theme: ThemeMode
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

function resolveTheme(theme: ThemeMode): ResolvedTheme {
  return theme === 'system' ? getSystemTheme() : theme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme())
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(readStoredTheme()))

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const syncTheme = (nextTheme: ThemeMode) => {
      const nextResolvedTheme = resolveTheme(nextTheme)
      setResolvedTheme(nextResolvedTheme)
      document.documentElement.dataset.theme = nextResolvedTheme
      document.documentElement.style.colorScheme = nextResolvedTheme
    }

    syncTheme(theme)

    const handleChange = () => {
      if (theme === 'system') {
        syncTheme('system')
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  const setTheme = (nextTheme: ThemeMode) => {
    setThemeState(nextTheme)
    writeStoredTheme(nextTheme)
  }

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme: () => {
      const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
      setTheme(nextTheme)
    },
  }), [theme, resolvedTheme])

  return (
    <ThemeContext.Provider value={value}>
      <div className="theme-transition min-h-screen">{children}</div>
    </ThemeContext.Provider>
  )
}
