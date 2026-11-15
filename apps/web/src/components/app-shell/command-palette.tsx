'use client'

import { HomeIcon, SearchIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { setThemePreference, THEME_OPTIONS } from '@/components/theme-selector'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import {
  commandPaletteShortcutLabel,
  isApplePlatform,
  isCommandPaletteShortcut,
} from '@/lib/hotkeys'
import { localeHomePath } from '@/lib/i18n/routing'
import { localePagePath, NAVIGATION_PAGES } from '@/lib/navigation'
import { PAGE_ICONS } from './page-icons.ts'

const noSubscription = () => () => {}

/** `⌘K` no macOS e no iOS, `Ctrl K` nos demais (o HTML estático sai com `Ctrl K`). */
function useShortcutLabel(): string {
  const apple = useSyncExternalStore(
    noSubscription,
    () => isApplePlatform(navigator.platform),
    () => false,
  )
  return commandPaletteShortcutLabel(apple)
}

/**
 * Paleta de comandos (`Ctrl/⌘+K` ou o botão do cabeçalho): navegação entre as páginas e troca de
 * tema. Filtra pelo texto digitado; setas escolhem, `Enter` executa, `Esc` fecha e devolve o foco.
 */
export function CommandPalette() {
  const t = useTranslations('shell.palette')
  const tPages = useTranslations('pages')
  const tTheme = useTranslations('common.theme')
  const locale = useLocale()
  const router = useRouter()
  const shortcut = useShortcutLabel()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCommandPaletteShortcut(event)) {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const run = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Control+K Meta+K"
        aria-haspopup="dialog"
        className="text-muted-foreground"
      >
        <SearchIcon aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">{t('open')}</span>
        <Kbd aria-hidden="true" className="hidden sm:inline-flex">
          {shortcut}
        </Kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t('title')}
        description={t('description')}
      >
        <Command label={t('title')}>
          <CommandInput placeholder={t('placeholder')} />
          <CommandList>
            <CommandEmpty>{t('empty')}</CommandEmpty>
            <CommandGroup heading={t('pages')}>
              <CommandItem
                value="home"
                keywords={[t('home')]}
                onSelect={() => run(() => router.push(localeHomePath(locale)))}
              >
                <HomeIcon aria-hidden="true" />
                {t('home')}
              </CommandItem>
              {NAVIGATION_PAGES.map((page) => {
                const Icon = PAGE_ICONS[page]
                return (
                  <CommandItem
                    key={page}
                    value={page}
                    keywords={[tPages(`${page}.title`)]}
                    onSelect={() => run(() => router.push(localePagePath(locale, page)))}
                  >
                    <Icon aria-hidden="true" />
                    {tPages(`${page}.title`)}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={t('theme')}>
              {THEME_OPTIONS.map(({ value, Icon }) => (
                <CommandItem
                  key={value}
                  value={`theme-${value}`}
                  keywords={[tTheme('label'), tTheme(value)]}
                  onSelect={() => run(() => setThemePreference(value))}
                >
                  <Icon aria-hidden="true" />
                  {tTheme(value)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
