'use client'

import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  applyThemePreference,
  parseThemePreference,
  readThemePreference,
  subscribeThemePreference,
  THEME_CHANGE_EVENT,
  ThemePreference,
} from '@/lib/theme'

/** Opções de tema com o ícone de cada uma (seletor do cabeçalho e paleta). */
export const THEME_OPTIONS = [
  { value: ThemePreference.Light, Icon: SunIcon },
  { value: ThemePreference.Dark, Icon: MoonIcon },
  { value: ThemePreference.System, Icon: MonitorIcon },
] as const

/** `localStorage`, ou `null` quando o navegador o bloqueia (o acesso em si pode lançar). */
function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Preferência atual. No HTML estático vale `system` (o servidor não conhece o storage); depois da
 * hidratação vale a salva, sem divergência de hidratação.
 */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    (onChange) => subscribeThemePreference(window, onChange),
    () => readThemePreference(browserStorage()),
    () => ThemePreference.System,
  )
}

/** Grava a preferência, aplica no `<html>` e avisa os outros seletores da aba. */
export function setThemePreference(preference: ThemePreference): void {
  applyThemePreference(preference, { storage: browserStorage(), root: document.documentElement })
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
}

/** Seletor de tema do cabeçalho: claro, escuro ou igual ao sistema. */
export function ThemeSelector() {
  const t = useTranslations('common.theme')
  const preference = useThemePreference()
  const CurrentIcon =
    THEME_OPTIONS.find((option) => option.value === preference)?.Icon ?? MonitorIcon

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" aria-label={t('label')} />}
            />
          }
        >
          <CurrentIcon aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>{t('label')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => setThemePreference(parseThemePreference(value))}
        >
          {THEME_OPTIONS.map(({ value, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" />
              {t(value)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
