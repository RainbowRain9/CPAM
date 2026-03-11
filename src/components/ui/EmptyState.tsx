import type { ReactNode } from 'react'
import styles from './ui.module.scss'

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
}) {
  return (
    <div className={styles.emptyState}>
      {icon}
      <p className={styles.emptyStateTitle}>{title}</p>
      {description ? <p>{description}</p> : null}
    </div>
  )
}
