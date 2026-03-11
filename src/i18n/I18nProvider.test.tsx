import { render, screen } from '@testing-library/react'
import { I18nProvider } from './I18nProvider'
import { useI18n } from './useI18n'

function Probe() {
  const { t } = useI18n()
  return (
    <div>
      <span>{t('Light mode')}</span>
      <span>{t('Unknown message key')}</span>
    </div>
  )
}

describe('I18nProvider', () => {
  it('selects locale from the browser and falls back to the key when missing', () => {
    Object.defineProperty(window.navigator, 'language', {
      configurable: true,
      value: 'ru-RU',
    })

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )

    expect(screen.getByText('Светлая тема')).toBeInTheDocument()
    expect(screen.getByText('Unknown message key')).toBeInTheDocument()
  })
})
