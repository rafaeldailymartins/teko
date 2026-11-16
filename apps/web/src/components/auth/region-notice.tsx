import { ArrowLeftIcon, GlobeLockIcon, SettingsIcon } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { localeHomePath } from '@/lib/i18n/routing'
import { localePagePath } from '@/lib/navigation'

/**
 * Aviso de `region_restricted`: a API recusou a pergunta pela política regional (EEE, Reino Unido
 * e Suíça só usam o provedor que não guarda as perguntas, e ele está indisponível agora). O
 * medalhão repete a linha do tempo da logo, com o ponto âmbar parado: a resposta espera.
 */
export function RegionNotice() {
  const t = useTranslations('auth.region')
  const locale = useLocale()
  return (
    <section aria-labelledby="region-notice-title" className="flex flex-col items-start gap-6">
      <div aria-hidden="true" className="flex items-center gap-3">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-gradient text-brand-foreground shadow-raised [&_svg]:size-6">
          <GlobeLockIcon />
        </span>
        <span className="timeline-rule relative h-px w-24">
          <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-date-mark shadow-[0_0_0_3px_var(--background)]" />
        </span>
      </div>
      <div className="flex flex-col gap-3">
        <p className="font-medium font-mono text-muted-foreground text-xs uppercase tracking-[0.14em]">
          {t('eyebrow')}
        </p>
        <h1
          id="region-notice-title"
          className="text-balance font-semibold font-serif text-[2rem] leading-tight tracking-tight sm:text-4xl"
        >
          {t('title')}
        </h1>
        <p className="max-w-prose text-pretty text-muted-foreground leading-relaxed">{t('body')}</p>
        <p className="max-w-prose text-pretty text-muted-foreground leading-relaxed">{t('hint')}</p>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <Link href={localeHomePath(locale)} className={buttonVariants({ variant: 'brand' })}>
          <ArrowLeftIcon aria-hidden="true" />
          {t('back')}
        </Link>
        <Link
          href={localePagePath(locale, 'settings')}
          className={buttonVariants({ variant: 'outline' })}
        >
          <SettingsIcon aria-hidden="true" />
          {t('settings')}
        </Link>
      </div>
    </section>
  )
}
