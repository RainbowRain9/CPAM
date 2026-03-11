import type { ResolvedTheme } from './themeStorage'

export const themeTokens = {
  dark: {
    particleRgb: '255,255,255',
    particleAlpha: 0.12,
    pointerForce: 0.014,
    densityScale: 1,
  },
  light: {
    particleRgb: '16,16,16',
    particleAlpha: 0.08,
    pointerForce: 0.012,
    densityScale: 0.82,
  },
} satisfies Record<ResolvedTheme, {
  particleRgb: string
  particleAlpha: number
  pointerForce: number
  densityScale: number
}>
