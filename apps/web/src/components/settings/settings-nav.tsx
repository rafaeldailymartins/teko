'use client'

import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export interface SettingsNavItem {
  /** `id` da seção (a âncora). */
  readonly id: string
  readonly label: string
  readonly icon: LucideIcon
}

/**
 * Seção em vista: a primeira cujo topo passou da faixa de leitura (o terço de cima da janela). Sem
 * `IntersectionObserver`, fica a primeira.
 */
function useActiveSection(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(undefined)
  const key = ids.join(' ')

  useEffect(() => {
    const sections = key
      .split(' ')
      .map((id) => document.getElementById(id))
      .filter((element) => element !== null)
    if (sections.length === 0 || typeof IntersectionObserver === 'undefined') {
      return
    }
    const visible = new Set<string>()
    // No fim da rolagem, as últimas seções nunca chegam à faixa de leitura: vale a última.
    let atEnd = false
    const pick = () => {
      const first = sections.find((section) => visible.has(section.id))
      const chosen = atEnd ? sections.at(-1) : first
      if (chosen !== undefined) setActive(chosen.id)
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        pick()
      },
      { rootMargin: '-15% 0px -55% 0px' },
    )
    for (const section of sections) observer.observe(section)
    const onScroll = (event: Event) => {
      const scroller = event.target instanceof Element ? event.target : document.scrollingElement
      if (scroller?.contains(sections[0] ?? null) !== true) return
      atEnd =
        scroller.scrollTop > 0 &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
      pick()
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      observer.disconnect()
      document.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [key])

  return active ?? ids[0]
}

/**
 * Navegação das configurações: lista lateral fixa no desktop, com a seção em vista marcada pela
 * aba em relevo e o fio verde-folha, e uma faixa rolável de atalhos no celular.
 */
export function SettingsNav({ items }: { readonly items: readonly SettingsNavItem[] }) {
  const t = useTranslations('settings')
  const active = useActiveSection(items.map((item) => item.id))

  return (
    <nav aria-label={t('nav')} className="lg:sticky lg:top-8">
      <ul className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:p-0">
        {items.map(({ id, label, icon: Icon }) => {
          const current = id === active
          return (
            <li key={id} className="shrink-0">
              <a
                href={`#${id}`}
                aria-current={current ? 'location' : undefined}
                className={cn(
                  'relative flex items-center gap-2.5 whitespace-nowrap rounded-lg border px-3 py-2 text-sm outline-none transition-[color,background-color,border-color,box-shadow] duration-150 ease-out-soft focus-visible:ring-2 focus-visible:ring-ring lg:border-transparent',
                  current
                    ? 'border-border bg-popover font-medium text-foreground shadow-soft lg:border-border'
                    : 'bg-popover/60 text-muted-foreground hover:bg-muted hover:text-foreground lg:bg-transparent',
                  id === 'danger' && !current && 'hover:text-destructive',
                )}
              >
                {current && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-2 left-0 hidden w-0.5 rounded-full bg-leaf lg:block"
                  />
                )}
                <Icon
                  aria-hidden="true"
                  className={cn('size-4 shrink-0', current && 'text-validity-current')}
                />
                {label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
