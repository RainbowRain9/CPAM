import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import styles from './ui.module.scss'

type Tone = 'default' | 'strong' | 'subtle'

export function GlassPanel<T extends ElementType = 'div'>({
  as,
  tone = 'default',
  className = '',
  children,
  ...props
}: {
  as?: T
  tone?: Tone
  className?: string
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>) {
  const Component = as || 'div'
  const toneClass = {
    default: styles.panelDefault,
    strong: styles.panelStrong,
    subtle: styles.panelSubtle,
  }[tone]

  return (
    <Component className={`${styles.glassPanel} ${toneClass} ${className}`.trim()} {...props}>
      {children}
    </Component>
  )
}
