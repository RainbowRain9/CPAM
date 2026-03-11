import type { ReactNode } from 'react'
import styles from './ui.module.scss'

export function SectionFrame({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`${styles.sectionFrame} ${className}`.trim()}>
      {(title || description || actions) ? (
        <div className={styles.sectionHeader}>
          <div>
            {title ? <h2 className={styles.sectionTitle}>{title}</h2> : null}
            {description ? <p className={styles.sectionDescription}>{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  )
}
