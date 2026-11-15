import { getTranslations } from 'next-intl/server'
import { SettingsView } from '@/components/settings/settings-view'
import { type LocalePageProps, pageMetadata, resolvePageLocale } from './page-route.ts'

export const generateSettingsMetadata = pageMetadata('settings')

/** Configurações (app shell): o título sai no HTML estático; as seções dependem da sessão. */
export async function SettingsPage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'pages.settings' })

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-10 sm:py-14">
      <div className="flex flex-col gap-2">
        <h1 className="font-semibold font-serif text-3xl tracking-tight">{t('title')}</h1>
        <p className="text-pretty text-muted-foreground">{t('description')}</p>
      </div>
      <SettingsView />
    </div>
  )
}
