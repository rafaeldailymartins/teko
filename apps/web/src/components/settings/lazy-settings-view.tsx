'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'

function SettingsLoading() {
  const t = useTranslations('settings')
  return (
    <p className="text-muted-foreground" aria-live="polite">
      {t('loading')}
    </p>
  )
}

/**
 * As seções das configurações (conta, cota, passkeys, dados e preferências) ficam num chunk
 * carregado por `import()`, fora do JS de primeiro acesso que o orçamento de bundle soma.
 */
export const LazySettingsView = dynamic(
  () => import('./settings-view.tsx').then((module) => module.SettingsView),
  { ssr: false, loading: SettingsLoading },
)
