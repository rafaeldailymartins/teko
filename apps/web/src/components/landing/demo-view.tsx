import { ArrowUpIcon, CalendarClockIcon, ShieldCheckIcon } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { TekoLogo } from '@/components/brand/teko-logo'
import {
  answerWords,
  type DemoExchange,
  type DemoFrame,
  DemoPhase,
  questionChars,
} from '@/lib/landing/demo-timeline'
import { cn } from '@/lib/utils'

/**
 * A apresentação da demonstração do hero, sem estado: desenha um quadro do roteiro. Não tem
 * `'use client'` de propósito: o servidor a usa para o quadro final do HTML estático (sem JavaScript
 * próprio no primeiro acesso), e o animador (`chat-demo.tsx`, carregado sob demanda) a usa para os
 * quadros seguintes, com o mesmo DOM.
 */

/** Textos de uma cena (uma data de referência), já traduzidos e formatados no servidor. */
interface DemoSceneCopy {
  /** Chip do compositor ("Período 05/2008"). */
  readonly chip: string
  /** Primeira linha do cabeçalho da resposta (a data e a origem dela). */
  readonly reference: string
  /** Segunda linha do cabeçalho (a vigência das redações citadas). */
  readonly validity: string
  /** Badge da fonte, em verde-folha ("Vigente em 05/2008 · 04/11/2004 a 22/11/2009"). */
  readonly badge: string
  readonly answer: string
}

export interface ChatDemoCopy {
  readonly title: string
  readonly subtitle: string
  readonly question: string
  readonly placeholder: string
  readonly chooseDate: string
  readonly thinking: string
  readonly sources: string
  readonly citation: string
  readonly pause: string
  readonly play: string
  readonly scenes: readonly DemoSceneCopy[]
}

/** Posições (0–100) e rótulos da linha do tempo do hero, calculados no servidor. */
export interface HeroTimelineCopy {
  readonly caption: string
  readonly milestones: readonly {
    readonly position: number
    readonly date: string
    readonly label: string
    readonly revoked: boolean
  }[]
  readonly years: readonly { readonly position: number; readonly year: number }[]
  /** Onde estão as datas de referência das cenas, e o rótulo do ponto âmbar em cada uma. */
  readonly scenes: readonly { readonly position: number; readonly label: string }[]
}

/** O que o hero passa à demonstração: textos, linha do tempo, resumo e legenda. */
export interface HeroDemoProps {
  readonly copy: ChatDemoCopy
  readonly timeline: HeroTimelineCopy
  /** Resumo da demonstração para leitor de tela (a animação é `aria-hidden`). */
  readonly summary: ReactNode
  /** Legenda visível sob a janela. */
  readonly caption: string
}

interface DemoFigureProps extends HeroDemoProps {
  readonly frame: DemoFrame
  /** O botão de pausa (só com o animador). */
  readonly controls?: ReactNode
  readonly figureRef?: Ref<HTMLElement>
}

/**
 * A demonstração num quadro: a figura com a janela de chat (`aria-hidden`, sem nada focável), o
 * resumo para leitor de tela e a legenda, e a linha do tempo do dispositivo. São dois filhos da grade
 * do hero.
 */
export function DemoFigure({
  copy,
  timeline,
  summary,
  caption,
  frame,
  controls,
  figureRef,
}: DemoFigureProps) {
  const reference = frame.reference ?? 0
  return (
    <>
      <figure
        ref={figureRef}
        aria-labelledby="hero-demo-caption"
        data-testid="hero-demo"
        data-phase={frame.phase}
        data-reference={reference}
        className="relative lg:col-start-2 lg:row-start-1"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] bg-[radial-gradient(60%_55%_at_60%_40%,color-mix(in_oklch,var(--leaf)_22%,transparent),transparent_75%)] blur-2xl"
        />
        <ChatWindow copy={copy} frame={frame} />
        {controls}
        <div className="sr-only" data-testid="hero-demo-summary">
          {summary}
        </div>
        <figcaption
          id="hero-demo-caption"
          className="mt-4 flex items-center gap-2 text-muted-foreground text-xs"
        >
          <ShieldCheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-leaf" />
          {caption}
        </figcaption>
      </figure>
      <HeroTimeline timeline={timeline} reference={reference} />
    </>
  )
}

const CHIP =
  'inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full border px-1.5 font-medium font-mono text-xs tabular-nums'

function ChatWindow({ copy, frame }: { readonly copy: ChatDemoCopy; readonly frame: DemoFrame }) {
  const clearing = frame.phase === DemoPhase.Clearing
  return (
    <div
      aria-hidden="true"
      data-testid="hero-demo-window"
      className="flex h-[36rem] flex-col overflow-hidden rounded-2xl border border-border/80 bg-popover text-popover-foreground shadow-overlay sm:h-[34rem]"
    >
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b bg-surface-gradient px-4 pr-12">
        <TekoLogo className="size-6 rounded-md" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="font-semibold font-serif text-sm">{copy.title}</span>
          <span className="truncate text-[0.6875rem] text-muted-foreground">{copy.subtitle}</span>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden mask-t-from-80% px-4 sm:px-5">
        <div
          className={cn(
            'flex h-full flex-col justify-end gap-5 pb-4',
            clearing
              ? '-translate-y-full transition-transform duration-500 ease-in'
              : 'translate-y-0',
          )}
        >
          {frame.exchanges.map((exchange) => (
            <Exchange
              key={exchange.scene}
              copy={copy}
              exchange={exchange}
              scene={copy.scenes[exchange.scene]}
            />
          ))}
        </div>
      </div>
      <Composer copy={copy} frame={frame} />
    </div>
  )
}

function Exchange({
  copy,
  exchange,
  scene,
}: {
  readonly copy: ChatDemoCopy
  readonly exchange: DemoExchange
  readonly scene: DemoSceneCopy | undefined
}) {
  if (scene === undefined) return null
  const words = answerWords(scene.answer)
  const streaming = exchange.header && !exchange.sources
  return (
    <div className="flex flex-col gap-3" data-demo-exchange={exchange.scene}>
      <div className="flex animate-in justify-end duration-300 slide-in-from-bottom-3">
        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-gradient px-3.5 py-2 text-[0.9375rem] text-brand-foreground shadow-soft ring-1 ring-leaf/25">
          {copy.question}
        </p>
      </div>
      <div className="flex gap-2.5">
        <TekoLogo className="mt-0.5 size-6 rounded-md" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {exchange.header ? (
            <div className="flex animate-in flex-col gap-0.5 text-muted-foreground text-xs duration-300 slide-in-from-bottom-1">
              <p className="flex items-center gap-1.5 font-medium text-accent-foreground">
                <span className="size-1.5 rounded-full bg-date-mark" />
                {scene.reference}
              </p>
              <p className="tabular-nums">{scene.validity}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 pt-1" data-demo-thinking="">
              <p className="text-muted-foreground text-xs">{copy.thinking}</p>
              <span className="h-2.5 w-4/5 rounded-full bg-muted" />
              <span className="h-2.5 w-3/5 rounded-full bg-muted" />
            </div>
          )}
          {exchange.words > 0 && (
            <p className="text-[0.9375rem] leading-relaxed">
              {words.slice(0, exchange.words).join(' ')}
              {streaming && (
                <span className="ml-0.5 inline-block h-[0.9em] w-1.5 translate-y-[0.1em] rounded-[2px] bg-leaf" />
              )}
              {exchange.sources && (
                <span className={cn(CHIP, 'ml-1 border-border-strong bg-surface text-foreground')}>
                  1
                </span>
              )}
            </p>
          )}
          {exchange.sources && (
            <div className="flex animate-in flex-wrap items-center gap-x-2 gap-y-1.5 border-t pt-2.5 text-xs duration-300 slide-in-from-bottom-1">
              <span className="text-muted-foreground">{copy.sources}:</span>
              <span className={cn(CHIP, 'border-primary bg-primary text-primary-foreground')}>
                1
              </span>
              <span className="font-medium">{copy.citation}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-leaf/60 bg-leaf-soft px-2 py-0.5 font-medium text-validity-current tabular-nums">
                <span className="size-1.5 rounded-full bg-leaf" />
                {scene.badge}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Composer({ copy, frame }: { readonly copy: ChatDemoCopy; readonly frame: DemoFrame }) {
  const chars = questionChars(copy.question)
  const typing = frame.phase === DemoPhase.Typing || frame.phase === DemoPhase.Choosing
  const text = chars.slice(0, frame.typed).join('')
  const scene = frame.reference === null ? null : copy.scenes[frame.reference]
  const ready = frame.phase === DemoPhase.Choosing
  return (
    <div className="shrink-0 border-t bg-surface/60 p-3">
      <div
        className={cn(
          'flex flex-col gap-2.5 rounded-xl border bg-popover px-3 pt-2.5 pb-2 shadow-soft transition-[border-color,box-shadow] duration-200',
          typing && 'border-ring/60 shadow-raised',
        )}
      >
        <p className="min-h-[2.75rem] text-[0.9375rem] leading-snug">
          {text === '' ? <span className="text-muted-foreground">{copy.placeholder}</span> : text}
          {typing && (
            <span className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[0.18em] bg-primary" />
          )}
        </p>
        <div className="flex items-center justify-between gap-2">
          {scene === null || scene === undefined ? (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-strong/60 border-dashed px-2.5 text-muted-foreground text-xs">
              <CalendarClockIcon className="size-3.5" />
              {copy.chooseDate}
            </span>
          ) : (
            <span
              key={frame.reference}
              data-demo-chip={frame.reference}
              className="inline-flex h-7 animate-in items-center gap-1.5 rounded-full border border-accent-border bg-accent px-2.5 font-medium font-mono text-accent-foreground text-xs tabular-nums duration-300 zoom-in-90"
            >
              <CalendarClockIcon className="size-3.5" />
              {scene.chip}
            </span>
          )}
          <span
            className={cn(
              'flex size-8 items-center justify-center rounded-full transition-colors duration-200',
              ready
                ? 'bg-primary text-primary-foreground shadow-soft'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <ArrowUpIcon className="size-4" />
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * A linha do tempo do dispositivo da demonstração, atravessando o hero: as redações (a vigente na
 * primeira data em verde-folha, a revogação tracejada), os marcos e o ponto âmbar da data, que
 * desliza quando a cena troca de data. Decorativa: o resumo textual diz o mesmo.
 */
function HeroTimeline({
  timeline,
  reference,
}: {
  readonly timeline: HeroTimelineCopy
  readonly reference: number
}) {
  const [added, amended, revoked] = timeline.milestones
  const scene = timeline.scenes[reference] ?? timeline.scenes[0]
  if (added === undefined || amended === undefined || revoked === undefined) return null
  if (scene === undefined) return null
  return (
    <div
      aria-hidden="true"
      data-testid="hero-timeline"
      className="relative mt-4 lg:col-span-2 lg:mt-10"
    >
      <p className="mb-3 font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-[0.14em]">
        {timeline.caption}
      </p>
      <div className="relative h-28">
        {/* Marcos: data e o que mudou, acima do fio (só no desktop, onde há espaço). */}
        {timeline.milestones.map((milestone) => (
          <div
            key={milestone.date}
            className="absolute top-0 hidden flex-col gap-0.5 border-l border-border-strong/50 pb-2 pl-2 sm:flex"
            style={{ left: `${milestone.position}%`, height: '3.25rem' }}
          >
            <span className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
              {milestone.date}
            </span>
            <span
              className={cn(
                'whitespace-nowrap font-medium text-xs',
                milestone.revoked ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {milestone.label}
            </span>
          </div>
        ))}
        {/* O fio: a redação original, a vigente de 2004 a 2009 e a revogação tracejada. */}
        <div className="absolute inset-x-0 top-[3.25rem] h-px timeline-rule sm:top-[3.25rem]" />
        <span
          className="absolute top-[calc(3.25rem-1px)] h-[3px] rounded-full bg-leaf/45"
          style={{ left: `${added.position}%`, width: `${amended.position - added.position}%` }}
        />
        <span
          className="absolute top-[calc(3.25rem-1.5px)] h-1 rounded-full bg-leaf-gradient"
          style={{ left: `${amended.position}%`, width: `${revoked.position - amended.position}%` }}
        />
        <span
          className="absolute top-[3.25rem] border-border-strong/70 border-t-2 border-dashed"
          style={{ left: `${revoked.position}%`, right: 0 }}
        />
        {timeline.milestones.map((milestone) => (
          <span
            key={milestone.date}
            className={cn(
              'absolute top-[3.25rem] size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-background',
              milestone.revoked ? 'border-border-strong' : 'border-leaf',
            )}
            style={{ left: `${milestone.position}%` }}
          />
        ))}
        {/* Anos, abaixo do fio. */}
        {timeline.years.map(({ position, year }, index) => (
          <span
            key={year}
            className={cn(
              'absolute top-[4.1rem] -translate-x-1/2 font-mono text-[0.625rem] text-muted-foreground tabular-nums',
              index % 2 === 1 && 'max-sm:hidden',
            )}
            style={{ left: `${position}%` }}
          >
            {year}
          </span>
        ))}
        {/* O ponto âmbar da data de referência, com o rótulo da cena. */}
        <span
          data-testid="hero-timeline-date"
          className="absolute top-[3.25rem] z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-[left] duration-700 ease-out-soft"
          style={{ left: `${scene.position}%` }}
        >
          <span className="size-4 rounded-full border-[3px] border-background bg-date-mark shadow-[0_0_0_6px_color-mix(in_oklch,var(--date-mark)_22%,transparent)]" />
          <span className="absolute top-10 whitespace-nowrap rounded-full border border-accent-border bg-accent px-2 py-0.5 font-medium font-mono text-[0.6875rem] text-accent-foreground tabular-nums shadow-soft">
            {scene.label}
          </span>
        </span>
      </div>
    </div>
  )
}
