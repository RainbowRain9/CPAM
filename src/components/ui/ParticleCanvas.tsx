import { useEffect, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { themeTokens } from '../../theme/themeTokens'
import { useTheme } from '../../theme/useTheme'
import styles from './ParticleCanvas.module.scss'

type ParticleCanvasProps = {
  density?: number
  interactive?: boolean
  subdued?: boolean
}

type PointerState = {
  x: number
  y: number
  active: boolean
}

class Particle {
  x: number
  y: number
  velocity: { x: number; y: number }
  size: number
  opacity: number
  depth: number
  driftX: number
  driftY: number

  constructor(width: number, height: number) {
    this.x = Math.random() * width
    this.y = Math.random() * height
    this.velocity = {
      x: (Math.random() - 0.5) * 0.06,
      y: -0.02 - Math.random() * 0.08,
    }
    this.size = 0.6 + Math.random() * 2.6
    this.opacity = 0.18 + Math.random() * 0.62
    this.depth = 0.35 + Math.random() * 0.85
    this.driftX = (Math.random() - 0.5) * 0.012
    this.driftY = 0.001 + Math.random() * 0.006
  }

  draw(ctx: CanvasRenderingContext2D, rgb: string, alphaScale: number) {
    const radius = this.size * this.depth
    const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, radius * 2.6)
    gradient.addColorStop(0, `rgba(${rgb}, ${this.opacity * alphaScale})`)
    gradient.addColorStop(1, `rgba(${rgb}, 0)`)
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(this.x, this.y, radius * 2.6, 0, Math.PI * 2)
    ctx.fill()
  }

  update(width: number, height: number, pointer: PointerState, pointerForce: number) {
    const centerX = width / 2
    const centerY = height / 2

    this.velocity.x += this.driftX * this.depth
    this.velocity.y -= this.driftY * this.depth

    const homePullX = (centerX - this.x) * 0.000002 * this.depth
    const homePullY = (centerY - this.y) * 0.0000015 * this.depth

    this.velocity.x += homePullX
    this.velocity.y += homePullY

    if (pointer.active) {
      const dx = this.x - pointer.x
      const dy = this.y - pointer.y
      const distance = Math.sqrt(dx * dx + dy * dy) || 1
      const radius = 160
      if (distance < radius) {
        const force = ((radius - distance) / radius) * pointerForce * this.depth
        this.velocity.x += (dx / distance) * force
        this.velocity.y += (dy / distance) * force
      }
    }

    this.velocity.x *= 0.992
    this.velocity.y *= 0.994

    this.x += this.velocity.x
    this.y += this.velocity.y

    if (this.y < -24) this.y = height + 24
    if (this.y > height + 24) this.y = -24
    if (this.x < -24) this.x = width + 24
    if (this.x > width + 24) this.x = -24
  }
}

export function ParticleCanvas({
  density = 1,
  interactive = true,
  subdued = false,
}: ParticleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationRef = useRef<number | null>(null)
  const lastFrameRef = useRef(0)
  const particlesRef = useRef<Particle[]>([])
  const pointerRef = useRef<PointerState>({ x: 0, y: 0, active: false })
  const visibleRef = useRef(true)
  const pointerEnabledRef = useRef(interactive)
  const { resolvedTheme } = useTheme()

  const config = useMemo(() => themeTokens[resolvedTheme], [resolvedTheme])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const isLowPowerDevice = (navigator.hardwareConcurrency ?? 8) <= 4
    const densityScale = isLowPowerDevice ? 0.58 : 1
    const minParticles = subdued ? 18 : 24
    const maxParticles = isLowPowerDevice ? 56 : subdued ? 84 : 120
    const targetFps = subdued || isLowPowerDevice ? 24 : 30
    const frameInterval = 1000 / targetFps
    const dprCap = isLowPowerDevice ? 1 : subdued ? 1.25 : 1.5
    pointerEnabledRef.current = interactive && !prefersReducedMotion && !isLowPowerDevice

    const resize = () => {
      const parent = canvas.parentElement
      const width = Math.max(parent?.clientWidth || 0, window.innerWidth)
      const height = Math.max(parent?.clientHeight || 0, window.innerHeight)
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap)
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const particleCount = Math.round(
        (width * height) / 15000 * density * config.densityScale * densityScale * (subdued ? 0.78 : 1),
      )
      particlesRef.current = Array.from(
        { length: Math.max(minParticles, Math.min(maxParticles, particleCount)) },
        () => new Particle(width, height),
      )
    }

    const stop = () => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
    }

    const render = (timestamp: number) => {
      if (!visibleRef.current) {
        return
      }

      if (timestamp - lastFrameRef.current < frameInterval) {
        animationRef.current = window.requestAnimationFrame(render)
        return
      }

      lastFrameRef.current = timestamp

      const width = canvas.clientWidth
      const height = canvas.clientHeight
      ctx.clearRect(0, 0, width, height)

      for (const particle of particlesRef.current) {
        particle.update(
          width,
          height,
          pointerRef.current,
          pointerEnabledRef.current ? config.pointerForce * (subdued ? 0.72 : 1) : 0,
        )
        particle.draw(ctx, config.particleRgb, config.particleAlpha * (subdued ? 0.62 : 1))
      }

      animationRef.current = window.requestAnimationFrame(render)
    }

    const start = () => {
      if (animationRef.current === null) {
        animationRef.current = window.requestAnimationFrame(render)
      }
    }

    const handleVisibility = () => {
      visibleRef.current = document.visibilityState !== 'hidden'
      if (!visibleRef.current) {
        stop()
        return
      }

      lastFrameRef.current = 0
      start()
    }

    resize()
    if (prefersReducedMotion) {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
      return
    }

    start()

    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', handleVisibility)
      stop()
    }
  }, [config, density, interactive, subdued])

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointerEnabledRef.current) {
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    pointerRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      active: true,
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        pointerRef.current.active = false
      }}
      aria-hidden="true"
    />
  )
}
