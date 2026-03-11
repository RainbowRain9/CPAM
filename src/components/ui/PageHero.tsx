import type { ReactNode } from 'react'
import styles from './ui.module.scss'
import { GlassPanel } from './GlassPanel'

export function PageHero({
  eyebrow,
  title,
  subtitle,
  actions,
  meta,
  className = '',
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  className?: string
}) {
  return (
    <GlassPanel tone="strong" className={className}>
      <div className={styles.hero}>
        {eyebrow ? <p className={styles.heroEyebrow}>{eyebrow}</p> : null}
        <h1 className={styles.heroTitle}>{title}</h1>
        {subtitle ? <p className={styles.heroSubtitle}>{subtitle}</p> : null}
        {actions ? <div className={styles.heroActions}>{actions}</div> : null}
        {meta ? <div className={styles.heroMeta}>{meta}</div> : null}
      </div>
    </GlassPanel>
  )
}
