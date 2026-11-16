import { ProvisionView } from '@/components/provision/provision-view'
import { type LocalePageProps, pageMetadata, resolvePageLocale } from './page-route.ts'

export const generateProvisionMetadata = pageMetadata('provision')

/** Página de dispositivo; o conteúdo depende da query (`k`, `ref`) e sai todo no cliente. */
export async function ProvisionPage({ params }: LocalePageProps) {
  await resolvePageLocale(params)
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:py-12">
      <ProvisionView />
    </div>
  )
}
