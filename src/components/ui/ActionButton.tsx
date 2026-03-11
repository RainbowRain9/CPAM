import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './ui.module.scss'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export function ActionButton({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  loading?: boolean
}) {
  const variantClass = {
    primary: styles.buttonPrimary,
    secondary: styles.buttonSecondary,
    ghost: styles.buttonGhost,
    danger: styles.buttonDanger,
  }[variant]

  const sizeClass = {
    sm: styles.buttonSm,
    md: styles.buttonMd,
    lg: styles.buttonLg,
  }[size]

  return (
    <button className={`${styles.button} ${variantClass} ${sizeClass} ${className}`.trim()} {...props}>
      {loading ? <span className={styles.spinner} /> : icon}
      <span>{children}</span>
    </button>
  )
}
