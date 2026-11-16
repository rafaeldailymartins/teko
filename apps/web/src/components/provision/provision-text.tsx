'use client'

import { ScrollTextIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { GetProvisionTimelineResponse } from '@/lib/api/__generated__/types.gen'

type Version = GetProvisionTimelineResponse['versions'][number]

interface ProvisionTextProps {
  readonly version: Version
}

/**
 * Texto de uma redação num cartão de leitura: o trecho legal em serif e `lang="pt-BR"` (também na
 * UI em inglês), com o fio verde-folha à esquerda, o ato que a trouxe e, nos registros, tabelas e
 * eventos, a tabela de campos.
 */
export function ProvisionText({ version }: ProvisionTextProps) {
  const t = useTranslations('provision')
  const fields = version.fields === null ? [] : Object.entries(version.fields)
  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-popover shadow-raised">
        <span
          aria-hidden="true"
          className="absolute top-0 bottom-0 left-0 w-1 bg-linear-to-b from-leaf to-primary/70"
        />
        <blockquote
          lang="pt-BR"
          className="whitespace-pre-line px-6 py-5 font-serif text-[17px] leading-[1.8] sm:px-8 sm:py-7"
        >
          {version.text}
        </blockquote>
        {version.act !== null && (
          <p className="flex items-center gap-2 border-t bg-surface px-6 py-2.5 text-muted-foreground text-xs sm:px-8">
            <ScrollTextIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span lang="pt-BR">{t('act', { act: version.act })}</span>
          </p>
        )}
      </div>
      {fields.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-popover">
          <table className="w-full border-collapse text-sm">
            <caption className="px-4 pt-3 pb-1 text-left font-medium text-muted-foreground text-xs">
              {t('fields')}
            </caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">{t('fieldName')}</th>
                <th scope="col">{t('fieldValue')}</th>
              </tr>
            </thead>
            <tbody lang="pt-BR">
              {fields.map(([name, value]) => (
                <tr key={name} className="border-t">
                  <th scope="row" className="px-4 py-1.5 text-left align-top font-medium">
                    {name}
                  </th>
                  <td className="px-4 py-1.5 font-mono tabular-nums">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
