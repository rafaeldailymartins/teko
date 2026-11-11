import { Geist, Source_Serif_4 } from 'next/font/google'

/**
 * Fontes self-hosted no build (`next/font/google`): nenhum pedido ao Google em runtime, o que
 * mantém `font-src 'self'` no CSP. Geist na UI; Source Serif 4 nos títulos e no texto legal.
 */
const sans = Geist({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-geist-sans',
  display: 'swap',
})

const serif = Source_Serif_4({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-source-serif',
  display: 'swap',
  preload: false,
})

/**
 * Classes do `<html>` que definem `--font-geist-sans` e `--font-source-serif` (lidas pelos
 * `font-sans`/`font-serif` do tema). Todo documento (layout de locale, entrada `/`, 404 global)
 * aplica as duas; sem elas o texto cai nas fontes do sistema.
 */
export const FONT_VARIABLES_CLASS_NAME = `${sans.variable} ${serif.variable}`
