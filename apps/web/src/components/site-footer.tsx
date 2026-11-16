import type { Locale } from '@teko/shared/i18n'
import { ShieldCheckIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { GitHubIcon } from '@/components/brand/github-icon'
import { TekoWordmark } from '@/components/brand/teko-logo'
import { ConsentPreferencesButton } from '@/components/consent/consent-provider'
import { localePagePath } from '@/lib/navigation'
import { ISSUES_URL, LICENSE_URL, REPOSITORY_URL } from '@/lib/site'

interface SiteFooterProps {
  readonly locale: Locale
}

/** Classe dos links do rodapé: alvo de 24 px (WCAG 2.5.8) e sublinhado só no hover. */
const LINK =
  'inline-flex min-h-6 items-center gap-2 rounded-sm text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline'

function Column({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-semibold text-foreground text-sm">{title}</h2>
      <ul className="flex flex-col gap-2 text-sm">{children}</ul>
    </div>
  )
}

/**
 * Rodapé público: a marca com o aviso fixo de que o Tekó não substitui parecer profissional, as
 * colunas de produto, projeto (código-fonte, problemas, licença) e legal (privacidade, termos e
 * preferências de cookies). O fio de cima repete a linha do tempo da logo.
 */
export async function SiteFooter({ locale }: SiteFooterProps) {
  const t = await getTranslations({ locale, namespace: 'common' })
  const tPages = await getTranslations({ locale, namespace: 'pages' })
  const tApp = await getTranslations({ locale, namespace: 'app' })

  return (
    <footer className="mt-auto bg-surface">
      <div aria-hidden="true" className="timeline-rule h-px" />
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-x-6 gap-y-10 px-5 py-12 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="col-span-2 flex flex-col gap-4 md:col-span-1">
          <TekoWordmark />
          <p className="max-w-xs text-pretty text-muted-foreground text-sm leading-relaxed">
            {tApp('tagline')}
          </p>
          <p className="flex max-w-xs items-start gap-2 rounded-lg border bg-popover px-3 py-2.5 font-medium text-foreground text-sm shadow-soft">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-leaf" />
            {t('disclaimer')}
          </p>
        </div>
        <Column title={t('footer.product')}>
          <li>
            <a href={localePagePath(locale, 'chat')} className={LINK}>
              {t('openApp')}
            </a>
          </li>
          {(['coverage', 'about'] as const).map((page) => (
            <li key={page}>
              <a href={localePagePath(locale, page)} className={LINK}>
                {tPages(`${page}.title`)}
              </a>
            </li>
          ))}
        </Column>
        <Column title={t('footer.project')}>
          <li>
            <a href={REPOSITORY_URL} rel="noopener noreferrer" className={LINK}>
              <GitHubIcon className="size-3.5" />
              {t('sourceCode')}
            </a>
          </li>
          <li>
            <a href={ISSUES_URL} rel="noopener noreferrer" className={LINK}>
              {t('footer.issues')}
            </a>
          </li>
          <li>
            <a href={LICENSE_URL} rel="noopener noreferrer" className={LINK}>
              {t('footer.licenseLink')}
            </a>
          </li>
        </Column>
        <Column title={t('footer.legal')}>
          {(['privacy', 'terms'] as const).map((page) => (
            <li key={page}>
              <a href={localePagePath(locale, page)} className={LINK}>
                {tPages(`${page}.title`)}
              </a>
            </li>
          ))}
          <li>
            <ConsentPreferencesButton className={`${LINK} cursor-pointer text-left`} />
          </li>
        </Column>
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-5 py-5 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>{t('license')}</p>
          <p className="flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-leaf" />
            {t('footer.madeWith')}
          </p>
        </div>
      </div>
    </footer>
  )
}
