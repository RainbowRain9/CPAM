import { Suspense, lazy, type ReactNode, useEffect, useState } from 'react'
import styles from './ui.module.scss'
import { TopNav, type NavItem } from './TopNav'
import { ThemeToggle } from './ThemeToggle'

const PARTICLE_CANVAS_DELAY_MS = 120
const ParticleCanvas = lazy(async () => {
  const module = await import('./ParticleCanvas')
  return { default: module.ParticleCanvas }
})

export function AppShell({
  navItems = [],
  showNav = true,
  subduedParticles = false,
  actions,
  children,
}: {
  navItems?: NavItem[]
  showNav?: boolean
  subduedParticles?: boolean
  actions?: ReactNode
  children: ReactNode
}) {
  const [showParticles, setShowParticles] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowParticles(true)
    }, PARTICLE_CANVAS_DELAY_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <div className={styles.shell}>
      <div className={styles.background}>
        {showParticles ? (
          <Suspense fallback={null}>
            <ParticleCanvas density={1} interactive={!subduedParticles} subdued={subduedParticles} />
          </Suspense>
        ) : null}
      </div>
      <div className={styles.content}>
        {showNav ? <TopNav items={navItems} actions={actions} /> : (
          <div className="mb-6 flex justify-end">
            <ThemeToggle />
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
