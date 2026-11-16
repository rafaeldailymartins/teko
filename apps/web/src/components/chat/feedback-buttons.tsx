'use client'

import { useMutation } from '@tanstack/react-query'
import { FeedbackRating } from '@teko/shared/contracts'
import { ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { analytics } from '@/lib/analytics'
import { submitFeedback } from '@/lib/api/mutations'
import { cn } from '@/lib/utils'

/**
 * 👍/👎 de uma resposta (`POST /questions/:id/feedback`), sem texto livre: nada de PII. Discretos
 * (botões fantasma); depois do envio, fica só o polegar escolhido, preenchido, e o agradecimento.
 */
export function FeedbackButtons({ questionId }: { readonly questionId: string }) {
  const t = useTranslations('chat.feedback')
  const feedback = useMutation({
    mutationFn: submitFeedback,
    onSuccess: (_data, { rating, reason }) => {
      analytics.capture('answer_feedback', reason === undefined ? { rating } : { rating, reason })
    },
  })
  const chosen = feedback.variables?.rating

  if (feedback.isSuccess) {
    const Icon = chosen === FeedbackRating.Down ? ThumbsDownIcon : ThumbsUpIcon
    return (
      <p
        role="status"
        className="inline-flex items-center gap-1.5 px-1.5 text-muted-foreground text-xs"
      >
        <Icon aria-hidden="true" className="size-3.5 fill-current text-validity-current" />
        {t('thanks')}
      </p>
    )
  }
  return (
    <fieldset className="flex items-center gap-0.5" disabled={feedback.isPending}>
      <legend className="sr-only">{t('label')}</legend>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('up')}
        aria-pressed={chosen === FeedbackRating.Up}
        onClick={() => feedback.mutate({ questionId, rating: FeedbackRating.Up })}
      >
        <ThumbsUpIcon
          aria-hidden="true"
          className={cn(chosen === FeedbackRating.Up && 'fill-current')}
        />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('down')}
        aria-pressed={chosen === FeedbackRating.Down}
        onClick={() => feedback.mutate({ questionId, rating: FeedbackRating.Down })}
      >
        <ThumbsDownIcon
          aria-hidden="true"
          className={cn(chosen === FeedbackRating.Down && 'fill-current')}
        />
      </Button>
    </fieldset>
  )
}
