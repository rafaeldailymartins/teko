'use client'

import { useTranslations } from 'next-intl'
import type { GetProvisionTimelineResponse } from '@/lib/api/__generated__/types.gen'

type Version = GetProvisionTimelineResponse['versions'][number]

interface ProvisionTextProps {
  readonly version: Version
}

/**
 * Texto de uma redação: o trecho legal em `lang="pt-BR"` (também na UI em inglês), o ato que a
 * trouxe e, nos registros, tabelas e eventos, a tabela de campos.
 */
export function ProvisionText({ version }: ProvisionTextProps) {
  const t = useTranslations('provision')
  const fields = version.fields === null ? [] : Object.entries(version.fields)
  return (
    <div className="flex flex-col gap-3">
      <blockquote
        lang="pt-BR"
        className="whitespace-pre-line border-primary/40 border-l-2 pl-4 font-serif text-[15px] leading-relaxed"
      >
        {version.text}
      </blockquote>
      {version.act !== null && (
        <p className="text-muted-foreground text-xs">{t('act', { act: version.act })}</p>
      )}
      {fields.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <caption className="pb-1 text-left font-medium text-muted-foreground text-xs">
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
                <th scope="row" className="py-1 pr-3 text-left align-top font-medium">
                  {name}
                </th>
                <td className="py-1 font-mono tabular-nums">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
