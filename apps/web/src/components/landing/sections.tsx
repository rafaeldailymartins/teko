import type { Locale } from '@teko/shared/i18n'
import {
  ArrowRightIcon,
  BookOpenCheckIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  CircleSlashIcon,
  CodeIcon,
  FileCodeIcon,
  FileSpreadsheetIcon,
  LandmarkIcon,
  type LucideIcon,
  QuoteIcon,
  ScaleIcon,
  ScrollTextIcon,
  ShieldAlertIcon,
  TableIcon,
  UserCheckIcon,
} from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { GitHubIcon } from '@/components/brand/github-icon'
import { TekoLogo } from '@/components/brand/teko-logo'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  CORPUS_AXIS_YEARS,
  LANDING_CORPUS,
  type LandingFamily,
  yearPosition,
} from '@/lib/landing/corpus'
import { localePagePath } from '@/lib/navigation'
import { ISSUES_URL, REPOSITORY_URL } from '@/lib/site'
import { cn } from '@/lib/utils'

interface SectionProps {
  readonly locale: Locale
}

/** Contêiner do site, o mesmo do cabeçalho e do rodapé. */
const CONTAINER = 'mx-auto max-w-5xl px-5'

interface SectionHeadingProps {
  readonly id: string
  readonly eyebrow: string
  readonly title: string
  readonly lead?: ReactNode
  readonly className?: string
}

/** Cabeçalho de seção: sobretítulo em mono com o fio verde-folha, título em serif e o lead. */
function SectionHeading({ id, eyebrow, title, lead, className }: SectionHeadingProps) {
  return (
    <div className={cn('flex max-w-2xl flex-col gap-4', className)}>
      <p className="flex items-center gap-3 font-medium font-mono text-primary text-xs uppercase tracking-[0.16em]">
        <span aria-hidden="true" className="h-px w-8 bg-leaf" />
        {eyebrow}
      </p>
      <h2
        id={id}
        className="text-balance font-semibold font-serif text-[2rem] leading-tight tracking-tight sm:text-[2.6rem]"
      >
        {title}
      </h2>
      {lead === undefined ? null : (
        <p className="text-pretty text-lg text-muted-foreground leading-relaxed">{lead}</p>
      )}
    </div>
  )
}

const STEPS = ['referenceDate', 'citations', 'coverage'] as const

/**
 * "Como funciona" como uma linha do tempo de três marcos (horizontal no desktop, vertical no
 * celular), cada um com uma amostra do que aparece no chat: o chip da data, a citação e a recusa.
 */
export async function HowItWorks({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'landing.howItWorks' })
  const markers: Record<(typeof STEPS)[number], { icon: LucideIcon; className: string }> = {
    referenceDate: {
      icon: CalendarClockIcon,
      className: 'border-accent-border bg-accent text-accent-foreground',
    },
    citations: { icon: QuoteIcon, className: 'border-primary/60 bg-popover text-primary' },
    coverage: { icon: ScaleIcon, className: 'border-leaf bg-leaf-soft text-validity-current' },
  }
  const samples: Record<(typeof STEPS)[number], ReactNode> = {
    referenceDate: (
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-accent-border bg-accent px-2.5 font-medium font-mono text-accent-foreground text-xs tabular-nums shadow-soft">
        <CalendarClockIcon aria-hidden="true" className="size-3.5" />
        {t('referenceDate.sample')}
      </span>
    ),
    citations: (
      <span className="inline-flex items-center gap-2 rounded-full border bg-popover py-1 pr-3 pl-1 text-xs shadow-soft">
        <span className="inline-flex size-[22px] items-center justify-center rounded-full bg-primary font-mono text-primary-foreground">
          1
        </span>
        <span className="font-medium">{t('citations.sample')}</span>
      </span>
    ),
    coverage: (
      <span className="inline-flex items-center gap-2 rounded-lg border border-border-strong/50 border-dashed bg-popover px-3 py-1.5 text-muted-foreground text-xs">
        <CircleSlashIcon aria-hidden="true" className="size-3.5 text-coverage-out" />
        {t('coverage.sample')}
      </span>
    ),
  }

  return (
    <section aria-labelledby="how-it-works-title" className="border-y bg-surface-gradient">
      <div className={cn(CONTAINER, 'py-20 sm:py-24')}>
        <SectionHeading
          id="how-it-works-title"
          eyebrow={t('eyebrow')}
          title={t('title')}
          lead={t('lead')}
        />
        <ol className="relative mt-14 grid gap-12 md:mt-16 md:grid-cols-3 md:gap-10">
          <span
            aria-hidden="true"
            className="absolute top-6 right-0 left-0 hidden h-px timeline-rule md:block"
          />
          <span
            aria-hidden="true"
            className="absolute top-2 bottom-2 left-6 w-px bg-linear-to-b from-leaf/60 via-border to-transparent md:hidden"
          />
          {STEPS.map((step, index) => {
            const { icon: Icon, className } = markers[step]
            return (
              <li key={step} className="relative flex gap-5 md:flex-col md:gap-6">
                <span
                  aria-hidden="true"
                  className={cn(
                    'relative z-10 flex size-12 shrink-0 items-center justify-center rounded-full border-2 shadow-raised ring-6 ring-surface [&_svg]:size-5',
                    className,
                  )}
                >
                  <Icon />
                </span>
                <div className="flex flex-col gap-3">
                  <p className="font-mono text-muted-foreground text-xs tabular-nums">
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <h3 className="font-semibold font-serif text-xl tracking-tight">
                    {t(`${step}.title`)}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">{t(`${step}.body`)}</p>
                  <div aria-hidden="true" className="pt-1">
                    {samples[step]}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}

const FAMILY_ICONS: Record<LandingFamily, LucideIcon> = {
  efdIcmsIpi: FileSpreadsheetIcon,
  efdReinf: FileCodeIcon,
  rcte: LandmarkIcon,
  cte: ScrollTextIcon,
  efdGo: TableIcon,
}

/**
 * Corpus coberto: as famílias com ícone, jurisdição e descrição numa régua de 1990 a hoje, com a
 * barra de cada fonte desde o começo aproximado no corpus. Os períodos exatos ficam na página de
 * cobertura (a landing não chama a API).
 */
export async function Corpus({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'landing.corpus' })
  return (
    <section aria-labelledby="corpus-title" className={cn(CONTAINER, 'py-20 sm:py-24')}>
      <div className="grid gap-12 lg:grid-cols-[0.82fr_1.5fr] lg:gap-14">
        <div className="flex flex-col gap-8">
          <SectionHeading
            id="corpus-title"
            eyebrow={t('eyebrow')}
            title={t('title')}
            lead={t('lead')}
          />
          <a
            href={localePagePath(locale, 'coverage')}
            className="group inline-flex min-h-6 w-fit items-center gap-2 rounded-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('seeCoverage')}
            <ArrowRightIcon
              aria-hidden="true"
              className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </a>
        </div>
        <Card tone="raised" className="p-5 sm:p-7">
          <div
            aria-hidden="true"
            className="relative mb-2 ml-0 h-5 sm:ml-[13.5rem]"
            data-testid="corpus-axis"
          >
            {CORPUS_AXIS_YEARS.map((year) => (
              <span
                key={year}
                className="absolute top-0 -translate-x-1/2 font-mono text-[0.6875rem] text-muted-foreground tabular-nums first:translate-x-0"
                style={{ left: `${yearPosition(year)}%` }}
              >
                {year}
              </span>
            ))}
            <span className="absolute top-0 right-0 font-mono text-[0.6875rem] text-muted-foreground">
              {t('today')}
            </span>
          </div>
          <ul className="flex flex-col divide-y divide-border/70">
            {LANDING_CORPUS.map(({ key, jurisdiction, since }) => {
              const Icon = FAMILY_ICONS[key]
              const start = yearPosition(since)
              return (
                <li
                  key={key}
                  data-family={key}
                  className="grid gap-x-6 gap-y-3 py-4 sm:grid-cols-[12.5rem_1fr] sm:items-center"
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-brand-foreground shadow-soft [&_svg]:size-4"
                    >
                      <Icon />
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="font-semibold leading-tight">{t(`${key}.name`)}</p>
                      <p className="text-muted-foreground text-xs">
                        {t(`jurisdiction.${jurisdiction}`)} · {t('since', { year: since })}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div aria-hidden="true" className="relative h-2.5 rounded-full bg-muted">
                      {CORPUS_AXIS_YEARS.map((year) => (
                        <span
                          key={year}
                          className="absolute inset-y-0 w-px bg-background/80"
                          style={{ left: `${yearPosition(year)}%` }}
                        />
                      ))}
                      <span
                        className="absolute inset-y-0 right-0 rounded-full bg-leaf-gradient shadow-[0_0_0_1px_color-mix(in_oklch,var(--leaf)_40%,transparent)]"
                        style={{ left: `${start}%` }}
                      />
                      <span
                        className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-popover bg-leaf"
                        style={{ left: `${start}%` }}
                      />
                    </div>
                    <p className="text-muted-foreground text-sm leading-snug">{t(`${key}.body`)}</p>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="mt-4 border-t pt-4 text-muted-foreground text-xs leading-relaxed">
            {t('rulerCaption')}
          </p>
        </Card>
      </div>
    </section>
  )
}

const SECONDARY_GUARANTEES: readonly (readonly [
  'refusal' | 'advice' | 'openSource',
  LucideIcon,
])[] = [
  ['refusal', ShieldAlertIcon],
  ['advice', UserCheckIcon],
  ['openSource', CodeIcon],
]

/**
 * Garantias em composição assimétrica: "Nada sem fonte" em destaque, num painel da marca, e as
 * outras três numa coluna com divisórias.
 */
export async function Guarantees({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'landing.guarantees' })
  return (
    <section aria-labelledby="guarantees-title" className="border-y bg-surface">
      <div className={cn(CONTAINER, 'py-20 sm:py-24')}>
        <SectionHeading
          id="guarantees-title"
          eyebrow={t('eyebrow')}
          title={t('title')}
          lead={t('lead')}
        />
        <div className="mt-12 grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
          <div className="relative isolate flex flex-col justify-between gap-10 overflow-hidden rounded-2xl bg-brand-gradient p-7 text-brand-foreground shadow-overlay sm:p-9">
            <span
              aria-hidden="true"
              className="absolute -top-24 -right-24 -z-10 size-72 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--leaf)_30%,transparent),transparent)]"
            />
            <span
              aria-hidden="true"
              className="flex size-12 items-center justify-center rounded-xl bg-brand-foreground/10 ring-1 ring-brand-foreground/20 [&_svg]:size-6"
            >
              <BookOpenCheckIcon />
            </span>
            <div className="flex flex-col gap-4">
              <h3 className="font-semibold font-serif text-3xl tracking-tight sm:text-[2.25rem]">
                {t('sources.title')}
              </h3>
              <p className="max-w-md text-brand-foreground/90 text-lg leading-relaxed">
                {t('sources.body')}
              </p>
            </div>
            <div aria-hidden="true" className="relative h-px bg-brand-foreground/25">
              <span className="absolute top-1/2 left-[18%] size-2 -translate-y-1/2 rounded-full bg-brand-foreground/70" />
              <span className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand-foreground bg-date-mark" />
              <span className="absolute top-1/2 left-[82%] size-2 -translate-y-1/2 rounded-full bg-brand-foreground/70" />
            </div>
          </div>
          <ul className="flex flex-col divide-y rounded-2xl border bg-popover px-6 shadow-soft sm:px-7">
            {SECONDARY_GUARANTEES.map(([guarantee, Icon]) => (
              <li key={guarantee} className="flex gap-4 py-6">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-leaf-soft text-validity-current ring-1 ring-leaf/40 [&_svg]:size-5"
                >
                  <Icon />
                </span>
                <div className="flex flex-col gap-1.5">
                  <h3 className="font-semibold font-serif text-lg tracking-tight">
                    {t(`${guarantee}.title`)}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">{t(`${guarantee}.body`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

const FAQ = ['advice', 'referenceDate', 'cost', 'data'] as const

/** FAQ em acordeão de `<details>` (funciona sem JavaScript), um aberto por vez. */
export async function Faq({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'landing.faq' })
  return (
    <section aria-labelledby="faq-title" className={cn(CONTAINER, 'py-20 sm:py-24')}>
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        <div className="flex flex-col gap-6">
          <SectionHeading
            id="faq-title"
            eyebrow={t('eyebrow')}
            title={t('title')}
            lead={t('lead')}
          />
          <p className="text-muted-foreground text-sm">
            {t.rich('more', {
              issues: (chunks) => (
                <a
                  href={ISSUES_URL}
                  rel="noopener noreferrer"
                  className="inline-flex min-h-6 items-center gap-1.5 font-medium text-primary underline underline-offset-4 hover:text-foreground"
                >
                  <GitHubIcon className="size-3.5" />
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {FAQ.map((item) => (
            <details
              key={item}
              name="landing-faq"
              className="group rounded-xl border bg-popover shadow-soft transition-shadow duration-200 open:border-border-strong/40 open:shadow-raised"
            >
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-3 font-medium transition-colors duration-150 hover:text-primary [&::-webkit-details-marker]:hidden">
                {t(`${item}.question`)}
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform duration-200 ease-out-soft group-open:rotate-180 group-open:bg-primary group-open:text-primary-foreground"
                >
                  <ChevronDownIcon className="size-4" />
                </span>
              </summary>
              <p className="mx-5 mb-5 border-leaf/60 border-l-2 pl-4 text-muted-foreground leading-relaxed">
                {t(`${item}.answer`)}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Faixa final de chamada, no gradiente petróleo da logo, com o selo ao fundo. */
export async function FinalCta({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'landing' })
  return (
    <section aria-labelledby="final-cta-title" className={cn(CONTAINER, 'pb-20 sm:pb-24')}>
      <div className="relative isolate overflow-hidden rounded-3xl bg-brand-gradient px-7 py-14 text-brand-foreground shadow-overlay sm:px-14 sm:py-16">
        <span
          aria-hidden="true"
          className="absolute -bottom-40 -left-24 -z-10 size-96 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--leaf)_28%,transparent),transparent)]"
        />
        <TekoLogo
          variant="seal"
          className="absolute -right-10 -bottom-12 -z-10 size-64 rotate-[-8deg] rounded-[3.5rem] opacity-25 sm:size-80"
        />
        <div aria-hidden="true" className="mb-8 flex w-40 items-center">
          <span className="h-px flex-1 bg-brand-foreground/35" />
          <span className="size-3 rounded-full border-2 border-brand-foreground bg-date-mark" />
          <span className="h-px flex-1 bg-brand-foreground/35" />
        </div>
        <h2
          id="final-cta-title"
          className="max-w-xl text-balance font-semibold font-serif text-[2.2rem] leading-tight tracking-tight sm:text-5xl"
        >
          {t('finalCta.title')}
        </h2>
        <p className="mt-5 max-w-lg text-brand-foreground/90 text-lg leading-relaxed">
          {t('finalCta.body')}
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <a
            href={localePagePath(locale, 'chat')}
            className={cn(
              buttonVariants({ size: 'lg' }),
              'bg-brand-foreground px-6 text-brand-deep shadow-raised hover:bg-brand-foreground/90 focus-visible:ring-brand-foreground focus-visible:ring-offset-brand-deep',
            )}
          >
            {t('cta.open')}
            <ArrowRightIcon aria-hidden="true" />
          </a>
          <a
            href={REPOSITORY_URL}
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ size: 'lg', variant: 'ghost' }),
              'border border-brand-foreground/40 text-brand-foreground hover:bg-brand-foreground/10 hover:text-brand-foreground focus-visible:ring-brand-foreground focus-visible:ring-offset-brand-deep',
            )}
          >
            <GitHubIcon className="size-4" />
            {t('finalCta.source')}
          </a>
        </div>
      </div>
    </section>
  )
}
