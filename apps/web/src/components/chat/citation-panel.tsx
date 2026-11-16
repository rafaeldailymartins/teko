'use client'

import { useMutation } from '@tanstack/react-query'
import { FeedbackRating, FeedbackReason } from '@teko/shared/contracts'
import { type IsoDate, isoDateInTimeZone } from '@teko/shared/vigencia'
import {
  BookOpenTextIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  FlagIcon,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useId, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { submitFeedback } from '@/lib/api/mutations'
import {
  type CitationSelection,
  citationReference,
  provisionHref,
  selectedCitation,
} from '@/lib/chat/selection'
import { CitationTimeline } from './citation-timeline.tsx'
import { useIntervalText, ValidityBadge } from './validity-badge.tsx'

interface CitationPanelProps {
  readonly selection: CitationSelection
  readonly onStep: (step: -1 | 1) => void
}

/**
 * Painel da citação aberta: a família, o dispositivo em serif, o documento e a versão, o badge do
 * intervalo de vigência, o texto citado num cartão de leitura (`lang="pt-BR"`, também na UI em
 * inglês), as ações (fonte oficial, página do dispositivo, copiar, reportar), os campos e, no próprio
 * painel, a linha do tempo e o "O que mudou" (diff sob demanda) na data de referência da resposta.
 */
export function CitationPanel({ selection, onStep }: CitationPanelProps) {
  const t = useTranslations('chat.citation')
  const locale = useLocale()
  const intervalText = useIntervalText()
  const titleId = useId()
  const [today] = useState<IsoDate>(() => isoDateInTimeZone(new Date()))
  const [copied, setCopied] = useState(false)
  const report = useMutation({ mutationFn: submitFeedback })
  const citation = selectedCitation(selection)

  if (citation === null) return null
  const { questionId } = selection
  const total = selection.citations.length

  async function copy(): Promise<void> {
    if (citation === null) return
    const validity = t('validity', { range: intervalText(citation.validity) })
    await navigator.clipboard?.writeText(citationReference(citation, validity))
    setCopied(true)
  }

  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-5 px-4 pb-8">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-muted-foreground text-xs tabular-nums" aria-live="polite">
          {t('position', { current: selection.index + 1, total })}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('previous')}
            aria-keyshortcuts="["
            title={`${t('previous')} ([)`}
            disabled={selection.index === 0}
            onClick={() => onStep(-1)}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('next')}
            aria-keyshortcuts="]"
            title={`${t('next')} (])`}
            disabled={selection.index >= total - 1}
            onClick={() => onStep(1)}
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
      </div>

      <header className="flex flex-col gap-2">
        <p className="font-medium break-all font-mono text-[0.6875rem] text-muted-foreground">
          {citation.family} · {citation.jurisdiction} · {citation.stableKey}
        </p>
        <h3
          id={titleId}
          className="text-balance font-semibold font-serif text-xl leading-snug tracking-tight"
          lang="pt-BR"
        >
          {citation.label}
        </h3>
        <p lang="pt-BR" className="text-muted-foreground text-sm leading-snug">
          {citation.document.title}
          <span className="block text-xs">{citation.document.versionLabel}</span>
        </p>
        <ValidityBadge interval={citation.validity} today={today} className="mt-1 self-start" />
        {!citation.valid && (
          <p role="note" className="text-coverage-out text-sm">
            {t('invalid')}
          </p>
        )}
      </header>

      {citation.excerpt !== undefined && (
        <section aria-label={t('text')}>
          <blockquote
            lang="pt-BR"
            className="relative whitespace-pre-line rounded-xl border bg-popover py-4 pr-4 pl-5 font-serif text-[16px] leading-[1.7] shadow-soft before:absolute before:top-4 before:bottom-4 before:left-0 before:w-0.5 before:rounded-full before:bg-leaf-gradient"
          >
            {citation.excerpt}
          </blockquote>
        </section>
      )}

      <div className="grid grid-cols-2 gap-2">
        <a
          href={citation.document.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'outline', size: 'sm', className: 'justify-start' })}
        >
          <ExternalLinkIcon aria-hidden="true" />
          {t('source')}
        </a>
        <a
          href={provisionHref(locale, citation.stableKey, selection.referenceDate)}
          className={buttonVariants({ variant: 'outline', size: 'sm', className: 'justify-start' })}
        >
          <BookOpenTextIcon aria-hidden="true" />
          {t('openProvision')}
        </a>
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => void copy()}>
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          {t('copy')}
        </Button>
        {questionId !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            disabled={report.isPending || report.isSuccess}
            onClick={() =>
              report.mutate({
                questionId,
                rating: FeedbackRating.Down,
                reason: FeedbackReason.WrongCitation,
              })
            }
          >
            <FlagIcon aria-hidden="true" />
            {t('report')}
          </Button>
        )}
      </div>
      <p role="status" className="text-muted-foreground text-sm empty:hidden">
        {report.isSuccess ? t('reported') : copied ? t('copied') : ''}
      </p>

      {/* A chave zera o "O que mudou" aberto ao trocar de citação com `[`/`]`. */}
      <CitationTimeline
        key={`${citation.stableKey}|${selection.referenceDate ?? ''}`}
        stableKey={citation.stableKey}
        referenceDate={selection.referenceDate}
        today={today}
      />
    </article>
  )
}
