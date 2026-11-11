/**
 * Contraste WCAG 2.x para cores OKLCH, sem dependências: OKLCH → OKLab → sRGB linear
 * (matrizes de Björn Ottosson) → luminância relativa. Cores fora do gamut sRGB são recortadas
 * por canal, como o navegador faz ao exibir.
 */

export interface Oklch {
  /** Luminosidade perceptual, 0–1. */
  readonly l: number
  /** Croma, ≥ 0. */
  readonly c: number
  /** Matiz em graus. */
  readonly h: number
}

export type LinearRgb = readonly [r: number, g: number, b: number]

/**
 * Cada número é `\d+(?:\.\d+)?` ou `\.\d+` (a mesma linguagem de `\d*\.?\d+`), alternativas que
 * começam por caracteres diferentes: nenhum par de quantificadores disputa os mesmos dígitos, e a
 * correspondência é linear mesmo para entradas hostis.
 */
const OKLCH_PATTERN =
  /^oklch\(\s*(?<l>\d+(?:\.\d+)?|\.\d+)(?<percent>%?)\s+(?<c>\d+(?:\.\d+)?|\.\d+)\s+(?<h>-?(?:\d+(?:\.\d+)?|\.\d+))(?:deg)?\s*\)$/i

/** Interpreta `oklch(L C H)` (L em fração ou %, sem alfa). Lança `SyntaxError` se inválido. */
export function parseOklch(input: string): Oklch {
  const { l, percent, c, h } = OKLCH_PATTERN.exec(input.trim())?.groups ?? {}
  if (!l || !c || !h) {
    throw new SyntaxError(`Cor OKLCH inválida: "${input}"`)
  }
  return {
    l: percent === '%' ? Number(l) / 100 : Number(l),
    c: Number(c),
    h: Number(h),
  }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** OKLCH → sRGB linear, recortado a [0, 1]. */
export function oklchToLinearSrgb({ l, c, h }: Oklch): LinearRgb {
  const hue = (h * Math.PI) / 180
  const a = c * Math.cos(hue)
  const b = c * Math.sin(hue)

  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    clamp01(4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp),
    clamp01(-1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp),
    clamp01(-0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp),
  ]
}

/** Luminância relativa (WCAG 2.x) a partir de sRGB linear. */
export function relativeLuminance([r, g, b]: LinearRgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Razão de contraste WCAG entre duas cores OKLCH (1 a 21, simétrica). */
export function contrastRatio(foreground: string | Oklch, background: string | Oklch): number {
  const toLuminance = (color: string | Oklch): number =>
    relativeLuminance(oklchToLinearSrgb(typeof color === 'string' ? parseOklch(color) : color))
  const first = toLuminance(foreground)
  const second = toLuminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** Limiares WCAG 2.2 AA: texto normal (1.4.3) e componentes de UI e foco (1.4.11). */
export const WCAG_AA = {
  text: 4.5,
  nonText: 3,
} as const
