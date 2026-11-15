'use client'

import { LogInIcon, LogOutIcon, SettingsIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { signInPath } from '@/lib/auth/return-path'
import { initialsOf, SessionStatus } from '@/lib/auth/session'
import { localePagePath } from '@/lib/navigation'
import { useSession, useSignOutAction } from './use-session.ts'

/**
 * Sessão no cabeçalho do app: "Entrar" sem sessão; com sessão, as iniciais (a foto do provedor fica
 * de fora, a CSP só aceita imagens da própria origem) abrem o menu com nome, e-mail,
 * configurações e sair. Enquanto `/me` carrega, um marcador do mesmo tamanho evita salto.
 */
export function UserMenu() {
  const t = useTranslations('auth.menu')
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const { status, me } = useSession()
  const { signOut, pending } = useSignOutAction()

  if (status === SessionStatus.Loading) {
    return <span aria-hidden="true" className="size-8 animate-pulse rounded-full bg-muted" />
  }
  if (me === null) {
    return (
      <Link
        href={signInPath(locale, pathname)}
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        <LogInIcon aria-hidden="true" />
        {t('signIn')}
      </Link>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('label', { name: me.name })}
            className="rounded-full"
          />
        }
      >
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-xs"
        >
          {initialsOf(me.name)}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate font-medium text-foreground text-sm">{me.name}</span>
            <span className="block truncate">{me.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push(localePagePath(locale, 'settings'))}>
          <SettingsIcon aria-hidden="true" />
          {t('settings')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={pending} onClick={signOut}>
          <LogOutIcon aria-hidden="true" />
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
