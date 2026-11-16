'use client'

import { type Citation, idSchema, type ResolvedReferenceDate } from '@teko/shared/contracts'
import type { Locale } from '@teko/shared/i18n'
import type { IsoDate } from '@teko/shared/vigencia'
import { AlertTriangleIcon, CircleSlashIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { lazy, type ReactNode, Suspense, useCallback } from 'react'
import { TekoLogo } from '@/components/brand/teko-logo'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type AnswerView,
  answerValidity,
  answerView,
  degradationLabels,
  messageText,
  type TekoUIMessage,
} from '@/lib/chat/parts'
import { formatIsoDate, formatTaxPeriod } from '@/lib/i18n/format'
import { AnswerActions } from './answer-actions.tsx'
import { CitationChip } from './citation-chip.tsx'
import { CoverageNote } from './coverage.tsx'
import { SourceList } from './source-list.tsx'
import { useIntervalText } from './validity-badge.tsx'

/** Streamdown e Shiki: chunk sob demanda, pré-carregado quando a conversa abre. */
const AnswerMarkdown = lazy(() => import('./answer-markdown.tsx'))

/** Medida de leitura das respostas: 16 px, entrelinha folgada e linhas de até ~70 caracteres. */
const READING_CLASSES = 'max-w-[70ch] text-[16px] leading-[1.7] text-foreground'

/** Bolha da pergunta (aparece na hora do envio: bolha otimista). */
export function UserBubble({ message }: { readonly message: TekoUIMessage }) {
  const t = useTranslations('chat.thread')
  return (
    <div className="flex justify-end" data-message-role="user">
      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-border/60 bg-secondary px-4 py-2.5 text-secondary-foreground shadow-soft sm:max-w-[75%]">
        <span className="sr-only">{t('you')}: </span>
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{messageText(message)}</p>
      </div>
    </div>
  )
}

/** Nome e selo do Tekó no topo de cada resposta. */
function AnswerByline() {
  const t = useTranslations('chat.thread')
  return (
    <span className="inline-flex items-center gap-2">
      <TekoLogo className="size-6 rounded-md shadow-soft" />
      <span className="font-semibold text-sm">{t('assistant')}</span>
    </span>
  )
}

interface AnswerSkeletonProps {
  /** Texto do estado ("Consultando as redações vigentes…"); sem ele, só a forma da resposta. */
  readonly label?: string
}

/**
 * Placeholder da resposta com a forma dela (selo e linha de metadados, parágrafo e a linha das
 * fontes) e, com `label`, o ponto âmbar andando sobre o fio da linha do tempo: o Tekó procura a
 * redação vigente na data. Com movimento reduzido, o ponto fica parado.
 */
export function AnswerSkeleton({ label }: AnswerSkeletonProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="answer-skeleton">
      <div className="flex flex-wrap items-center gap-2.5">
        <AnswerByline />
        <Skeleton className="h-3 w-44" />
      </div>
      {label !== undefined && (
        <div className="flex items-center gap-3 text-muted-foreground text-sm">
          <span aria-hidden="true" className="timeline-rule relative h-px w-16 shrink-0">
            <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-date-mark motion-safe:left-0 motion-safe:translate-x-0 motion-safe:animate-timeline" />
          </span>
          <span>{label}</span>
        </div>
      )}
      <div className="flex max-w-[70ch] flex-col gap-2.5 pt-1">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[94%]" />
        <Skeleton className="h-4 w-[82%]" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      <Skeleton className="mt-1 h-4 w-20" />
    </div>
  )
}

/** A data de referência usada: período de apuração (o PA resolve para o dia 1) ou data exata. */
function referenceParts(
  reference: ResolvedReferenceDate,
  locale: Locale,
): { readonly kind: 'periodo' | 'date'; readonly value: string } {
  const isPeriodo = reference.value.endsWith('-01') && reference.source !== 'explicit'
  return isPeriodo
    ? { kind: 'periodo', value: formatTaxPeriod(locale, reference.value.slice(0, 7)) }
    : { kind: 'date', value: formatIsoDate(locale, reference.value, 'numeric') }
}

/** Separador da linha de metadados ("05/2008 · vigência desde 23/09/2005"). */
function Dot() {
  return <span aria-hidden="true">·</span>
}

/**
 * Cabeçalho da resposta numa linha: o selo e, em texto pequeno e apagado, a data de referência usada
 * (com o ponto âmbar; "inferida do texto" quando veio da pergunta), a vigência das redações citadas
 * e os rótulos de degradação. "Resposta em cache" não muda a resposta: fica na dica da linha e para
 * leitores de tela, sem ocupar a vista.
 */
function AnswerHeader({ view }: { readonly view: AnswerView }) {
  const t = useTranslations('chat.answer')
  const tDegraded = useTranslations('chat.answer.degraded')
  const locale = useLocale()
  const intervalText = useIntervalText()
  const { reference } = view
  const validity = answerValidity(view.citations)
  const degraded = degradationLabels(view.meta)
  const visibleDegraded = degraded.filter((label) => label !== 'cached')
  const cached = degraded.includes('cached')
  const date = reference === null ? null : referenceParts(reference, locale)
  const hasMeta = date !== null || degraded.length > 0
  return (
    <header className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <AnswerByline />
        {hasMeta && (
          <p
            className="inline-flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-xs"
            title={cached ? tDegraded('cached') : undefined}
            data-reference-date={reference?.value}
            data-reference-source={reference?.source}
          >
            {date !== null && reference !== null && (
              <>
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-date-mark" />
                <span className="font-medium font-mono text-foreground/80 tabular-nums">
                  <span className="sr-only">
                    {t(date.kind === 'periodo' ? 'periodoLabel' : 'dateLabel')}{' '}
                  </span>
                  {date.value}
                </span>
                {reference.source === 'question_text' && <span>({t('source.question_text')})</span>}
              </>
            )}
            {validity !== null && (
              <>
                <Dot />
                <span className="tabular-nums" data-answer-validity="">
                  {t('validityShort', { range: intervalText(validity) })}
                </span>
              </>
            )}
            {visibleDegraded.map((label) => (
              <span key={label} className="contents">
                <Dot />
                <span data-degraded={label}>{tDegraded(label)}</span>
              </span>
            ))}
            {cached && (
              <span className="sr-only" data-degraded="cached">
                {tDegraded('cached')}
              </span>
            )}
          </p>
        )}
      </div>
      {reference?.periodBoundaryInside === true && (
        <p className="flex items-center gap-1.5 text-degraded text-sm">
          <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
          {t('boundaryInside')}
        </p>
      )}
    </header>
  )
}

/** Recusa: sem resposta fundamentada, com o motivo e o que o corpus cobre. Não é um erro. */
function RefusalNotice({ view }: { readonly view: AnswerView }) {
  const t = useTranslations('chat.refusal')
  const intervalText = useIntervalText()
  const { refusal } = view
  if (refusal === null) return null
  return (
    <div
      role="note"
      data-refusal={refusal.reason}
      className="flex max-w-[70ch] gap-3 rounded-xl border bg-surface p-4"
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <CircleSlashIcon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="font-semibold font-serif text-base">{t('title')}</p>
        <p className="text-[15px] leading-relaxed">{t(`reasons.${refusal.reason}`)}</p>
        {refusal.coverage !== undefined && refusal.coverage.length > 0 && (
          <ul className="flex flex-col gap-1 pt-1">
            {refusal.coverage.map((family) => (
              <li
                key={family.family}
                className="flex items-center gap-2 font-mono text-muted-foreground text-xs tabular-nums"
              >
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-leaf" />
                {t('covered', {
                  family: family.family,
                  ranges: family.covered.map((interval) => intervalText(interval)).join('; '),
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

interface ClarificationProps {
  readonly view: AnswerView
  readonly onChoose: (date: IsoDate) => void
  readonly disabled: boolean
}

/** Esclarecimento da data: um botão por data candidata, no âmbar da data de referência. */
function ClarificationButtons({ view, onChoose, disabled }: ClarificationProps) {
  const t = useTranslations('chat.clarification')
  const locale = useLocale()
  const { clarification } = view
  if (clarification === null) return null
  return (
    <fieldset className="flex max-w-[70ch] flex-col gap-2.5 rounded-xl border border-accent-border/60 bg-popover p-4 shadow-soft">
      <legend className="float-left font-semibold font-serif text-base">{t('title')}</legend>
      <p className="clear-left text-muted-foreground text-sm">
        {t(`reasons.${clarification.reason}`)}
      </p>
      <div className="flex flex-wrap gap-2">
        {clarification.candidates.map((date) => (
          <button
            key={date}
            type="button"
            disabled={disabled}
            data-candidate={date}
            onClick={() => onChoose(date)}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-accent-border/70 bg-accent px-3.5 font-medium text-accent-foreground text-sm shadow-soft outline-none transition-shadow duration-150 ease-out-soft hover:shadow-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50"
          >
            <span aria-hidden="true" className="size-2 rounded-full bg-date-mark" />
            <span className="tabular-nums">
              {t('choose', { value: formatIsoDate(locale, date, 'numeric') })}
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

interface AssistantMessageProps {
  readonly message: TekoUIMessage
  readonly streaming: boolean
  readonly today: IsoDate
  readonly selectedCitationId: string | null
  readonly onOpenCitation: (citations: readonly Citation[], index: number) => void
  readonly onClarify: (date: IsoDate) => void
  readonly busy: boolean
  /** Ação extra no rodapé (ex.: recarregar a resposta depois de uma queda do stream). */
  readonly footer?: ReactNode
}

/**
 * Resposta do assistente, com o texto como protagonista: a linha do selo com a data, a vigência e a
 * degradação em tom apagado, a nota de cobertura parcial (quando há), a recusa ou o esclarecimento,
 * o markdown na medida de leitura com os chips de citação, as fontes recolhidas numa linha e as
 * ações (copiar, 👍/👎).
 */
export function AssistantMessage({
  message,
  streaming,
  today,
  selectedCitationId,
  onOpenCitation,
  onClarify,
  busy,
  footer,
}: AssistantMessageProps) {
  const t = useTranslations('chat')
  const view = answerView(message)
  const { citations } = view
  const questionId = idSchema.safeParse(message.id).success ? message.id : null

  const open = useCallback(
    (id: string) => {
      const index = citations.findIndex((citation) => citation.id === id)
      if (index >= 0) onOpenCitation(citations, index)
    },
    [citations, onOpenCitation],
  )
  const renderCitation = useCallback(
    (id: string) => (
      <CitationChip
        citation={citations.find((citation) => citation.id === id) ?? null}
        number={Number(id.slice(1))}
        today={today}
        selected={selectedCitationId === id}
        onOpen={() => open(id)}
      />
    ),
    [citations, open, selectedCitationId, today],
  )
  const uncovered = view.meta?.uncoveredFamilies ?? []
  const finished = !streaming && (view.text !== '' || view.refusal !== null)

  return (
    <article
      aria-busy={streaming}
      aria-label={t('thread.assistant')}
      data-message-role="assistant"
      data-message-id={message.id}
      className="group/answer flex flex-col gap-3.5"
    >
      <AnswerHeader view={view} />
      {uncovered.length > 0 && <CoverageNote families={uncovered} />}
      <RefusalNotice view={view} />
      <ClarificationButtons view={view} onChoose={onClarify} disabled={busy} />
      {view.text !== '' && (
        <div data-answer-body="" className={READING_CLASSES}>
          <Suspense fallback={<p className="whitespace-pre-wrap">{view.text}</p>}>
            <AnswerMarkdown
              markdown={view.text}
              streaming={streaming}
              renderCitation={renderCitation}
            />
          </Suspense>
        </div>
      )}
      {streaming && view.text === '' && view.refusal === null && <AnswerSkeleton />}
      {citations.length > 0 && (
        <SourceList
          citations={citations}
          today={today}
          selectedCitationId={selectedCitationId}
          onOpen={open}
        />
      )}
      {(finished || footer !== undefined) && (
        <div className="flex flex-wrap items-center gap-2">
          {finished && (
            <AnswerActions
              questionId={questionId}
              markdown={view.text === '' ? null : view.text}
              citations={citations}
            />
          )}
          {footer}
        </div>
      )}
    </article>
  )
}
