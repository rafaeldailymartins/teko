'use client'

import type { PeriodoApuracao } from '@teko/shared/vigencia'
import {
  ArrowUpRightIcon,
  FileSpreadsheetIcon,
  LandmarkIcon,
  type LucideIcon,
  MapPinIcon,
  ReceiptTextIcon,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import {
  DATE_COMPARISON_SUGGESTION,
  SUGGESTIONS,
  type SuggestionFamily,
} from '@/lib/chat/suggestions'
import { formatTaxPeriod } from '@/lib/i18n/format'
import { cn } from '@/lib/utils'

/** Ícone de cada família do corpus (cartões de sugestão). */
const FAMILY_ICONS: Readonly<Record<SuggestionFamily, LucideIcon>> = {
  rcte: LandmarkIcon,
  'efd-icms-ipi': FileSpreadsheetIcon,
  'efd-reinf': ReceiptTextIcon,
  'efd-go': MapPinIcon,
}

function FamilyIcon({ family }: { readonly family: SuggestionFamily }) {
  const Icon = FAMILY_ICONS[family]
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-leaf-soft text-validity-current ring-1 ring-leaf/25"
    >
      <Icon className="size-4" />
    </span>
  )
}

interface SuggestionsProps {
  readonly onAsk: (question: string, periodo: PeriodoApuracao) => void
  readonly disabled?: boolean
}

/**
 * Sugestões do chat vazio: em destaque, a mesma pergunta em duas datas (a do DoD, com o fio da linha
 * do tempo entre elas) e, abaixo, uma pergunta de cada família do corpus, já com o período de
 * apuração certo. Nenhuma pergunta se repete.
 */
export function Suggestions({ onAsk, disabled }: SuggestionsProps) {
  const t = useTranslations('chat.suggestions')
  const locale = useLocale()
  const featured = DATE_COMPARISON_SUGGESTION
  const featuredQuestion = t(`questions.${featured.question}`)
  const [before, after] = featured.periods

  return (
    <section aria-labelledby="chat-suggestions" className="@container flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="chat-suggestions" className="font-semibold font-serif text-lg tracking-tight">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('body')}</p>
      </div>
      <ul className="grid gap-3 @xl:grid-cols-2">
        <li
          className="relative overflow-hidden rounded-xl border border-border/70 bg-popover p-4 shadow-raised @xl:col-span-2"
          data-suggestion={featured.id}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-brand-glow opacity-70"
          />
          <div className="relative flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <FamilyIcon family={featured.family} />
              <span className="font-medium text-muted-foreground text-xs">
                {t(`families.${featured.family}`)}
              </span>
              <Badge tone="accent" size="sm" className="ml-auto">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-date-mark" />
                {t('compareTitle')}
              </Badge>
            </div>
            <p className="font-serif text-[1.0625rem] leading-snug" lang="pt-BR">
              {featuredQuestion}
            </p>
            <p className="text-muted-foreground text-sm">{t('compareBody')}</p>
            <div className="flex flex-col gap-2 @md:flex-row @md:items-center @md:gap-3">
              {[before, after].map((periodo, index) => (
                <div key={periodo} className="contents">
                  {index === 1 && (
                    <span
                      aria-hidden="true"
                      className="timeline-rule hidden h-px min-w-8 flex-1 @md:block"
                    />
                  )}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onAsk(featuredQuestion, periodo)}
                    className="group/ask inline-flex h-9 items-center justify-center gap-2 rounded-full border border-accent-border/60 bg-popover px-3.5 font-medium text-sm shadow-soft outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-out-soft hover:border-accent-border hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span aria-hidden="true" className="size-2 rounded-full bg-date-mark" />
                    <span className="tabular-nums">
                      {t('ask', { period: formatTaxPeriod(locale, periodo) })}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </div>
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
                  'group/card flex h-full w-full flex-col gap-2.5 rounded-xl border bg-popover p-3.5 text-left shadow-soft outline-none',
                  'transition-[border-color,box-shadow,transform] duration-200 ease-out-soft hover:-translate-y-px hover:border-border-strong/50 hover:shadow-raised',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
                )}
              >
                <span className="flex items-center gap-2">
                  <FamilyIcon family={suggestion.family} />
                  <span className="font-medium text-muted-foreground text-xs">
                    {t(`families.${suggestion.family}`)}
                  </span>
                  <ArrowUpRightIcon
                    aria-hidden="true"
                    className="ml-auto size-4 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 group-focus-visible/card:opacity-100"
                  />
                </span>
                <span className="text-pretty text-[0.9375rem] leading-snug" lang="pt-BR">
                  {question}
                </span>
                <span className="mt-auto inline-flex items-center gap-1.5 text-muted-foreground text-xs">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-date-mark" />
                  <span>
                    {t.rich('period', {
                      period: formatTaxPeriod(locale, suggestion.period),
                      date: (chunks) => (
                        <span className="font-medium font-mono tabular-nums">{chunks}</span>
                      ),
                    })}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
