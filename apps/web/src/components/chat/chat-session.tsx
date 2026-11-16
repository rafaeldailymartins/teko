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
import { ArrowDownIcon, CircleAlertIcon, RotateCwIcon } from 'lucide-react'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { useQueryStates } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { type ChatRequestContext, TekoChatTransport } from '@/lib/api/chat-transport'
import { useHistory, useQuestion, useQuota } from '@/lib/api/hooks'
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
import { type ReferenceChoice, referenceDisplay, referenceRequest } from '@/lib/chat/reference'
import {
  isApplePlatform,
  isComposerShortcut,
  isEditableTarget,
  isReferenceShortcut,
  submitShortcutLabel,
} from '@/lib/hotkeys'
import { formatIsoDate, formatTaxPeriod } from '@/lib/i18n/format'
import { chatSearchParams } from '@/lib/url-state'
import { cn } from '@/lib/utils'
import { BlockErrorBoundary } from './block-error-boundary.tsx'
import { ChatWelcome } from './chat-welcome.tsx'
import { Composer } from './composer.tsx'
import { AnswerSkeleton, AssistantMessage, UserBubble } from './message.tsx'
import { Suggestions } from './suggestions.tsx'
import { useStickToBottom } from './use-stick-to-bottom.ts'

export interface ChatSessionProps {
  /** Conversa desta sessão (o `chatId`); a área de trabalho troca a sessão ao trocar de conversa. */
  readonly conversationId: string
  /** A conversa veio da URL (`c`): relê as perguntas dela do histórico ao abrir. */
  readonly restoreConversation: boolean
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
 * `c` (conversa, o `chatId`), `q` (última pergunta) e `ref` (data de referência do chip). Ao abrir
 * uma conversa da URL, relê as perguntas dela (`GET /questions?conversationId=`); só com `q`, relê
 * a pergunta (`GET /questions/:id`). Sem conversa, a abertura (saudação e uma linha) com o composer
 * no meio e as sugestões embaixo; com conversa, o composer desce e fica fixo embaixo. O aviso de que
 * o Tekó não constitui parecer fica numa linha pequena logo abaixo do composer, sempre à vista.
 * Carregado só no navegador (`lazy` dentro do `ClientOnly`), fora do primeiro carregamento.
 */
export default function ChatSession({
  conversationId,
  restoreConversation,
  onOpenCitation,
  selectedCitationId,
  composerLocked = false,
}: ChatSessionProps) {
  const t = useTranslations('chat')
  const tPage = useTranslations('pages.chat')
  const tErrors = useTranslations('errors')
  const tCommon = useTranslations('common')
  const format = useFormatter()
  const locale = useLocale()
  const [{ q, ref }, setUrl] = useQueryStates(chatSearchParams)
  const queryClient = useQueryClient()
  const [today] = useState(() => isoDateInTimeZone(new Date()))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
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

  // Ao abrir: as perguntas da conversa da URL (histórico) ou, sem ela, a pergunta `q`. Uma vez.
  const pending = !restored && messages.length === 0
  const restoreHistory = useHistory(pending && restoreConversation ? conversationId : null)
  const restoreQuestion = useQuestion(pending && !restoreConversation ? q : null)
  useEffect(() => {
    if (!pending) return
    if (restoreHistory.data !== undefined) {
      setRestored(true)
      setMessages(restoreHistory.data.items.flatMap((item) => questionDetailMessages(item)))
    } else if (restoreQuestion.data !== undefined) {
      setRestored(true)
      setMessages(questionDetailMessages(restoreQuestion.data))
    }
  }, [pending, restoreHistory.data, restoreQuestion.data, setMessages])
  const restoring = pending && (restoreHistory.isFetching || restoreQuestion.isFetching)
  const restoreFailed = pending && restoreHistory.isError

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

  // Acompanha o fim da conversa a cada mensagem nova e a cada pedaço do stream, só se o usuário
  // estiver no fim (subiu para reler: a conversa fica parada e aparece "Ir para o fim").
  const lastText = messages
    .at(-1)
    ?.parts.reduce((size, part) => size + (part.type === 'text' ? part.text.length : 1), 0)
  // Sem conversa, nada a acompanhar: a abertura fica no topo.
  const scrollKey = messages.length === 0 ? '' : `${messages.length}:${lastText ?? 0}:${status}`
  const { atEnd, scrollToEnd } = useStickToBottom(anchorRef, scrollKey)

  const askWith = useCallback(
    (text: string, reference: ReferenceChoice) => {
      contextRef.current = { locale, reference: referenceRequest(reference, today) }
      clearError()
      void setUrl({ c: conversationId })
      void sendMessage({ text })
      scrollToEnd()
    },
    [clearError, conversationId, locale, scrollToEnd, sendMessage, setUrl, today],
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
      } else if (event.key === 'Escape' && busy && !event.defaultPrevented) {
        // Marcado como tratado: o mesmo `Esc` não fecha também a citação aberta.
        event.preventDefault()
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

  const display = referenceDisplay(ref, today)
  const thinkingDate =
    display.kind === 'periodo'
      ? formatTaxPeriod(locale, display.periodo)
      : formatIsoDate(locale, display.date, 'numeric')
  const lastMessage = messages.at(-1)
  const waitingFirstChunk = busy && lastMessage?.role === 'user'
  const showFailure = failure !== null && !busy && !blocked
  const empty = messages.length === 0 && !restoring
  const composerDisabled = busy || blocked || composerLocked

  return (
    <div className={cn('flex min-h-full flex-col', empty && 'justify-center')}>
      <p aria-live="polite" role="status" className="sr-only" data-testid="chat-live">
        {announcement}
      </p>
      {empty ? (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-10 pb-7 sm:pt-14">
          <ChatWelcome />
          {restoreFailed && (
            <div
              role="alert"
              className="mx-auto flex max-w-xl items-center gap-2 rounded-xl border border-destructive/40 bg-popover px-3 py-2 text-sm"
            >
              <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0 text-destructive" />
              <p>{t('thread.restoreError')}</p>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => void restoreHistory.refetch()}
              >
                {t('thread.retry')}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <section
          aria-label={t('thread.label')}
          aria-busy={busy}
          className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 pt-8 pb-10"
        >
          {/* Com a conversa na tela, o título da página continua lá para quem navega por títulos. */}
          <h1 className="sr-only">{tPage('title')}</h1>
          {messages.length === 0 && restoring && <AnswerSkeleton label={t('thread.restoring')} />}
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
                        <RotateCwIcon aria-hidden="true" />
                        {t('thread.reread')}
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </BlockErrorBoundary>
          ))}
          {waitingFirstChunk && (
            <AnswerSkeleton label={t('thread.thinking', { date: thinkingDate })} />
          )}
          {showFailure && failure !== null && (
            <div
              role="alert"
              className="flex max-w-[70ch] flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-popover px-4 py-3 text-sm shadow-soft"
              data-chat-error={failure.code}
            >
              <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0 text-destructive" />
              <p className="min-w-0 flex-1">{tErrors(failure.code)}</p>
              {failure.retryable && lastMessage?.role === 'user' && (
                <Button variant="outline" size="sm" onClick={() => void regenerate()}>
                  <RotateCwIcon aria-hidden="true" />
                  {t('thread.retry')}
                </Button>
              )}
            </div>
          )}
        </section>
      )}
      <div ref={anchorRef} />
      <div
        className={cn(
          'z-10 px-4 pb-2',
          empty
            ? 'pt-0'
            : 'sticky bottom-0 bg-linear-to-t from-background from-70% to-transparent pt-6',
        )}
      >
        <div className="relative mx-auto w-full max-w-3xl">
          {!empty && !atEnd && (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t('thread.toEnd')}
              onClick={() => scrollToEnd('smooth')}
              className="-top-11 absolute left-1/2 -translate-x-1/2 rounded-full shadow-raised"
            >
              <ArrowDownIcon aria-hidden="true" />
            </Button>
          )}
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
          <p className="pt-2 text-center text-muted-foreground text-xs" data-disclaimer="">
            {tCommon('disclaimer')}
          </p>
        </div>
      </div>
      {empty && (
        <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-12">
          <Suggestions
            disabled={composerDisabled}
            onAsk={(question, periodo: PeriodoApuracao) => {
              const reference = { periodoApuracao: periodo }
              void setUrl({ ref: reference })
              askWith(question, reference)
              // A abertura sai da tela com o envio: o foco vai para o composer, não para o nada.
              textareaRef.current?.focus()
            }}
          />
        </div>
      )}
    </div>
  )
}
