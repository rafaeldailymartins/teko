'use client'

import type { PeriodoApuracao } from '@teko/shared/vigencia'
import { ArrowUpRightIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { DATE_COMPARISON_SUGGESTION, SUGGESTIONS } from '@/lib/chat/suggestions'
import { formatTaxPeriod } from '@/lib/i18n/format'
import { cn } from '@/lib/utils'

interface SuggestionsProps {
  readonly onAsk: (question: string, periodo: PeriodoApuracao) => void
  readonly disabled?: boolean
}

const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50'

/** Período em que a sugestão será feita: o ponto âmbar da data e o mês em mono. */
function PeriodMark({
  period,
  className,
}: {
  readonly period: string
  readonly className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums',
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-date-mark" />
      {period}
    </span>
  )
}

/**
 * Sugestões do chat vazio em linhas finas, todas diferentes: a mesma pergunta em duas datas (a do
 * DoD, um botão por período) e uma pergunta de cada outra família do corpus, já com o período de
 * apuração certo, que vai para o chip ao enviar.
 */
export function Suggestions({ onAsk, disabled }: SuggestionsProps) {
  const t = useTranslations('chat.suggestions')
  const locale = useLocale()
  const featured = DATE_COMPARISON_SUGGESTION
  const featuredQuestion = t(`questions.${featured.question}`)

  return (
    <section aria-labelledby="chat-suggestions" className="w-full">
      <h2 id="chat-suggestions" className="sr-only">
        {t('title')}
      </h2>
      <ul className="flex flex-col divide-y divide-border/70">
        <li
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5"
          data-suggestion={featured.id}
        >
          <span className="min-w-0 flex-1 text-pretty text-[0.9375rem]" lang="pt-BR">
            {featuredQuestion}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {featured.periods.map((periodo) => (
              <button
                key={periodo}
                type="button"
                disabled={disabled}
                onClick={() => onAsk(featuredQuestion, periodo)}
                className={cn(
                  'inline-flex h-7 items-center rounded-full border border-accent-border/60 px-2.5 transition-colors duration-150 ease-out-soft text-muted-foreground hover:border-accent-border hover:bg-accent hover:text-accent-foreground',
                  FOCUS_RING,
                )}
              >
                <span className="sr-only">{t('askPrefix')} </span>
                <PeriodMark period={formatTaxPeriod(locale, periodo)} />
              </button>
            ))}
          </span>
        </li>
        {SUGGESTIONS.map((suggestion) => {
          const question = t(`questions.${suggestion.question}`)
          return (
            <li key={suggestion.id} data-suggestion={suggestion.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAsk(question, suggestion.period)}
                className={cn(
                  'group/row flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-foreground transition-colors duration-150 ease-out-soft hover:bg-muted/70',
                  FOCUS_RING,
                )}
              >
                <span className="min-w-0 flex-1 text-pretty text-[0.9375rem]" lang="pt-BR">
                  {question}
                </span>
                <PeriodMark
                  period={formatTaxPeriod(locale, suggestion.period)}
                  className="text-muted-foreground"
                />
                <ArrowUpRightIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
                />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
