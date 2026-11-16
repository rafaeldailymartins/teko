'use client'

import { stableKeySchema } from '@teko/shared/contracts'
import { compareIsoDates, type IsoDate, isoDateSchema } from '@teko/shared/vigencia'
import {
  BookOpenTextIcon,
  CalendarIcon,
  CircleAlertIcon,
  GitCompareArrowsIcon,
  SparklesIcon,
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useQueryStates } from 'nuqs'
import { type FormEvent, Suspense, useId, useState } from 'react'
import { AppPageHeader } from '@/components/app-page-header'
import { ProvisionDiff } from '@/components/provision/provision-diff'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { referenceKeyDate } from '@/lib/api/reference'
import { compareHref, compareSearchParams, provisionHref } from '@/lib/url-state'
import { cn } from '@/lib/utils'

/** O exemplo do roteiro: o § 6º do art. 76 do RCTE mudou em 23/11/2009. */
const EXAMPLE = {
  k: 'go:rcte:art:76:par:6',
  from: { periodoApuracao: '2008-05' },
  to: { periodoApuracao: '2010-01' },
} as const

type FormError = 'invalidKey' | 'invalidRange' | null

const FIELD_CLASSES =
  'h-10 w-full rounded-lg border border-input/70 bg-background px-3 text-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20'

interface CompareFormProps {
  readonly stableKey: string | null
  readonly from: IsoDate | null
  readonly to: IsoDate | null
  readonly onSubmit: (value: { k: string; from: IsoDate; to: IsoDate }) => void
}

/** Campo de data da comparação, com o ponto âmbar da data. */
function DateInput({
  id,
  name,
  label,
  defaultValue,
  invalid,
}: {
  readonly id: string
  readonly name: 'from' | 'to'
  readonly label: string
  readonly defaultValue: IsoDate | null
  readonly invalid: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="inline-flex items-center gap-1.5 font-medium text-muted-foreground text-xs"
      >
        <span aria-hidden="true" className="size-1.5 rounded-full bg-date-mark" />
        {label}
      </label>
      <div className="relative">
        <CalendarIcon
          aria-hidden="true"
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground"
        />
        <input
          id={id}
          name={name}
          type="date"
          defaultValue={defaultValue ?? ''}
          aria-invalid={invalid || undefined}
          className={cn(FIELD_CLASSES, 'pl-9 font-mono tabular-nums')}
        />
      </div>
    </div>
  )
}

/** Formulário da comparação: chave e duas datas; a URL é o estado (o formulário só a escreve). */
function CompareForm({ stableKey, from, to, onSubmit }: CompareFormProps) {
  const t = useTranslations('compare')
  const id = useId()
  const [error, setError] = useState<FormError>(null)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const key = stableKeySchema.safeParse(String(data.get('k') ?? '').trim())
    const start = isoDateSchema.safeParse(data.get('from'))
    const end = isoDateSchema.safeParse(data.get('to'))
    if (!key.success) {
      setError('invalidKey')
      return
    }
    if (!start.success || !end.success || compareIsoDates(start.data, end.data) >= 0) {
      setError('invalidRange')
      return
    }
    setError(null)
    onSubmit({ k: key.data, from: start.data, to: end.data })
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-4 rounded-2xl border border-border/70 bg-popover p-4 shadow-raised sm:p-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-k`} className="font-medium text-muted-foreground text-xs">
          {t('keyLabel')}
        </label>
        <input
          id={`${id}-k`}
          name="k"
          defaultValue={stableKey ?? ''}
          placeholder={EXAMPLE.k}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error === 'invalidKey' || undefined}
          aria-describedby={error === null ? undefined : `${id}-error`}
          className={cn(FIELD_CLASSES, 'font-mono')}
        />
      </div>
      <DateInput
        id={`${id}-from`}
        name="from"
        label={t('fromLabel')}
        defaultValue={from}
        invalid={error === 'invalidRange'}
      />
      <DateInput
        id={`${id}-to`}
        name="to"
        label={t('toLabel')}
        defaultValue={to}
        invalid={error === 'invalidRange'}
      />
      <Button type="submit" className="h-10">
        <GitCompareArrowsIcon aria-hidden="true" />
        {t('submit')}
      </Button>
      {error !== null && (
        <p
          id={`${id}-error`}
          role="alert"
          className="flex items-center gap-2 text-destructive text-sm md:col-span-4"
        >
          <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
          {t(error)}
        </p>
      )}
    </form>
  )
}

/** Sem comparação na URL: o que a página faz, com as duas datas sobre o fio da linha do tempo. */
function CompareEmpty() {
  const t = useTranslations('compare')
  return (
    <div className="flex flex-col items-center gap-5 rounded-2xl border border-dashed bg-surface px-6 py-12 text-center">
      <div aria-hidden="true" className="flex w-56 items-center gap-0">
        <span className="size-3 rounded-full bg-date-mark shadow-[0_0_0_3px_var(--surface)]" />
        <span className="timeline-rule h-px flex-1" />
        <span className="flex size-8 items-center justify-center rounded-full border bg-popover text-primary shadow-soft">
          <GitCompareArrowsIcon className="size-4" />
        </span>
        <span className="timeline-rule h-px flex-1" />
        <span className="size-3 rounded-full bg-date-mark shadow-[0_0_0_3px_var(--surface)]" />
      </div>
      <div className="flex max-w-md flex-col gap-1.5">
        <h2 className="font-semibold font-serif text-xl tracking-tight">{t('emptyTitle')}</h2>
        <p className="text-pretty text-muted-foreground text-sm leading-relaxed">
          {t('emptyBody')}
        </p>
      </div>
    </div>
  )
}

function CompareViewContent() {
  const t = useTranslations('compare')
  const locale = useLocale()
  const [{ k, from, to }, setState] = useQueryStates(compareSearchParams)
  const fromDate = from === null ? null : referenceKeyDate(from)
  const toDate = to === null ? null : referenceKeyDate(to)
  const ready =
    k !== null && fromDate !== null && toDate !== null && compareIsoDates(fromDate, toDate) < 0

  return (
    <div className="flex flex-col gap-8">
      <AppPageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('intro')}
        actions={
          <Link
            href={compareHref(locale, EXAMPLE.k, EXAMPLE.from, EXAMPLE.to) as Route}
            className={buttonVariants({
              variant: 'outline',
              size: 'sm',
              className: 'h-auto min-h-8 whitespace-normal py-1.5 text-left',
            })}
          >
            <SparklesIcon aria-hidden="true" />
            {t('example')}
          </Link>
        }
      />
      <CompareForm
        // Remonta quando a URL muda (exemplo, voltar do navegador): os campos são não controlados.
        key={`${k ?? ''}|${fromDate ?? ''}|${toDate ?? ''}`}
        stableKey={k}
        from={fromDate}
        to={toDate}
        onSubmit={(value) =>
          void setState({
            k: value.k,
            from: { referenceDate: value.from },
            to: { referenceDate: value.to },
          })
        }
      />
      {ready ? (
        <section aria-labelledby="compare-result" className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col gap-1">
              <h2 id="compare-result" className="font-semibold font-serif text-2xl tracking-tight">
                {t('result')}
              </h2>
              <p className="font-mono text-muted-foreground text-xs">{k}</p>
            </div>
            <Link
              href={provisionHref(locale, k, { referenceDate: toDate }) as Route}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <BookOpenTextIcon aria-hidden="true" />
              {t('openProvision')}
            </Link>
          </div>
          <ProvisionDiff stableKey={k} from={fromDate} to={toDate} layout="split" />
        </section>
      ) : (
        <CompareEmpty />
      )}
    </div>
  )
}

function CompareLoading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    </div>
  )
}

/**
 * Comparação entre datas (`/compare/?k=<stableKey>&from=<data>&to=<data>`): o diff entre as
 * redações vigentes em cada data, lado a lado no desktop e empilhado no celular, com o exemplo do
 * roteiro (RCTE, art. 76, § 6º, 05/2008 contra 01/2010).
 */
export function CompareView() {
  return (
    <Suspense fallback={<CompareLoading />}>
      <CompareViewContent />
    </Suspense>
  )
}
