import type { NavItem } from './components/ui'
import { InlineIcon } from './components/ui'

export function buildPrimaryNav(t: (key: string, vars?: Record<string, string | number>) => string): NavItem[] {
  return [
    {
      to: '/',
      label: t('Overview'),
      icon: <InlineIcon name="overview" className="h-4 w-4" />,
    },
    {
      to: '/codex',
      label: t('CodeX'),
      icon: <InlineIcon name="codex" className="h-4 w-4" />,
    },
  ]
}
