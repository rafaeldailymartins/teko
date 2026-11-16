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

const DOMAIN_TOKENS = [
  'validity-current',
  'validity-superseded',
  'validity-future',
  'coverage-out',
  'degraded',
] as const
const DOMAIN_SURFACES = ['background', 'surface', 'popover', 'muted'] as const

/** Pares [primeiro plano, fundo, mínimo] que a UI usa. */
const PAIRS: readonly (readonly [string, string, number])[] = [
  ['foreground', 'background', WCAG_AA.text],
  ['foreground', 'surface', WCAG_AA.text],
  ['muted-foreground', 'background', WCAG_AA.text],
  ['muted-foreground', 'surface', WCAG_AA.text],
  ['primary-foreground', 'primary', WCAG_AA.text],
  ['primary', 'background', WCAG_AA.text],
  ['accent-foreground', 'accent', WCAG_AA.text],
  // Os tokens de domínio aparecem como texto no fundo, no painel lateral, nos popups e
  // nos blocos de resposta (--muted).
  ...DOMAIN_TOKENS.flatMap((token) =>
    DOMAIN_SURFACES.map((surface) => [token, surface, WCAG_AA.text] as const),
  ),
  ['ring', 'background', WCAG_AA.nonText],
  ['ring', 'surface', WCAG_AA.nonText],
  ['border-strong', 'background', WCAG_AA.nonText],
  ['accent-border', 'accent', WCAG_AA.nonText],
  // Componentes do shadcn: popups, hover e item selecionado, campos, secundária e destrutiva.
  ['foreground', 'muted', WCAG_AA.text],
  ['muted-foreground', 'muted', WCAG_AA.text],
  ['primary', 'muted', WCAG_AA.text],
  ['popover-foreground', 'popover', WCAG_AA.text],
  ['muted-foreground', 'popover', WCAG_AA.text],
  ['secondary-foreground', 'secondary', WCAG_AA.text],
  ['destructive', 'background', WCAG_AA.text],
  ['destructive', 'popover', WCAG_AA.text],
  ['accent-foreground', 'background', WCAG_AA.text],
  ['primary', 'surface', WCAG_AA.text],
  ['input', 'background', WCAG_AA.nonText],
  ['input', 'popover', WCAG_AA.nonText],
  ['ring', 'muted', WCAG_AA.nonText],
  ['ring', 'popover', WCAG_AA.nonText],
  ['border-strong', 'surface', WCAG_AA.nonText],
  // Marca: texto claro sobre o petróleo da logo (selo, telas da marca), nas duas pontas do
  // gradiente; a folha é forma (marcadores, fios), então ≥ 3:1 no fundo e no painel.
  ['brand-foreground', 'brand', WCAG_AA.text],
  ['brand-foreground', 'brand-deep', WCAG_AA.text],
  ['leaf', 'background', WCAG_AA.nonText],
  ['leaf', 'surface', WCAG_AA.nonText],
  ['leaf', 'popover', WCAG_AA.nonText],
  // Selo "vigente": texto verde sobre o fundo suave da folha.
  ['validity-current', 'leaf-soft', WCAG_AA.text],
  ['primary', 'popover', WCAG_AA.text],
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
