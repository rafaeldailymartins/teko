import type { Locale } from '@teko/shared/i18n'
import { ArrowRightIcon, CheckIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { formatIsoDate, formatTaxPeriod, formatValidityBounds } from '@/lib/i18n/format'
import {
  DEMO_MILESTONES,
  DEMO_SCALE,
  DEMO_SCALE_YEARS,
  DEMO_SCENES,
  MilestoneKind,
  scalePosition,
} from '@/lib/landing/demo-case'
import {
  buildDemoSteps,
  type DemoFrame,
  demoScript,
  finalStepIndex,
} from '@/lib/landing/demo-timeline'
import { localePagePath } from '@/lib/navigation'
import {
  type ChatDemoCopy,
  DemoFigure,
  type HeroDemoProps,
  type HeroTimelineCopy,
} from './demo-view.tsx'
import { HeroDemoMount } from './hero-demo.tsx'

/** O quadro final do roteiro: o do HTML estático, antes do animador assumir. */
function finalFrame(copy: ChatDemoCopy): DemoFrame {
  const steps = buildDemoSteps(
    demoScript(
      copy.question,
      copy.scenes.map((scene) => scene.answer),
    ),
  )
  const step = steps[finalStepIndex(steps)]
  if (step === undefined) throw new Error('roteiro da demonstração vazio')
  return step.frame
}

interface HeroProps {
  readonly locale: Locale
}

/** Dia da revogação do § 6º: o início da redação citada na segunda cena. */
function revocationDate(locale: Locale): string {
  const revoked = DEMO_MILESTONES.find((milestone) => milestone.kind === MilestoneKind.Revoked)
  return revoked === undefined ? '' : formatIsoDate(locale, revoked.date, 'numeric')
}

/** Textos da demonstração, traduzidos e com as datas formatadas no idioma da página. */
async function demoCopy(locale: Locale): Promise<ChatDemoCopy> {
  const t = await getTranslations({ locale, namespace: 'landing.demo' })
  const tAnswer = await getTranslations({ locale, namespace: 'chat.answer' })
  const tIntervals = await getTranslations({ locale, namespace: 'chat.intervals' })
  const [before, after] = DEMO_SCENES
  const revokedOn = revocationDate(locale)
  const interval = (scene: (typeof DEMO_SCENES)[number]) => {
    const { from, to } = formatValidityBounds(locale, scene.validity)
    if (from !== null && to !== null) return tIntervals('range', { from, to })
    return tIntervals('since', { from: from ?? '' })
  }
  const answers = [
    t('answers.before', { period: formatTaxPeriod(locale, before.reference) }),
    t('answers.after', { period: formatTaxPeriod(locale, after.reference), revokedOn }),
  ]
  return {
    title: t('title'),
    subtitle: t('subtitle'),
    question: t('question'),
    placeholder: t('placeholder'),
    chooseDate: t('chooseDate'),
    thinking: t('thinking'),
    sources: tAnswer('citations'),
    citation: t('citation'),
    pause: t('pause'),
    play: t('play'),
    scenes: DEMO_SCENES.map((scene, index) => {
      const period = formatTaxPeriod(locale, scene.reference)
      return {
        chip: t('chip', { value: period }),
        reference: `${tAnswer('referencePeriodo', { value: period })} · ${tAnswer('source.periodo_apuracao')}`,
        validity: tAnswer('validity', { range: interval(scene) }),
        badge: `${t('validAt', { value: period })} · ${interval(scene)}`,
        answer: answers[index] ?? '',
      }
    }),
  }
}

async function timelineCopy(locale: Locale): Promise<HeroTimelineCopy> {
  const t = await getTranslations({ locale, namespace: 'landing.timeline' })
  return {
    caption: t('caption'),
    milestones: DEMO_MILESTONES.map((milestone) => ({
      position: scalePosition(milestone.date, DEMO_SCALE),
      date: formatIsoDate(locale, milestone.date, 'numeric'),
      label: t(milestone.kind),
      revoked: milestone.kind === MilestoneKind.Revoked,
    })),
    years: DEMO_SCALE_YEARS.map((year) => ({
      position: scalePosition(`${year}-01-01`, DEMO_SCALE),
      year,
    })),
    scenes: DEMO_SCENES.map((scene) => ({
      position: scalePosition(scene.referenceDate, DEMO_SCALE),
      label: formatTaxPeriod(locale, scene.reference),
    })),
  }
}

/**
 * Hero da landing: a manchete em serif com "na sua data" sublinhado pelo fio da linha do tempo, as
 * chamadas, as provas curtas e, ao lado, a demonstração animada do chat; embaixo, atravessando o
 * hero, a linha do tempo do dispositivo da demonstração com o ponto âmbar da data.
 */
export async function Hero({ locale }: HeroProps) {
  const t = await getTranslations({ locale, namespace: 'landing' })
  const [before, after] = DEMO_SCENES
  const beforeBounds = formatValidityBounds(locale, before.validity)
  const proofs = ['official', 'cited', 'license'] as const
  const demo: HeroDemoProps = {
    copy: await demoCopy(locale),
    timeline: await timelineCopy(locale),
    caption: t('demo.caption'),
    summary: t.rich('demo.summary', {
      ptBR: (chunks) => <span lang="pt-BR">{chunks}</span>,
      before: formatTaxPeriod(locale, before.reference),
      after: formatTaxPeriod(locale, after.reference),
      beforeRange: `${beforeBounds.from ?? ''} – ${beforeBounds.to ?? ''}`,
      revokedOn: revocationDate(locale),
    }),
  }

  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-brand-glow" />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,color-mix(in_oklch,var(--border)_70%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--border)_70%,transparent)_1px,transparent_1px)] bg-size-[3.5rem_3.5rem] mask-radial-from-0% mask-radial-to-70% mask-radial-at-[30%_20%] opacity-70"
      />
      <div className="mx-auto grid max-w-5xl gap-x-12 gap-y-10 px-5 pt-12 pb-12 sm:pt-20 lg:grid-cols-[1.06fr_1fr] lg:items-center lg:pb-16">
        <div className="lg:col-start-1 lg:row-start-1">
          <Badge tone="leaf">
            <span aria-hidden="true" className="size-2 rounded-full bg-leaf" />
            {t('badge')}
          </Badge>
          <h1
            id="hero-title"
            className="mt-7 text-balance font-semibold font-serif text-[clamp(2.5rem,4.6vw,3.75rem)] leading-[1.05] tracking-[-0.02em]"
          >
            {t.rich('title', {
              date: (chunks) => (
                <span className="relative inline-block whitespace-nowrap text-primary">
                  {chunks}
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-1.5 h-[3px] rounded-full bg-leaf-gradient"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute -right-1.5 -bottom-[0.6rem] size-3 rounded-full border-2 border-background bg-date-mark"
                  />
                </span>
              ),
            })}
          </h1>
          <p className="mt-7 max-w-xl text-pretty text-lg text-muted-foreground leading-relaxed">
            {t('lead')}
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a
              href={localePagePath(locale, 'chat')}
              className={buttonVariants({ variant: 'brand', size: 'lg', className: 'px-6' })}
            >
              {t('cta.open')}
              <ArrowRightIcon
                aria-hidden="true"
                className="transition-transform duration-200 group-hover/button:translate-x-0.5"
              />
            </a>
            <a
              href={localePagePath(locale, 'coverage')}
              className={buttonVariants({ size: 'lg', variant: 'outline' })}
            >
              {t('cta.coverage')}
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground text-sm">
            {proofs.map((proof) => (
              <li key={proof} className="inline-flex items-center gap-1.5">
                <CheckIcon aria-hidden="true" className="size-4 text-leaf" />
                {t(`proof.${proof}`)}
              </li>
            ))}
          </ul>
        </div>
        <HeroDemoMount {...demo}>
          <DemoFigure {...demo} frame={finalFrame(demo.copy)} />
        </HeroDemoMount>
      </div>
    </section>
  )
}
