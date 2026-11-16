'use client'

import { useMutation } from '@tanstack/react-query'
import { FeedbackRating, FeedbackReason } from '@teko/shared/contracts'
import { type IsoDate, isoDateInTimeZone } from '@teko/shared/vigencia'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  FlagIcon,
  HistoryIcon,
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
 * Painel da citação aberta: dispositivo, documento, versão, badge do intervalo de vigência, texto
 * citado (`lang="pt-BR"`, também na UI em inglês), campos, link para a fonte oficial, "copiar
 * citação", "reportar", o link para a página do dispositivo e, no próprio painel, a linha do tempo
 * e o "O que mudou" (diff sob demanda) na data de referência da resposta.
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
    <article aria-labelledby={titleId} className="flex flex-col gap-4 px-4 pb-6">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs" aria-live="polite">
          {t('position', { current: selection.index + 1, total })}
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('previous')}
            aria-keyshortcuts="["
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
            disabled={selection.index >= total - 1}
            onClick={() => onStep(1)}
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
      </div>

      <header className="flex flex-col gap-2">
        <h3 id={titleId} className="font-medium font-serif text-base" lang="pt-BR">
          {citation.label}
        </h3>
        <ValidityBadge interval={citation.validity} today={today} className="self-start" />
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
            className="whitespace-pre-line border-l-2 border-accent-border pl-3 font-serif text-[15px] leading-relaxed"
          >
            {citation.excerpt}
          </blockquote>
        </section>
      )}

      <table className="w-full text-sm">
        <caption className="sr-only">{t('fields')}</caption>
        <tbody>
          <tr className="border-b">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted-foreground">
              {t('document')}
            </th>
            <td className="py-1.5" lang="pt-BR">
              {citation.document.title}
            </td>
          </tr>
          <tr className="border-b">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted-foreground">
              {t('version')}
            </th>
            <td className="py-1.5" lang="pt-BR">
              {citation.document.versionLabel}
            </td>
          </tr>
          <tr className="border-b">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted-foreground">
              {t('family')}
            </th>
            <td className="py-1.5 font-mono">
              {citation.family} · {citation.jurisdiction}
            </td>
          </tr>
          <tr>
            <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted-foreground">
              {t('key')}
            </th>
            <td className="break-all py-1.5 font-mono text-xs">{citation.stableKey}</td>
          </tr>
        </tbody>
      </table>

      <div className="flex flex-wrap gap-2">
        <a
          href={citation.document.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <ExternalLinkIcon aria-hidden="true" />
          {t('source')}
        </a>
        <a
          href={provisionHref(locale, citation.stableKey, selection.referenceDate)}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <HistoryIcon aria-hidden="true" />
          {t('openProvision')}
        </a>
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          <CopyIcon aria-hidden="true" />
          {t('copy')}
        </Button>
        {questionId !== null && (
          <Button
            variant="outline"
            size="sm"
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
