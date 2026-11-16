'use client'

import { type Citation, idSchema, type ResolvedReferenceDate } from '@teko/shared/contracts'
import type { Locale } from '@teko/shared/i18n'
import type { IsoDate } from '@teko/shared/vigencia'
import { AlertTriangleIcon, CircleSlashIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { lazy, type ReactNode, Suspense, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CoverageStatus } from '@/lib/chat/coverage'
import {
  type AnswerView,
  answerValidity,
  answerView,
  degradationLabels,
  messageText,
  type TekoUIMessage,
} from '@/lib/chat/parts'
import { formatIsoDate, formatTaxPeriod } from '@/lib/i18n/format'
import { CitationChip } from './citation-chip.tsx'
import { CoverageBanner } from './coverage.tsx'
import { FeedbackButtons } from './feedback-buttons.tsx'
import { useIntervalText } from './validity-badge.tsx'

/** Streamdown e Shiki: chunk sob demanda, pré-carregado quando a conversa abre. */
const AnswerMarkdown = lazy(() => import('./answer-markdown.tsx'))

/** Bolha da pergunta (aparece na hora do envio: bolha otimista). */
export function UserBubble({ message }: { readonly message: TekoUIMessage }) {
  const t = useTranslations('chat.thread')
  return (
    <div className="flex justify-end" data-message-role="user">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-secondary px-4 py-2 text-secondary-foreground">
        <span className="sr-only">{t('you')}: </span>
        <p className="whitespace-pre-wrap">{messageText(message)}</p>
      </div>
    </div>
  )
}

/** Placeholder da resposta entre o envio e o primeiro chunk. */
export function AnswerSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="answer-skeleton">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  )
}

function referenceText(
  reference: ResolvedReferenceDate,
  t: ReturnType<typeof useTranslations<'chat.answer'>>,
  locale: Locale,
): string {
  // Período de apuração (o PA resolve para o dia 1) e data exata têm formas próprias.
  const isPeriodo = reference.value.endsWith('-01') && reference.source !== 'explicit'
  const value = isPeriodo
    ? t('referencePeriodo', { value: formatTaxPeriod(locale, reference.value.slice(0, 7)) })
    : t('referenceDate', { value: formatIsoDate(locale, reference.value, 'numeric') })
  return `${value} · ${t(`source.${reference.source}`)}`
}

/** Cabeçalho da resposta: data de referência usada, origem dela e vigência das redações citadas. */
function AnswerHeader({ view }: { readonly view: AnswerView }) {
  const t = useTranslations('chat.answer')
  const locale = useLocale()
  const intervalText = useIntervalText()
  const { reference } = view
  if (reference === null) return null
  const validity = answerValidity(view.citations)
  const inferred = reference.source === 'question_text'
  return (
    <header
      className="flex flex-col gap-1 text-muted-foreground text-xs"
      data-reference-date={reference.value}
      data-reference-source={reference.source}
    >
      <p className={inferred ? 'font-medium text-accent-foreground' : undefined}>
        {referenceText(reference, t, locale)}
      </p>
      {validity !== null && (
        <p data-answer-validity="" className="tabular-nums">
          {t('validity', { range: intervalText(validity) })}
        </p>
      )}
      {reference.periodBoundaryInside && (
        <p className="flex items-center gap-1 text-degraded">
          <AlertTriangleIcon aria-hidden="true" className="size-3.5" />
          {t('boundaryInside')}
        </p>
      )}
    </header>
  )
}

function DegradationBadges({ view }: { readonly view: AnswerView }) {
  const t = useTranslations('chat.answer.degraded')
  const labels = degradationLabels(view.meta)
  if (labels.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <li
          key={label}
          data-degraded={label}
          className="rounded-full border border-degraded px-2 py-0.5 text-degraded text-xs"
        >
          {t(label)}
        </li>
      ))}
    </ul>
  )
}

function RefusalNotice({ view }: { readonly view: AnswerView }) {
  const t = useTranslations('chat.refusal')
  const intervalText = useIntervalText()
  const { refusal } = view
  if (refusal === null) return null
  return (
    <div
      role="note"
      data-refusal={refusal.reason}
      className="flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <CircleSlashIcon aria-hidden="true" className="size-4" />
        {t('title')}
      </p>
      <p>{t(`reasons.${refusal.reason}`)}</p>
      {refusal.coverage?.map((family) => (
        <p key={family.family} className="text-muted-foreground text-xs tabular-nums">
          {t('covered', {
            family: family.family,
            ranges: family.covered.map((interval) => intervalText(interval)).join('; '),
          })}
        </p>
      ))}
    </div>
  )
}

interface ClarificationProps {
  readonly view: AnswerView
  readonly onChoose: (date: IsoDate) => void
  readonly disabled: boolean
}

function ClarificationButtons({ view, onChoose, disabled }: ClarificationProps) {
  const t = useTranslations('chat.clarification')
  const locale = useLocale()
  const { clarification } = view
  if (clarification === null) return null
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-medium">{t('title')}</legend>
      <p className="text-muted-foreground text-sm">{t(`reasons.${clarification.reason}`)}</p>
      <div className="flex flex-wrap gap-2">
        {clarification.candidates.map((date) => (
          <Button
            key={date}
            variant="outline"
            size="sm"
            disabled={disabled}
            data-candidate={date}
            className="border-accent-border"
            onClick={() => onChoose(date)}
          >
            {t('choose', { value: formatIsoDate(locale, date, 'numeric') })}
          </Button>
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
 * Resposta do assistente: cabeçalho com data e vigência, rótulos de degradação, avisos de
 * cobertura, recusa ou esclarecimento, markdown com os chips de citação, fontes e feedback.
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
      className="flex flex-col gap-3"
    >
      <AnswerHeader view={view} />
      <DegradationBadges view={view} />
      {uncovered.length > 0 && (
        <CoverageBanner status={CoverageStatus.Partial} families={uncovered} />
      )}
      <RefusalNotice view={view} />
      <ClarificationButtons view={view} onChoose={onClarify} disabled={busy} />
      {view.text !== '' && (
        <div data-answer-body="">
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
        <div className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
          <span>{t('answer.citations')}:</span>
          {citations.map((citation) => (
            <CitationChip
              key={citation.id}
              citation={citation}
              number={Number(citation.id.slice(1))}
              today={today}
              selected={selectedCitationId === citation.id}
              onOpen={() => open(citation.id)}
            />
          ))}
        </div>
      )}
      {(finished || footer !== undefined) && (
        <div className="flex flex-wrap items-center gap-2">
          {finished && questionId !== null && <FeedbackButtons questionId={questionId} />}
          {footer}
        </div>
      )}
    </article>
  )
}
