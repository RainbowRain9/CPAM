import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'
import styles from './ui.module.scss'
import { ThemeToggle } from './ThemeToggle'
import { InlineIcon } from './InlineIcon'
import { useI18n } from '../../i18n/useI18n'

export type NavItem = {
  to: string
  label: string
  icon?: ReactNode
}

export function TopNav({
  items,
  actions,
}: {
  items: NavItem[]
  actions?: ReactNode
}) {
  const { t } = useI18n()

  return (
    <header className={styles.topNav}>
      <div className={styles.brand}>
        <div className={styles.brandMark}>
          <InlineIcon name="spark" className="h-4 w-4" />
        </div>
        <div>
          <p className={styles.brandTitle}>{t('API Center')}</p>
          <p className={styles.brandSubtitle}>{t('Welcome to API Center')}</p>
        </div>
      </div>

      <nav className={styles.navLinks}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`.trim()}
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className={styles.navActions}>
        {actions}
        <ThemeToggle />
      </div>
    </header>
  )
}
