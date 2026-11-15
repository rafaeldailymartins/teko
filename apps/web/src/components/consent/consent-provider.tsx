'use client'

import { useLocale, useTranslations } from 'next-intl'
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { analytics } from '@/lib/analytics'
import {
  ACCEPT_ALL,
  CONSENT_CATEGORIES,
  CONSENT_CHANGE_EVENT,
  type ConsentChoices,
  type ConsentRecord,
  parseConsentRecord,
  REJECT_ALL,
  readConsentSnapshot,
  subscribeConsent,
  writeConsent,
} from '@/lib/consent/storage'
import { localePagePath } from '@/lib/navigation'

interface ConsentContextValue {
  /** Escolha vigente (`null` sem escolha ou antes da hidratação). */
  readonly consent: ConsentRecord | null
  /** Abre as preferências (link do rodapé). */
  readonly openPreferences: () => void
}

const ConsentContext = createContext<ConsentContextValue | null>(null)

function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Ainda no HTML estático: o servidor não conhece o storage, então nada de banner. */
const SERVER_SNAPSHOT = undefined

/**
 * Valor cru da escolha gravada. `undefined` no HTML estático e na hidratação (o banner não entra
 * no HTML e não há divergência); depois, a string gravada ou `null`.
 */
function useStoredConsent(): string | null | undefined {
  return useSyncExternalStore(
    (onChange) => subscribeConsent(window, onChange),
    () => readConsentSnapshot(browserStorage()),
    () => SERVER_SNAPSHOT,
  )
}

interface ConsentProviderProps {
  readonly children: ReactNode
}

/**
 * Camada de consentimento LGPD: banner na primeira visita (Aceitar, Recusar e Personalizar com o
 * mesmo peso), preferências por categoria e a ligação com o adapter de analytics, que só carrega
 * o SDK com `analytics: true`. Antes da escolha, nada é gravado no navegador.
 */
export function ConsentProvider({ children }: ConsentProviderProps) {
  const stored = useStoredConsent()
  // Storage bloqueado: a escolha vale para esta página, sem o banner voltar a cada clique.
  const [unsaved, setUnsaved] = useState<ConsentRecord | null>(null)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  // Cada abertura remonta as preferências, que partem da escolha vigente (não de um rascunho).
  const [preferencesSession, setPreferencesSession] = useState(0)
  const consent = useMemo(() => parseConsentRecord(stored) ?? unsaved, [stored, unsaved])
  const hydrated = stored !== SERVER_SNAPSHOT

  useEffect(() => {
    if (hydrated) {
      void analytics.applyConsent(consent)
    }
  }, [hydrated, consent])

  function decide(choices: ConsentChoices): void {
    const { record, persisted } = writeConsent(browserStorage(), choices)
    setUnsaved(persisted ? null : record)
    setPreferencesOpen(false)
    window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT))
    void analytics.applyConsent(record).then(() => {
      // Sem cliente carregado (recusa, ou sem chave), o adapter descarta o evento.
      analytics.capture('consent_updated', { analytics: record.choices.analytics })
    })
  }

  function openPreferences(): void {
    setPreferencesSession((session) => session + 1)
    setPreferencesOpen(true)
  }

  const contextValue: ConsentContextValue = { consent, openPreferences }

  return (
    <ConsentContext value={contextValue}>
      {hydrated && consent === null && !preferencesOpen ? (
        <ConsentBanner
          onAccept={() => decide(ACCEPT_ALL)}
          onReject={() => decide(REJECT_ALL)}
          onCustomize={openPreferences}
        />
      ) : null}
      {children}
      {hydrated ? (
        <ConsentPreferences
          key={preferencesSession}
          open={preferencesOpen}
          onOpenChange={setPreferencesOpen}
          initial={consent?.choices ?? REJECT_ALL}
          onSave={decide}
        />
      ) : null}
    </ConsentContext>
  )
}

interface ConsentBannerProps {
  readonly onAccept: () => void
  readonly onReject: () => void
  readonly onCustomize: () => void
}

/**
 * Banner fixo no rodapé da janela (sem deslocar o layout). Os três botões têm a mesma variante e
 * o mesmo tamanho: recusar custa o mesmo clique que aceitar.
 */
function ConsentBanner({ onAccept, onReject, onCustomize }: ConsentBannerProps) {
  const t = useTranslations('consent.banner')
  const locale = useLocale()
  const titleId = useId()

  return (
    <section
      aria-labelledby={titleId}
      data-testid="consent-banner"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-popover text-popover-foreground shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-1 text-sm">
          <h2 id={titleId} className="font-medium text-base">
            {t('title')}
          </h2>
          <p className="text-muted-foreground">
            {t.rich('body', {
              privacy: (chunks) => (
                <a
                  href={localePagePath(locale, 'privacy')}
                  className="text-foreground underline underline-offset-4"
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
        <div className="grid shrink-0 grid-cols-3 gap-2 sm:flex">
          <Button variant="outline" size="lg" onClick={onReject}>
            {t('reject')}
          </Button>
          <Button variant="outline" size="lg" onClick={onCustomize}>
            {t('customize')}
          </Button>
          <Button variant="outline" size="lg" onClick={onAccept}>
            {t('accept')}
          </Button>
        </div>
      </div>
    </section>
  )
}

interface ConsentPreferencesProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly initial: ConsentChoices
  readonly onSave: (choices: ConsentChoices) => void
}

/** Preferências por categoria. Os necessários aparecem sempre ligados e sem controle. */
function ConsentPreferences({ open, onOpenChange, initial, onSave }: ConsentPreferencesProps) {
  const t = useTranslations('consent.preferences')
  const [draft, setDraft] = useState<ConsentChoices>(initial)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y rounded-lg border">
          <li className="flex items-start justify-between gap-4 p-3">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{t('necessary.title')}</span>
              <span className="text-muted-foreground">{t('necessary.body')}</span>
            </div>
            <span className="shrink-0 text-muted-foreground text-xs">{t('necessary.status')}</span>
          </li>
          {CONSENT_CATEGORIES.map((category) => (
            <ConsentCategoryRow
              key={category}
              title={t(`${category}.title`)}
              body={t(`${category}.body`)}
              checked={draft[category]}
              onCheckedChange={(checked) => setDraft({ ...draft, [category]: checked })}
            />
          ))}
        </ul>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button variant="outline" onClick={() => onSave(REJECT_ALL)}>
            {t('rejectAll')}
          </Button>
          <Button variant="outline" onClick={() => onSave(draft)}>
            {t('save')}
          </Button>
          <Button variant="outline" onClick={() => onSave(ACCEPT_ALL)}>
            {t('acceptAll')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface ConsentCategoryRowProps {
  readonly title: string
  readonly body: string
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
}

/** Uma categoria opcional: o switch leva o título como nome e a descrição como descrição. */
function ConsentCategoryRow({ title, body, checked, onCheckedChange }: ConsentCategoryRowProps) {
  const titleId = useId()
  const bodyId = useId()
  return (
    <li className="flex items-start justify-between gap-4 p-3">
      <div className="flex flex-col gap-0.5">
        <span id={titleId} className="font-medium">
          {title}
        </span>
        <span id={bodyId} className="text-muted-foreground">
          {body}
        </span>
      </div>
      <Switch
        className="mt-0.5"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </li>
  )
}

interface ConsentPreferencesButtonProps {
  readonly className?: string
}

/**
 * Link "Preferências de cookies" (rodapé): reabre as preferências a qualquer momento. Fora do
 * `ConsentProvider` (documentos sem os providers) não aparece.
 */
export function ConsentPreferencesButton({ className }: ConsentPreferencesButtonProps) {
  const t = useTranslations('consent')
  const context = use(ConsentContext)
  if (context === null) {
    return null
  }
  return (
    <button type="button" className={className} onClick={context.openPreferences}>
      {t('footerLink')}
    </button>
  )
}
