import type { Locale } from '@teko/shared/i18n'
import { getTranslations } from 'next-intl/server'
import { REPOSITORY_URL } from '@/lib/site'

interface SiteFooterProps {
  readonly locale: Locale
}

/** Rodapé público com o aviso fixo de que o Tekó não substitui parecer profissional. */
export async function SiteFooter({ locale }: SiteFooterProps) {
  const t = await getTranslations({ locale, namespace: 'common' })

  return (
    <footer className="border-border border-t">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-5 py-8 text-muted-foreground text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="font-medium text-foreground">{t('disclaimer')}</p>
        <p>
          {t('license')}{' '}
          <a
            href={REPOSITORY_URL}
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            {t('sourceCode')}
          </a>
        </p>
      </div>
    </footer>
  )
}
