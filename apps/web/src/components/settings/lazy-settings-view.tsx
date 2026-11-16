'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { Skeleton } from '@/components/ui/skeleton'

/** Esqueleto da página inteira (navegação e cartões) enquanto o chunk das seções chega. */
function SettingsLoading() {
  const t = useTranslations('settings')
  return (
    <div
      className="flex flex-col gap-6 lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-10"
      role="status"
      aria-label={t('loading')}
    >
      <div className="flex gap-1.5 lg:flex-col">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-9 w-28 rounded-lg lg:w-full" />
        ))}
      </div>
      <div className="flex flex-col gap-5">
        {[0, 1].map((card) => (
          <div
            key={card}
            className="flex flex-col gap-4 rounded-xl border bg-popover p-5 shadow-soft"
          >
            <div className="flex items-center gap-3.5">
              <Skeleton className="size-9 rounded-lg" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            </div>
            <Skeleton className="h-16 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * As seções das configurações (conta, cota, passkeys, preferências, dados e zona de perigo) ficam
 * num chunk carregado por `import()`, fora do JS de primeiro acesso que o orçamento de bundle soma.
 */
export const LazySettingsView = dynamic(
  () => import('./settings-view.tsx').then((module) => module.SettingsView),
  { ssr: false, loading: SettingsLoading },
)
