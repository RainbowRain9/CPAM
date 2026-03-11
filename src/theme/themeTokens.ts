import type { ResolvedTheme } from './themeStorage'

export const themeTokens = {
  dark: {
    particleRgb: '255,255,255',
    particleAlpha: 0.24,
    pointerForce: 0.017,
    densityScale: 1.28,
  },
  light: {
    particleRgb: '16,16,16',
    particleAlpha: 0.16,
    pointerForce: 0.014,
    densityScale: 1.05,
  },
} satisfies Record<ResolvedTheme, {
  particleRgb: string
  particleAlpha: number
  pointerForce: number
  densityScale: number
}>
