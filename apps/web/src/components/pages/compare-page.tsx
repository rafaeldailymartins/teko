import { CompareView } from '@/components/compare/compare-view'
import { type LocalePageProps, pageMetadata, resolvePageLocale } from './page-route.ts'

export const generateCompareMetadata = pageMetadata('compare')

/** Comparação entre datas; o conteúdo depende da query (`k`, `from`, `to`) e sai no cliente. */
export async function ComparePage({ params }: LocalePageProps) {
  await resolvePageLocale(params)
  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-10 sm:py-14">
      <CompareView />
    </div>
  )
}
