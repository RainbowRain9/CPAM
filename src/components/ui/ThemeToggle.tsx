import { ActionButton } from './ActionButton'
import { InlineIcon } from './InlineIcon'
import { useTheme } from '../../theme/useTheme'
import { useI18n } from '../../i18n/useI18n'

export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme()
  const { t } = useI18n()

  return (
    <ActionButton
      variant="ghost"
      size="sm"
      onClick={toggleTheme}
      icon={<InlineIcon name={resolvedTheme === 'dark' ? 'sun' : 'moon'} />}
      aria-label={t('Switch theme')}
      title={resolvedTheme === 'dark' ? t('Light mode') : t('Dark mode')}
      className="min-w-[2.75rem]"
    />
  )
}
