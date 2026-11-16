'use client'

import { type LucideIcon, Rows2Icon, Rows4Icon, SlidersHorizontalIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useSyncExternalStore } from 'react'
import { LanguageMenu } from '@/components/language-menu'
import { setThemePreference, THEME_OPTIONS, useThemePreference } from '@/components/theme-selector'
import {
  applyDensity,
  DENSITY_CHANGE_EVENT,
  DENSITY_OPTIONS,
  Density,
  parseDensity,
  readDensity,
  subscribeDensity,
} from '@/lib/density'
import { parseThemePreference } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { SettingsSection } from './settings-section.tsx'

function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Densidade atual; no HTML estático vale a padrão, depois da hidratação vale a salva. */
function useDensity(): Density {
  return useSyncExternalStore(
    (onChange) => subscribeDensity(window, onChange),
    () => readDensity(browserStorage()),
    () => Density.Comfortable,
  )
}

function setDensity(density: Density): void {
  applyDensity(density, { storage: browserStorage(), root: document.documentElement })
  window.dispatchEvent(new Event(DENSITY_CHANGE_EVENT))
}

interface Choice {
  readonly value: string
  readonly label: string
  readonly icon: LucideIcon
  /** Linha de apoio sob o rótulo. */
  readonly hint?: string
}

interface ChoiceGroupProps {
  readonly legend: string
  readonly value: string
  readonly choices: readonly Choice[]
  readonly onChange: (value: string) => void
}

/**
 * Grupo de opções exclusivas em cartões, com `<input type="radio">` nativo (setas trocam a
 * escolha): o cartão escolhido ganha a borda da primária e o ícone em verde-folha.
 */
function ChoiceGroup({ legend, value, choices, onChange }: ChoiceGroupProps) {
  const name = useId()
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2.5 font-medium text-sm">{legend}</legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
        {choices.map(({ value: choiceValue, label, icon: Icon, hint }) => {
          const checked = choiceValue === value
          return (
            <label
              key={choiceValue}
              className={cn(
                'relative flex cursor-pointer items-start gap-2.5 rounded-xl border bg-popover p-3 text-sm shadow-soft transition-[border-color,background-color,box-shadow] duration-150 ease-out-soft has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background',
                checked ? 'border-primary bg-surface' : 'hover:border-border-strong/50',
              )}
            >
              <input
                type="radio"
                name={name}
                value={choiceValue}
                checked={checked}
                onChange={() => onChange(choiceValue)}
                className="sr-only"
              />
              <Icon
                aria-hidden="true"
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  checked ? 'text-validity-current' : 'text-muted-foreground',
                )}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{label}</span>
                {hint !== undefined && (
                  <span className="text-muted-foreground text-xs leading-snug">{hint}</span>
                )}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'ml-auto flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
                  checked ? 'border-primary bg-primary' : 'border-input',
                )}
              >
                {checked && <span className="size-1.5 rounded-full bg-primary-foreground" />}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

const DENSITY_ICONS = {
  [Density.Comfortable]: Rows2Icon,
  [Density.Compact]: Rows4Icon,
} as const

/** Tema, idioma e densidade: preferências do navegador, valem com ou sem sessão. */
export function PreferencesSection() {
  const t = useTranslations('settings.preferences')
  const tTheme = useTranslations('common.theme')
  const theme = useThemePreference()
  const density = useDensity()

  return (
    <SettingsSection
      id="preferences"
      title={t('title')}
      description={t('lead')}
      icon={SlidersHorizontalIcon}
    >
      <ChoiceGroup
        legend={t('theme')}
        value={theme}
        choices={THEME_OPTIONS.map(({ value, Icon }) => ({
          value,
          label: tTheme(value),
          icon: Icon,
        }))}
        onChange={(value) => setThemePreference(parseThemePreference(value))}
      />
      <ChoiceGroup
        legend={t('density')}
        value={density}
        choices={DENSITY_OPTIONS.map((value) => ({
          value,
          label: t(`densityOptions.${value}`),
          hint: t(`densityHints.${value}`),
          icon: DENSITY_ICONS[value],
        }))}
        onChange={(value) => setDensity(parseDensity(value))}
      />
      <div className="flex flex-col items-start gap-2.5">
        <h3 className="font-medium text-sm">{t('language')}</h3>
        <LanguageMenu variant="labeled" />
      </div>
    </SettingsSection>
  )
}
