'use client'

import { stableKeySchema } from '@teko/shared/contracts'
import { compareIsoDates, type IsoDate, isoDateSchema } from '@teko/shared/vigencia'
import { BookOpenTextIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useQueryStates } from 'nuqs'
import { type FormEvent, Suspense, useId, useState } from 'react'
import { ProvisionDiff } from '@/components/provision/provision-diff'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { referenceKeyDate } from '@/lib/api/reference'
import { compareHref, compareSearchParams, provisionHref } from '@/lib/url-state'

/** O exemplo do roteiro: o § 6º do art. 76 do RCTE mudou em 23/11/2009. */
const EXAMPLE = {
  k: 'go:rcte:art:76:par:6',
  from: { periodoApuracao: '2008-05' },
  to: { periodoApuracao: '2010-01' },
} as const

type FormError = 'invalidKey' | 'invalidRange' | null

interface CompareFormProps {
  readonly stableKey: string | null
  readonly from: IsoDate | null
  readonly to: IsoDate | null
  readonly onSubmit: (value: { k: string; from: IsoDate; to: IsoDate }) => void
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
    <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-k`} className="font-medium text-muted-foreground text-xs">
          {t('keyLabel')}
        </label>
        <Input
          id={`${id}-k`}
          name="k"
          defaultValue={stableKey ?? ''}
          placeholder={EXAMPLE.k}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error === 'invalidKey' || undefined}
          aria-describedby={error === null ? undefined : `${id}-error`}
          className="font-mono"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-from`} className="font-medium text-muted-foreground text-xs">
          {t('fromLabel')}
        </label>
        <Input
          id={`${id}-from`}
          name="from"
          type="date"
          defaultValue={from ?? ''}
          aria-invalid={error === 'invalidRange' || undefined}
          className="font-mono tabular-nums"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-to`} className="font-medium text-muted-foreground text-xs">
          {t('toLabel')}
        </label>
        <Input
          id={`${id}-to`}
          name="to"
          type="date"
          defaultValue={to ?? ''}
          aria-invalid={error === 'invalidRange' || undefined}
          className="font-mono tabular-nums"
        />
      </div>
      <Button type="submit" className="self-end">
        {t('submit')}
      </Button>
      {error !== null && (
        <p id={`${id}-error`} role="alert" className="text-destructive text-sm sm:col-span-4">
          {t(error)}
        </p>
      )}
    </form>
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
      <header className="flex flex-col gap-2">
        <h1 className="font-semibold font-serif text-3xl tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
        <Link
          href={compareHref(locale, EXAMPLE.k, EXAMPLE.from, EXAMPLE.to) as Route}
          className={`${buttonVariants({ variant: 'link' })} self-start px-0`}
        >
          {t('example')}
        </Link>
      </header>
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
      {ready && (
        <section aria-labelledby="compare-result" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="compare-result" className="font-semibold font-serif text-xl">
              {t('result')}
            </h2>
            <Link
              href={provisionHref(locale, k, { referenceDate: toDate }) as Route}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              <BookOpenTextIcon aria-hidden="true" />
              {t('openProvision')}
            </Link>
          </div>
          <ProvisionDiff stableKey={k} from={fromDate} to={toDate} />
        </section>
      )}
    </div>
  )
}

function CompareLoading() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-10 w-full" />
    </div>
  )
}

/**
 * Comparação entre datas (`/compare/?k=<stableKey>&from=<data>&to=<data>`): o diff entre as
 * redações vigentes em cada data, com o exemplo do roteiro (RCTE, art. 76, § 6º, 05/2008 contra
 * 01/2010).
 */
export function CompareView() {
  return (
    <Suspense fallback={<CompareLoading />}>
      <CompareViewContent />
    </Suspense>
  )
}
