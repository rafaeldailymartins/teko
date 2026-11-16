'use client'

import type { Citation } from '@teko/shared/contracts'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { answerClipboardText } from '@/lib/chat/markdown'
import { FeedbackButtons } from './feedback-buttons.tsx'

interface AnswerActionsProps {
  readonly questionId: string | null
  /** Markdown da resposta; `null` na recusa (nada a copiar). */
  readonly markdown: string | null
  readonly citations: readonly Citation[]
}

/**
 * Ações discretas ao pé de uma resposta pronta: copiar o texto com as fontes numeradas e avaliar
 * (👍/👎). Ficam em tom apagado e ganham cor no hover da resposta.
 */
export function AnswerActions({ questionId, markdown, citations }: AnswerActionsProps) {
  const t = useTranslations('chat')
  const [copied, setCopied] = useState(false)

  async function copy(): Promise<void> {
    if (markdown === null) return
    await navigator.clipboard?.writeText(
      answerClipboardText(markdown, citations, t('answer.citations')),
    )
    setCopied(true)
  }

  return (
    <div className="flex items-center gap-0.5 opacity-80 transition-opacity duration-150 group-hover/answer:opacity-100 has-focus-visible:opacity-100">
      {markdown !== null && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('answer.copy')}
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        </Button>
      )}
      {questionId !== null && <FeedbackButtons questionId={questionId} />}
      <span role="status" className="sr-only">
        {copied ? t('answer.copied') : ''}
      </span>
    </div>
  )
}
