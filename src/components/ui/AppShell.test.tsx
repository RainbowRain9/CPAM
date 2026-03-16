import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

vi.mock('./ParticleCanvas', () => ({
  ParticleCanvas: () => <div data-testid="particle-canvas" />,
}))

vi.mock('./ThemeToggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}))

vi.mock('./TopNav', () => ({
  TopNav: () => <div data-testid="top-nav" />,
}))

describe('AppShell', () => {
  it('defers particle canvas mounting until after the initial paint', async () => {
    render(
      <AppShell showNav={false}>
        <div>content</div>
      </AppShell>,
    )

    expect(screen.queryByTestId('particle-canvas')).not.toBeInTheDocument()
    expect(await screen.findByTestId('particle-canvas')).toBeInTheDocument()
  })
})
