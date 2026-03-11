import type { NavItem } from './components/ui'
import { InlineIcon } from './components/ui'

export function buildPrimaryNav(t: (key: string, vars?: Record<string, string | number>) => string, openCodeEnabled = false): NavItem[] {
  const items: NavItem[] = [
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

  if (openCodeEnabled) {
    items.push({
      to: '/opencode',
      label: t('OpenCode'),
      icon: <InlineIcon name="opencode" className="h-4 w-4" />,
    })
  }

  return items
}
