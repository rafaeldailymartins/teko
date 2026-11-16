import type { Locale } from '@teko/shared/i18n'
import { CalendarClockIcon, QuoteIcon, ScaleIcon } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'
import { TekoLogo, TekoWordmark } from '@/components/brand/teko-logo'
import { localeHomePath } from '@/lib/i18n/routing'

/** Datas do exemplo: as redações do dispositivo e a data de referência, que cai na de 2006. */
const VERSIONS = [2004, 2006, 2010] as const
const VERSION_POSITIONS = [8, 46, 92] as const
/** A redação de 2006, vigente na data de referência. */
const CURRENT_VERSION = 1
const REFERENCE = Date.UTC(2008, 4, 1)
const REFERENCE_POSITION = 69

/**
 * Painel da marca da entrada (desktop): o gradiente petróleo da logo com o selo ao fundo, a frase
 * do produto e um exemplo em miniatura do que ele faz, a linha do tempo de um dispositivo com o
 * ponto âmbar na data de referência e a redação vigente nela em verde-folha. Estático, sem
 * chamada à API.
 */
export async function SignInBrandPanel({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'auth.brand' })
  const format = await getFormatter({ locale })
  const reference = format.dateTime(REFERENCE, {
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const points = [
    { key: 'dated', Icon: CalendarClockIcon },
    { key: 'cited', Icon: QuoteIcon },
    { key: 'open', Icon: ScaleIcon },
  ] as const

  return (
    <aside
      aria-label={t('label')}
      className="relative isolate hidden overflow-hidden bg-brand-gradient text-brand-foreground lg:flex lg:flex-col"
    >
      {/* Brilho e o selo da logo ao fundo, só decoração. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(40rem_28rem_at_85%_10%,color-mix(in_oklch,var(--leaf)_28%,transparent),transparent_70%),radial-gradient(30rem_24rem_at_0%_100%,color-mix(in_oklch,var(--date-mark)_12%,transparent),transparent_70%)]"
      />
      <TekoLogo
        variant="seal"
        className="absolute -right-24 -bottom-24 -z-10 size-[30rem] rotate-[-8deg] opacity-[0.14] mix-blend-luminosity"
      />

      <div className="flex h-16 items-center px-10">
        <a
          href={localeHomePath(locale)}
          aria-label={t('home')}
          className="-ml-1 rounded-lg px-1 py-1 outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-brand-foreground"
        >
          <TekoWordmark logoClassName="ring-1 ring-white/20 rounded-[0.45rem]" />
        </a>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-10 px-10 py-12 xl:px-16">
        <div className="flex max-w-md flex-col gap-4">
          <p className="text-balance font-semibold font-serif text-4xl leading-[1.1] tracking-tight xl:text-5xl">
            {t('tagline')}
          </p>
          <p className="text-pretty text-brand-foreground/85 leading-relaxed">{t('body')}</p>
        </div>

        <figure className="flex max-w-md flex-col gap-5 rounded-2xl border border-white/15 bg-white/[0.07] p-5 shadow-overlay backdrop-blur-sm">
          <figcaption className="flex items-center justify-between gap-3 text-xs">
            <span className="rounded-full border border-white/20 px-2 py-0.5 font-medium text-brand-foreground/85 uppercase tracking-[0.12em]">
              {t('example')}
            </span>
            <span className="font-mono text-brand-foreground/85">{t('provision')}</span>
          </figcaption>

          {/* A linha do tempo: o trecho vigente na data em verde-folha, a data em âmbar. */}
          <div aria-hidden="true" className="relative h-20">
            <span className="absolute inset-x-0 top-10 h-px bg-linear-to-r from-white/5 via-white/40 to-white/5" />
            <span
              className="absolute top-10 h-0.5 -translate-y-1/4 rounded-full bg-leaf-gradient"
              style={{ left: `${VERSION_POSITIONS[1]}%`, right: `${100 - VERSION_POSITIONS[2]}%` }}
            />
            {VERSIONS.map((year, index) => (
              <span
                key={year}
                className="absolute top-10 flex -translate-x-1/2 flex-col items-center gap-2"
                style={{ left: `${VERSION_POSITIONS[index]}%` }}
              >
                <span
                  className={
                    index === CURRENT_VERSION
                      ? '-mt-1.5 size-3 rounded-full bg-leaf ring-4 ring-leaf/25'
                      : '-mt-[0.3125rem] size-2.5 rounded-full border border-white/60 bg-brand-deep'
                  }
                />
                <span className="font-mono text-brand-foreground/80 text-xs tabular-nums">
                  {year}
                </span>
              </span>
            ))}
            <span
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${REFERENCE_POSITION}%` }}
            >
              <span className="whitespace-nowrap rounded-md bg-date-mark px-1.5 py-0.5 font-medium font-mono text-[0.6875rem] text-brand-deep tabular-nums leading-tight">
                {reference}
              </span>
              <span className="h-[1.1rem] w-px bg-date-mark" />
              <span className="-mt-px size-2.5 rounded-full border-2 border-brand-deep bg-date-mark" />
            </span>
          </div>
          <p className="sr-only">
            {t('reference')}: {reference}
          </p>

          <p className="flex items-center gap-2 text-sm">
            <span className="size-2 rounded-full bg-leaf" aria-hidden="true" />
            <span className="font-medium">{t('current')}</span>
            <span className="font-mono text-brand-foreground/80 tabular-nums">2006 → 2010</span>
          </p>
        </figure>
      </div>

      <ul className="flex flex-wrap gap-x-6 gap-y-2 px-10 pb-10 text-brand-foreground/85 text-sm xl:px-16">
        {points.map(({ key, Icon }) => (
          <li key={key} className="flex items-center gap-2">
            <Icon aria-hidden="true" className="size-4 text-leaf" />
            {t(`points.${key}`)}
          </li>
        ))}
      </ul>
    </aside>
  )
}
