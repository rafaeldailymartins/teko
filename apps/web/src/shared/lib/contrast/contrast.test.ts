import { describe, expect, it } from 'vitest'
import { contrastRatio, oklchToLinearSrgb, parseOklch, relativeLuminance } from './contrast.ts'

describe('parseOklch', () => {
  it('aceita L em fração ou porcentagem e matiz com deg', () => {
    expect(parseOklch('oklch(0.5 0.09 205)')).toEqual({ l: 0.5, c: 0.09, h: 205 })
    expect(parseOklch(' oklch(50% 0.09 205deg) ')).toEqual({ l: 0.5, c: 0.09, h: 205 })
    expect(parseOklch('OKLCH(.62 .2 -30)')).toEqual({ l: 0.62, c: 0.2, h: -30 })
  })

  it('aceita inteiros e decimais com ou sem parte inteira', () => {
    expect(parseOklch('oklch(1 0 0)')).toEqual({ l: 1, c: 0, h: 0 })
    expect(parseOklch('oklch(0.25 1.5 -.5)')).toEqual({ l: 0.25, c: 1.5, h: -0.5 })
  })

  it.each([
    '',
    'oklch(0.5 0.1)',
    'oklch(0.5 0.1 200 / 50%)',
    'rgb(0 0 0)',
    'oklch(a b c)',
    'oklch(5. 0.1 200)',
    'oklch(0.5 0.1. 200)',
    'oklch(0..5 0.1 200)',
    'oklch(0.5 0.1 --200)',
  ])('rejeita %j', (input) => {
    expect(() => parseOklch(input)).toThrow(SyntaxError)
  })

  // Regressão de ReDoS: `\d*\.?\d+` sobrepunha os dois quantificadores e era quadrático.
  it.each([
    `oklch(${'1'.repeat(50_000)}x`,
    `oklch(0.5 ${'1'.repeat(50_000)}x`,
    `oklch(0.5 0.1 ${'1'.repeat(50_000)}x`,
  ])('rejeita depressa a entrada patológica %#', (input) => {
    const start = performance.now()
    expect(() => parseOklch(input)).toThrow(SyntaxError)
    expect(performance.now() - start).toBeLessThan(100)
  })
})

describe('oklchToLinearSrgb', () => {
  it('converte branco, preto e um vermelho sRGB conhecido', () => {
    const white = oklchToLinearSrgb({ l: 1, c: 0, h: 0 })
    const black = oklchToLinearSrgb({ l: 0, c: 0, h: 0 })
    // #ff0000 ≈ oklch(0.6279554 0.2576833 29.2338851)
    const red = oklchToLinearSrgb({ l: 0.6279554, c: 0.2576833, h: 29.2338851 })
    for (const channel of white) expect(channel).toBeCloseTo(1, 4)
    for (const channel of black) expect(channel).toBe(0)
    expect(red[0]).toBeCloseTo(1, 3)
    expect(red[1]).toBeCloseTo(0, 3)
    expect(red[2]).toBeCloseTo(0, 3)
  })

  it('recorta cores fora do gamut sRGB', () => {
    for (const channel of oklchToLinearSrgb({ l: 0.9, c: 0.4, h: 140 })) {
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(1)
    }
  })
})

describe('contrastRatio', () => {
  it('vai de 1 (mesma cor) a 21 (preto × branco) e é simétrica', () => {
    expect(contrastRatio('oklch(1 0 0)', 'oklch(0 0 0)')).toBeCloseTo(21, 2)
    expect(contrastRatio('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 2)
    expect(contrastRatio('oklch(0.5 0.09 205)', 'oklch(0.5 0.09 205)')).toBe(1)
  })

  it('bate com a referência WCAG para cinza #777 sobre branco (≈ 4,48)', () => {
    // #777777: sRGB 0x77/255 → linear 0.18447; luminância 0.18447 → contraste 4.4776
    const gray = { l: Math.cbrt(0.18447), c: 0, h: 0 }
    expect(relativeLuminance(oklchToLinearSrgb(gray))).toBeCloseTo(0.18447, 4)
    expect(contrastRatio(gray, 'oklch(1 0 0)')).toBeCloseTo(4.4776, 2)
  })
})
