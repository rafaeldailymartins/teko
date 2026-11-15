'use client'

import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useId, useSyncExternalStore } from 'react'
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
import { LOCALE_ENDONYMS, routing } from '@/lib/i18n/routing'
import { switchLocalePath } from '@/lib/navigation'
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
}

interface ChoiceGroupProps {
  readonly legend: string
  readonly value: string
  readonly choices: readonly Choice[]
  readonly onChange: (value: string) => void
}

/** Grupo de opções exclusivas com `<input type="radio">` nativo (setas trocam a escolha). */
function ChoiceGroup({ legend, value, choices, onChange }: ChoiceGroupProps) {
  const name = useId()
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={cn(
              'inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
              choice.value === value && 'border-primary bg-muted',
            )}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={choice.value === value}
              onChange={() => onChange(choice.value)}
              className="accent-primary"
            />
            {choice.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Tema, idioma e densidade: preferências do navegador, valem com ou sem sessão. */
export function PreferencesSection() {
  const t = useTranslations('settings.preferences')
  const tTheme = useTranslations('common.theme')
  const locale = useLocale()
  const pathname = usePathname()
  const theme = useThemePreference()
  const density = useDensity()

  return (
    <SettingsSection id="preferences" title={t('title')}>
      <ChoiceGroup
        legend={t('theme')}
        value={theme}
        choices={THEME_OPTIONS.map(({ value }) => ({ value, label: tTheme(value) }))}
        onChange={(value) => setThemePreference(parseThemePreference(value))}
      />
      <ChoiceGroup
        legend={t('density')}
        value={density}
        choices={DENSITY_OPTIONS.map((value) => ({ value, label: t(`densityOptions.${value}`) }))}
        onChange={(value) => setDensity(parseDensity(value))}
      />
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">{t('language')}</h3>
        <ul className="flex flex-wrap gap-2">
          {routing.locales.map((target) => (
            <li key={target}>
              {target === locale ? (
                <span
                  aria-current="true"
                  className="inline-flex min-h-8 items-center rounded-lg border border-primary bg-muted px-3 text-sm"
                >
                  {LOCALE_ENDONYMS[target]}
                </span>
              ) : (
                <a
                  href={switchLocalePath(pathname, target)}
                  hrefLang={target}
                  lang={target}
                  className="inline-flex min-h-8 items-center rounded-lg border px-3 text-sm hover:bg-muted"
                >
                  {LOCALE_ENDONYMS[target]}
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </SettingsSection>
  )
}
