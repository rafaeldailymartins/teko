'use client'

import { useMutation } from '@tanstack/react-query'
import { FeedbackRating } from '@teko/shared/contracts'
import { ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { submitFeedback } from '@/lib/api/mutations'

/** 👍/👎 de uma resposta (`POST /questions/:id/feedback`), sem texto livre: nada de PII. */
export function FeedbackButtons({ questionId }: { readonly questionId: string }) {
  const t = useTranslations('chat.feedback')
  const feedback = useMutation({ mutationFn: submitFeedback })
  const chosen = feedback.variables?.rating

  if (feedback.isSuccess) {
    return (
      <p role="status" className="text-muted-foreground text-xs">
        {t('thanks')}
      </p>
    )
  }
  return (
    <fieldset className="flex items-center gap-1" disabled={feedback.isPending}>
      <legend className="sr-only">{t('label')}</legend>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('up')}
        aria-pressed={chosen === FeedbackRating.Up}
        onClick={() => feedback.mutate({ questionId, rating: FeedbackRating.Up })}
      >
        <ThumbsUpIcon aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('down')}
        aria-pressed={chosen === FeedbackRating.Down}
        onClick={() => feedback.mutate({ questionId, rating: FeedbackRating.Down })}
      >
        <ThumbsDownIcon aria-hidden="true" />
      </Button>
    </fieldset>
  )
}
