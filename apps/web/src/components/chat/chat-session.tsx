'use client'

import { useChat } from '@ai-sdk/react'
import { useQueryClient } from '@tanstack/react-query'
import type { Citation } from '@teko/shared/contracts'
import { idSchema } from '@teko/shared/contracts'
import { ErrorCode } from '@teko/shared/errors'
import {
  type IsoDate,
  isoDateInTimeZone,
  type PeriodoApuracao,
  type ReferenceInput,
  referenceDateFromInput,
} from '@teko/shared/vigencia'
import { MessageSquareTextIcon } from 'lucide-react'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { useQueryStates } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { type ChatRequestContext, TekoChatTransport } from '@/lib/api/chat-transport'
import { useQuestion, useQuota } from '@/lib/api/hooks'
import { rereadQuestion } from '@/lib/api/mutations'
import { refreshAfterQuestion } from '@/lib/api/queries'
import { blocksComposer, chatFailure } from '@/lib/chat/failure'
import {
  answerView,
  chatDataPartSchemas,
  messageText,
  questionDetailMessages,
  type TekoUIMessage,
} from '@/lib/chat/parts'
import { type ReferenceChoice, referenceRequest } from '@/lib/chat/reference'
import {
  isApplePlatform,
  isComposerShortcut,
  isEditableTarget,
  isReferenceShortcut,
  submitShortcutLabel,
} from '@/lib/hotkeys'
import { chatSearchParams } from '@/lib/url-state'
import { BlockErrorBoundary } from './block-error-boundary.tsx'
import { Composer } from './composer.tsx'
import { AnswerSkeleton, AssistantMessage, UserBubble } from './message.tsx'
import { Suggestions } from './suggestions.tsx'

export interface ChatSessionProps {
  /** Abre o painel de citação com as citações da resposta e a posição escolhida. */
  readonly onOpenCitation: (
    citations: readonly Citation[],
    index: number,
    questionId: string | null,
    referenceDate: IsoDate | null,
  ) => void
  /** Citação aberta no painel (destaca o chip). */
  readonly selectedCitationId: string | null
  /**
   * Trava o composer por fora, sem mensagem própria: ponto de encaixe do onboarding da autenticação
   * (`useSession().composerBlocked`), que mostra o motivo onde ele vive.
   */
  readonly composerLocked?: boolean
}

function isUuid(value: string): boolean {
  return idSchema.safeParse(value).success
}

/** Data de referência efetiva da escolha (o período resolve para o dia 1). */
function effectiveDate(choice: ReferenceChoice, today: IsoDate): IsoDate {
  const request = referenceRequest(choice, today)
  return 'periodoApuracao' in request
    ? referenceDateFromInput({ periodoApuracao: request.periodoApuracao })
    : request.referenceDate
}

/** Data inferida do texto como escolha do chip: dia 1 vira período, outra data fica exata. */
function inferredChoice(date: IsoDate): ReferenceInput {
  return date.endsWith('-01') ? { periodoApuracao: date.slice(0, 7) } : { referenceDate: date }
}

/**
 * Conversa: thread e composer sobre o `useChat` com o `TekoChatTransport`. Estado na URL (nuqs):
 * `c` (conversa, o `chatId`), `q` (última pergunta, relida de `GET /questions/:id` ao abrir) e
 * `ref` (data de referência do chip). Carregado só no navegador (`lazy` dentro do `ClientOnly`), fora do
 * primeiro carregamento.
 */
export default function ChatSession({
  onOpenCitation,
  selectedCitationId,
  composerLocked = false,
}: ChatSessionProps) {
  const t = useTranslations('chat')
  const tPage = useTranslations('pages.chat')
  const tErrors = useTranslations('errors')
  const format = useFormatter()
  const locale = useLocale()
  const [{ c, q, ref }, setUrl] = useQueryStates(chatSearchParams)
  const queryClient = useQueryClient()
  const [today] = useState(() => isoDateInTimeZone(new Date()))
  const [conversationId] = useState(() => c ?? crypto.randomUUID())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const contextRef = useRef<ChatRequestContext>({ locale, reference: referenceRequest(ref, today) })
  const [restored, setRestored] = useState(false)
  const [transport] = useState(() => new TekoChatTransport({ context: () => contextRef.current }))

  useEffect(() => {
    contextRef.current = { locale, reference: referenceRequest(ref, today) }
  }, [locale, ref, today])

  const { messages, sendMessage, regenerate, status, stop, error, setMessages, clearError } =
    useChat<TekoUIMessage>({
      id: conversationId,
      transport,
      dataPartSchemas: chatDataPartSchemas,
      onFinish: ({ message, isAbort, isError }) => {
        if (!isAbort && !isError && isUuid(message.id)) {
          void setUrl({ q: message.id, c: conversationId })
        }
        // A pergunta já está gravada: o histórico e a cota do dia mudaram.
        void refreshAfterQuestion(queryClient)
      },
    })
  const busy = status === 'submitted' || status === 'streaming'
  const failure = chatFailure(error)
  const quota = useQuota(blocksComposer(failure))
  const resetAt = failure?.resetAt ?? quota.data?.resetAt ?? null
  const blocked = blocksComposer(failure) && (resetAt === null || Date.parse(resetAt) > now)

  // Pergunta da URL ao abrir: relida do histórico (`GET /questions/:id`), uma vez.
  const restore = useQuestion(!restored && messages.length === 0 ? q : null)
  useEffect(() => {
    if (restore.data !== undefined && !restored && messages.length === 0) {
      setRestored(true)
      setMessages(questionDetailMessages(restore.data))
    }
  }, [restore.data, restored, messages.length, setMessages])

  // O markdown carrega sob demanda; começa a baixar assim que a conversa abre.
  useEffect(() => {
    void import('./answer-markdown.tsx')
  }, [])

  // Desbloqueia o composer quando a cota volta.
  useEffect(() => {
    if (!blocked || resetAt === null) return
    const wait = Math.min(Math.max(Date.parse(resetAt) - Date.now(), 0), 2 ** 31 - 1)
    const timer = setTimeout(() => setNow(Date.now()), wait)
    return () => clearTimeout(timer)
  }, [blocked, resetAt])

  // Região viva: anuncia o início e o fim de cada resposta (WCAG 4.1.3).
  const previousStatus = useRef(status)
  const stoppedRef = useRef(false)
  useEffect(() => {
    const previous = previousStatus.current
    previousStatus.current = status
    if (status === previous) return
    if (status === 'submitted') {
      stoppedRef.current = false
      setAnnouncement(t('thread.liveStart'))
    } else if (status === 'error') {
      setAnnouncement(t('thread.liveError'))
    } else if (status === 'ready' && previous !== 'error') {
      // `error` → `ready` é só o `clearError` antes de um novo envio: nada a anunciar.
      setAnnouncement(t(stoppedRef.current ? 'thread.liveStopped' : 'thread.liveDone'))
    }
  }, [status, t])

  // Acompanha o fim da conversa a cada mensagem nova e a cada pedaço do stream.
  const scrollKey = `${messages.length}:${messages.at(-1)?.parts.length ?? 0}:${status}`
  useEffect(() => {
    if (scrollKey !== '') endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [scrollKey])

  const askWith = useCallback(
    (text: string, reference: ReferenceChoice) => {
      contextRef.current = { locale, reference: referenceRequest(reference, today) }
      clearError()
      void setUrl({ c: conversationId })
      void sendMessage({ text })
    },
    [clearError, conversationId, locale, sendMessage, setUrl, today],
  )

  const stopAnswer = useCallback(() => {
    stoppedRef.current = true
    void stop()
  }, [stop])

  // Atalhos: `/` foca o composer, `Esc` para o stream, `Alt+D` abre a data de referência.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isReferenceShortcut(event)) {
        event.preventDefault()
        setPickerOpen(true)
      } else if (event.key === 'Escape' && busy) {
        stopAnswer()
      } else if (isComposerShortcut(event) && !isEditableTarget(event.target)) {
        event.preventDefault()
        textareaRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, stopAnswer])

  const lastAssistant = messages.findLast((message) => message.role === 'assistant')
  const lastView = lastAssistant === undefined ? null : answerView(lastAssistant)
  const inferred =
    ref === null && lastView?.reference?.source === 'question_text'
      ? lastView.reference.value
      : null
  const lastQuestion = messages.findLast((message) => message.role === 'user')
  const shortcutLabel = useMemo(
    () =>
      submitShortcutLabel(typeof navigator !== 'undefined' && isApplePlatform(navigator.platform)),
    [],
  )

  const blockedMessage = blocked
    ? t(
        failure?.code === ErrorCode.ServicePaused
          ? 'composer.blockedPaused'
          : 'composer.blockedQuota',
        {
          reset:
            resetAt === null
              ? t('composer.resetSoon')
              : t('composer.resetAt', {
                  time: format.dateTime(new Date(resetAt), {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }),
                }),
        },
      )
    : null

  async function reread(questionId: string): Promise<void> {
    const detail = await rereadQuestion(questionId).catch(() => null)
    if (detail === null) return
    const pair = questionDetailMessages(detail)
    if (pair.length < 2) return
    clearError()
    setMessages((current) => {
      const index = current.findIndex((message) => message.id === questionId)
      return index < 1
        ? current
        : [...current.slice(0, index - 1), ...pair, ...current.slice(index + 1)]
    })
  }

  const lastMessage = messages.at(-1)
  const waitingFirstChunk = busy && lastMessage?.role === 'user'
  const showFailure = failure !== null && !busy && !blocked

  return (
    <div className="flex min-h-full flex-col">
      <p aria-live="polite" role="status" className="sr-only" data-testid="chat-live">
        {announcement}
      </p>
      <section
        aria-label={t('thread.label')}
        aria-busy={busy}
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6"
      >
        {messages.length === 0 && !restore.isFetching && (
          <div className="flex flex-1 flex-col items-center justify-center gap-8">
            <EmptyState
              icon={<MessageSquareTextIcon />}
              title={tPage('emptyTitle')}
              headingLevel={1}
            >
              {tPage('emptyBody')}
            </EmptyState>
            <Suggestions
              disabled={busy || blocked || composerLocked}
              onAsk={(question, periodo: PeriodoApuracao) => {
                const reference = { periodoApuracao: periodo }
                void setUrl({ ref: reference })
                askWith(question, reference)
              }}
            />
          </div>
        )}
        {/* Com a conversa na tela, o título da página continua lá para quem navega por títulos. */}
        {(messages.length > 0 || restore.isFetching) && (
          <h1 className="sr-only">{tPage('title')}</h1>
        )}
        {messages.length === 0 && restore.isFetching && <AnswerSkeleton />}
        {messages.map((message, index) => (
          <BlockErrorBoundary key={message.id} fallback={t('thread.blockError')}>
            {message.role === 'user' ? (
              <UserBubble message={message} />
            ) : (
              <AssistantMessage
                message={message}
                streaming={busy && index === messages.length - 1}
                today={today}
                busy={busy}
                selectedCitationId={selectedCitationId}
                onOpenCitation={(citations, position) =>
                  onOpenCitation(
                    citations,
                    position,
                    isUuid(message.id) ? message.id : null,
                    answerView(message).reference?.value ?? null,
                  )
                }
                onClarify={(date) => {
                  clearError()
                  void sendMessage(
                    { text: lastQuestion === undefined ? '' : messageText(lastQuestion) },
                    { body: { clarifiedDate: date } },
                  )
                }}
                footer={
                  showFailure && index === messages.length - 1 && isUuid(message.id) ? (
                    <Button variant="outline" size="sm" onClick={() => void reread(message.id)}>
                      {t('thread.reread')}
                    </Button>
                  ) : undefined
                }
              />
            )}
          </BlockErrorBoundary>
        ))}
        {waitingFirstChunk && <AnswerSkeleton />}
        {showFailure && failure !== null && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-sm"
            data-chat-error={failure.code}
          >
            <p>{tErrors(failure.code)}</p>
            {failure.retryable && lastMessage?.role === 'user' && (
              <Button variant="outline" size="sm" onClick={() => void regenerate()}>
                {t('thread.retry')}
              </Button>
            )}
          </div>
        )}
        <div ref={endRef} />
      </section>
      <div className="sticky bottom-0 bg-background/95 px-4 pt-2 pb-4 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl">
          <Composer
            onSubmit={(text) => askWith(text, ref)}
            onStop={stopAnswer}
            busy={busy}
            blockedMessage={blockedMessage ?? (composerLocked ? '' : null)}
            reference={ref}
            referenceDate={effectiveDate(ref, today)}
            onReferenceChange={(choice) => void setUrl({ ref: choice })}
            pickerOpen={pickerOpen}
            onPickerOpenChange={setPickerOpen}
            inferredDate={inferred}
            onConfirmInferred={(date) => void setUrl({ ref: inferredChoice(date) })}
            today={today}
            shortcutLabel={shortcutLabel}
            textareaRef={textareaRef}
          />
        </div>
      </div>
    </div>
  )
}
