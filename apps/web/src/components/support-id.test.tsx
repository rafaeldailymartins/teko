import { ErrorCode } from '@teko/shared/errors'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import en from '../../messages/en.json'
import ptBR from '../../messages/pt-BR.json'
import { QueryError } from './query-error.tsx'
import { SupportId } from './support-id.tsx'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'

function html(ui: ReactNode, locale: 'pt-BR' | 'en' = 'pt-BR'): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : ptBR}>
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('SupportId', () => {
  it('mostra o trace_id como "ID de suporte" nos dois idiomas', () => {
    expect(html(<SupportId traceId={TRACE_ID} />)).toContain(
      `ID de suporte: <code class="select-all font-mono">${TRACE_ID}</code>`,
    )
    expect(html(<SupportId traceId={TRACE_ID} />, 'en')).toContain(`Support ID: <code`)
  })

  it('sem id (falha de rede), nada', () => {
    expect(html(<SupportId traceId={null} />)).toBe('')
  })
})

describe('QueryError', () => {
  it('leva o ID de suporte do erro da API', () => {
    const error = new ApiError({ code: ErrorCode.Internal, status: 502, traceId: TRACE_ID })
    const markup = html(<QueryError error={error} onRetry={() => {}} retryLabel="Tentar de novo" />)
    expect(markup).toContain(ptBR.errors.internal)
    expect(markup).toContain(`data-support-id="${TRACE_ID}"`)
  })
})
