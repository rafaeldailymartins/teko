import { getTranslations } from 'next-intl/server'
import { LazySettingsView } from '@/components/settings/lazy-settings-view'
import { type LocalePageProps, pageMetadata, resolvePageLocale } from './page-route.ts'

export const generateSettingsMetadata = pageMetadata('settings')

/**
 * Configurações (app shell): o título sai no HTML estático, sobre o fio da linha do tempo; as
 * seções, com a navegação lateral, dependem da sessão e vêm de um chunk sob demanda.
 */
export async function SettingsPage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'pages.settings' })

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 py-10 sm:py-14">
      <div className="flex flex-col gap-3">
        <h1 className="font-semibold font-serif text-3xl tracking-tight sm:text-4xl">
          {t('title')}
        </h1>
        <p className="max-w-2xl text-pretty text-muted-foreground leading-relaxed">
          {t('description')}
        </p>
        <div aria-hidden="true" className="timeline-rule relative mt-2 h-px">
          <span className="absolute top-1/2 left-0 size-1.5 -translate-y-1/2 rounded-full bg-leaf" />
        </div>
      </div>
      <LazySettingsView />
    </div>
  )
}
