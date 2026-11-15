'use client'

import type { PeriodoApuracao } from '@teko/shared/vigencia'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { formatPeriodo } from '@/lib/chat/format'
import { DATE_SENSITIVE_SUGGESTIONS } from '@/lib/chat/suggestions'

interface SuggestionsProps {
  readonly onAsk: (question: string, periodo: PeriodoApuracao) => void
  readonly disabled?: boolean
}

/** Sugestões do chat vazio: a mesma pergunta em dois períodos com redações diferentes. */
export function Suggestions({ onAsk, disabled }: SuggestionsProps) {
  const t = useTranslations('chat.suggestions')
  return (
    <section aria-labelledby="chat-suggestions" className="flex w-full max-w-xl flex-col gap-3">
      <div>
        <h2 id="chat-suggestions" className="font-medium text-sm">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('body')}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {DATE_SENSITIVE_SUGGESTIONS.map((suggestion) => {
          const question = t(`questions.${suggestion.question}`)
          return (
            <li
              key={suggestion.id}
              className="flex flex-col gap-2 rounded-lg border bg-surface p-3"
              data-suggestion={suggestion.id}
            >
              <p className="font-serif" lang="pt-BR">
                {question}
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestion.periods.map((periodo) => (
                  <Button
                    key={periodo}
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onAsk(question, periodo)}
                  >
                    {t('ask', { period: formatPeriodo(periodo) })}
                  </Button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
