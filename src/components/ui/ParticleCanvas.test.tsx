import { render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../../theme/ThemeProvider'
import { ParticleCanvas } from './ParticleCanvas'

describe('ParticleCanvas', () => {
  const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame')
  const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame')

  beforeEach(() => {
    requestAnimationFrameSpy.mockImplementation(() => 1)
    cancelAnimationFrameSpy.mockImplementation(() => {})
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('starts and cleans up the animation frame loop', () => {
    const { unmount } = render(
      <ThemeProvider>
        <div style={{ width: 640, height: 480, position: 'relative' }}>
          <ParticleCanvas />
        </div>
      </ThemeProvider>,
    )

    expect(requestAnimationFrameSpy).toHaveBeenCalled()

    unmount()

    expect(cancelAnimationFrameSpy).toHaveBeenCalled()
  })
})
