'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useSession } from '@/components/auth/use-session'
import { TekoLogo } from '@/components/brand/teko-logo'

/** Parte do dia da saudação, pela hora local do navegador. */
type DayPeriod = 'morning' | 'afternoon' | 'evening'

function dayPeriod(hour: number): DayPeriod {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

/** Primeiro nome da conta (a saudação não usa o nome completo). */
function firstName(name: string | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0]
  return first === undefined || first === '' ? null : first
}

/**
 * Abertura do chat vazio: o selo, a saudação (o `h1` da página sem conversa) e uma linha sobre o que
 * o Tekó responde. A data de referência fica num lugar só, o chip do composer logo abaixo.
 */
export function ChatWelcome() {
  const t = useTranslations('chat.welcome')
  const { me } = useSession()
  const [period] = useState(() => dayPeriod(new Date().getHours()))
  const name = firstName(me?.name)

  return (
    <div className="flex flex-col items-center gap-3 text-center" data-chat-welcome="">
      <TekoLogo variant="seal" className="size-11 rounded-xl shadow-soft" />
      <h1 className="text-balance font-semibold font-serif text-[1.75rem] leading-tight tracking-tight sm:text-[2.125rem]">
        {name === null
          ? t(`greeting.${period}`)
          : t('greetingNamed', { greeting: t(`greeting.${period}`), name })}
      </h1>
      <p className="max-w-2xl text-pretty text-muted-foreground text-[0.9375rem]">{t('lead')}</p>
    </div>
  )
}
