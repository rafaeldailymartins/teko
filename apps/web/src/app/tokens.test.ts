import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio, WCAG_AA } from '@/lib/contrast'

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8')

const OKLCH = String.raw`oklch\([^)]*\)`
const TOKEN_PATTERN = new RegExp(
  String.raw`--([\w-]+):\s*light-dark\(\s*(${OKLCH})\s*,\s*(${OKLCH})\s*\)`,
  'g',
)

/** Tokens de cor declarados com `light-dark()` em `:root`. */
const tokens = new Map(
  [...css.matchAll(TOKEN_PATTERN)].map(([, name, light, dark]) => [
    name ?? '',
    { light: light ?? '', dark: dark ?? '' },
  ]),
)

type Scheme = 'light' | 'dark'

function color(name: string, scheme: Scheme): string {
  const token = tokens.get(name)
  if (!token) throw new Error(`Token --${name} ausente em globals.css`)
  return token[scheme]
}

/** Pares [primeiro plano, fundo, mínimo] que a UI usa. */
const PAIRS: readonly (readonly [string, string, number])[] = [
  ['foreground', 'background', WCAG_AA.text],
  ['foreground', 'surface', WCAG_AA.text],
  ['muted-foreground', 'background', WCAG_AA.text],
  ['muted-foreground', 'surface', WCAG_AA.text],
  ['primary-foreground', 'primary', WCAG_AA.text],
  ['primary', 'background', WCAG_AA.text],
  ['accent-foreground', 'accent', WCAG_AA.text],
  ['validity-current', 'background', WCAG_AA.text],
  ['validity-superseded', 'background', WCAG_AA.text],
  ['validity-future', 'background', WCAG_AA.text],
  ['coverage-out', 'background', WCAG_AA.text],
  ['degraded', 'background', WCAG_AA.text],
  ['ring', 'background', WCAG_AA.nonText],
  ['ring', 'surface', WCAG_AA.nonText],
  ['border-strong', 'background', WCAG_AA.nonText],
  ['accent-border', 'accent', WCAG_AA.nonText],
]

describe('design tokens (globals.css)', () => {
  it('declara todos os tokens dos pares verificados', () => {
    const missing = new Set<string>()
    for (const [foreground, background] of PAIRS) {
      for (const name of [foreground, background]) if (!tokens.has(name)) missing.add(name)
    }
    expect([...missing]).toEqual([])
  })

  describe.each(['light', 'dark'] as const)('tema %s', (scheme) => {
    it.each(PAIRS)('--%s sobre --%s atinge %s:1', (foreground, background, minimum) => {
      const ratio = contrastRatio(color(foreground, scheme), color(background, scheme))
      expect(ratio).toBeGreaterThanOrEqual(minimum)
    })
  })
})
