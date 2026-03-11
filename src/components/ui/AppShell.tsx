import type { ReactNode } from 'react'
import styles from './ui.module.scss'
import { ParticleCanvas } from './ParticleCanvas'
import { TopNav, type NavItem } from './TopNav'
import { ThemeToggle } from './ThemeToggle'

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
  return (
    <div className={styles.shell}>
      <div className={styles.background}>
        <ParticleCanvas density={1} interactive={!subduedParticles} subdued={subduedParticles} />
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
