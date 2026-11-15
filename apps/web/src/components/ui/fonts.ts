import { Geist, Geist_Mono, Source_Serif_4 } from 'next/font/google'

/**
 * Fontes self-hosted no build (`next/font/google`): o Next baixa os arquivos no build e os serve da
 * própria origem, sem nenhum pedido ao Google em runtime, o que mantém `font-src 'self'` no CSP. Os
 * pacotes npm com os arquivos (`geist`, `@fontsource-variable/*`) são OFL-1.1, fora da allowlist de
 * licenças do `dependency-review`, então ficam de fora. Geist na UI; Geist Mono em registros, campos
 * e números (`tabular-nums`); Source Serif 4 nos títulos e no texto legal.
 */
const sans = Geist({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-geist-sans',
  display: 'swap',
})

const mono = Geist_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-geist-mono',
  display: 'swap',
  preload: false,
})

const serif = Source_Serif_4({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-source-serif',
  display: 'swap',
  preload: false,
})

/**
 * Classes do `<html>` que definem `--font-geist-sans`, `--font-geist-mono` e `--font-source-serif`
 * (lidas pelos `font-sans`/`font-mono`/`font-serif` do tema). Todo documento (layout de locale,
 * entrada `/`, 404 global) aplica as três; sem elas o texto cai nas fontes do sistema.
 */
export const FONT_VARIABLES_CLASS_NAME = `${sans.variable} ${mono.variable} ${serif.variable}`
