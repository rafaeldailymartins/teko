import { GlobeLockIcon } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { localeHomePath } from '@/lib/i18n/routing'

/**
 * Aviso de `region_restricted`: a API recusou a pergunta pela política regional (EEE, Reino Unido
 * e Suíça só usam o provedor que não guarda as perguntas, e ele está indisponível agora).
 */
export function RegionNotice() {
  const t = useTranslations('auth.region')
  const locale = useLocale()
  return (
    <section aria-labelledby="region-notice-title" className="flex flex-col items-start gap-4">
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-muted text-primary [&_svg]:size-6"
      >
        <GlobeLockIcon />
      </span>
      <h1 id="region-notice-title" className="font-semibold font-serif text-3xl tracking-tight">
        {t('title')}
      </h1>
      <p className="max-w-prose text-pretty text-muted-foreground leading-relaxed">{t('body')}</p>
      <p className="max-w-prose text-pretty text-muted-foreground leading-relaxed">{t('hint')}</p>
      <Link href={localeHomePath(locale)} className={buttonVariants({ variant: 'outline' })}>
        {t('back')}
      </Link>
    </section>
  )
}
