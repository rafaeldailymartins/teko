'use client'

import { CheckIcon, ChevronDownIcon, LanguagesIcon } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { analytics } from '@/lib/analytics'
import { LOCALE_ENDONYMS, routing } from '@/lib/i18n/routing'
import { switchLocaleHref } from '@/lib/navigation'

interface LanguageMenuProps {
  /**
   * `icon`: botão só com o ícone, como o seletor de tema (cabeçalhos). `labeled`: o idioma atual
   * escrito no botão (configurações).
   */
  readonly variant?: 'icon' | 'labeled'
}

interface QuerySuffix {
  readonly search: string
  readonly hash: string
}

const NO_QUERY: QuerySuffix = { search: '', hash: '' }

/**
 * Menu de idioma: os idiomas pelo nome nativo, cada um um link para a mesma página no outro locale,
 * com a query e a âncora atuais. É navegação completa de propósito: o idioma muda o `<html lang>` e
 * o layout raiz. A query só é lida quando o menu abre (no HTML estático não há query), então a
 * página não precisa de `useSearchParams` nem de `<Suspense>` por causa do menu.
 */
export function LanguageMenu({ variant = 'icon' }: LanguageMenuProps) {
  const locale = useLocale()
  const pathname = usePathname()
  const t = useTranslations('common.language')
  const [query, setQuery] = useState<QuerySuffix>(NO_QUERY)
  const current = LOCALE_ENDONYMS[locale]

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setQuery({ search: window.location.search, hash: window.location.hash })
      }}
    >
      {variant === 'icon' ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" aria-label={t('label')} />}
              />
            }
          >
            <LanguagesIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{t('label')}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger
          render={<Button variant="outline" aria-label={t('current', { language: current })} />}
        >
          <LanguagesIcon aria-hidden="true" />
          <span lang={locale}>{current}</span>
          <ChevronDownIcon aria-hidden="true" className="text-muted-foreground" />
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="end">
        {routing.locales.map((target) =>
          target === locale ? (
            <DropdownMenuItem key={target} lang={target} aria-current="true">
              <span className="flex-1">{LOCALE_ENDONYMS[target]}</span>
              <CheckIcon aria-hidden="true" className="text-primary" />
            </DropdownMenuItem>
          ) : (
            <DropdownMenuLinkItem
              key={target}
              href={switchLocaleHref({ pathname, ...query }, target)}
              hrefLang={target}
              lang={target}
              closeOnClick
              onClick={() => analytics.capture('locale_changed', { from: locale, to: target })}
            >
              <span className="flex-1">{LOCALE_ENDONYMS[target]}</span>
              <span
                aria-hidden="true"
                className="font-mono text-muted-foreground text-xs uppercase"
              >
                {target}
              </span>
            </DropdownMenuLinkItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
