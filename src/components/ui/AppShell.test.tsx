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
  it('renders the shared shell content and particle background', () => {
    render(
      <AppShell showNav={false}>
        <div>content</div>
      </AppShell>,
    )

    expect(screen.getByTestId('particle-canvas')).toBeInTheDocument()
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
