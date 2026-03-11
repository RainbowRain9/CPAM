import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from './ThemeProvider'
import { useTheme } from './useTheme'

function ThemeProbe() {
  const { theme, resolvedTheme, toggleTheme } = useTheme()

  return (
    <div>
      <span>{theme}</span>
      <span>{resolvedTheme}</span>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  )
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('uses the system theme by default and toggles persistently', () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    expect(screen.getByText('system')).toBeInTheDocument()
    expect(screen.getByText('dark')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('dark')

    fireEvent.click(screen.getByText('toggle'))

    expect(window.localStorage.getItem('api-center-theme-mode-v1')).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('respects a stored theme override', () => {
    window.localStorage.setItem('api-center-theme-mode-v1', 'light')

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    expect(screen.getAllByText('light')).toHaveLength(2)
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
