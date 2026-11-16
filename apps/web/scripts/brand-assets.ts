/**
 * Gera os arquivos da marca a partir da logo (`docs/assets/logo.svg`), sem serviço externo:
 *
 * - `public/icon.svg`: o favicon (cópia da logo).
 *
 * Os ícones ficam em `public/` e entram por `metadata.icons` (`SITE_ICONS` em `src/lib/site.ts`),
 * não pela convenção `src/app/icon.svg`: o Next registra esses arquivos como route handlers no
 * `app-path-routes-manifest.json`, que o guard do estático (`scripts/lib/static-guard.ts`) recusa.
 *
 * Os outros dois:
 *
 * - `public/apple-icon.png`: 180 × 180, com o fundo até a borda (o iOS arredonda sozinho e
 *   pintaria de preto os cantos transparentes);
 * - `public/og.png`: a imagem do Open Graph, 1200 × 630, o selo e o nome sobre o petróleo.
 *
 * Os PNG saem do Chromium do Playwright (o mesmo dos e2e). Rode depois de mudar a logo
 * (`pnpm --filter @teko/web brand:assets`) e commite o resultado.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const WEB_DIR = resolve(import.meta.dirname, '..')
const LOGO = resolve(WEB_DIR, '../../docs/assets/logo.svg')

const logo = readFileSync(LOGO, 'utf8')
/** A logo sem os cantos arredondados do fundo, para o ícone da Apple. */
const fullBleed = logo.replaceAll('rx="60"', 'rx="0"')

function page(body: string, width: number, height: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
svg{display:block}
</style></head><body>${body}</body></html>`
}

const OG = page(
  `<div style="width:1200px;height:630px;display:flex;align-items:center;justify-content:center;gap:56px;
background:radial-gradient(900px 500px at 15% -10%,rgba(127,216,200,.22),transparent 70%),linear-gradient(135deg,#005766,#003540);
font-family:'Source Serif 4','Source Serif Pro',Georgia,serif;color:#fff">
  <div style="width:240px;height:240px;border-radius:56px;box-shadow:0 24px 60px rgba(0,20,26,.45)">${logo.replace('<svg ', '<svg width="240" height="240" ')}</div>
  <div style="display:flex;flex-direction:column;gap:18px">
    <div style="font-size:150px;font-weight:600;letter-spacing:-3px;line-height:1">Tekó</div>
    <div style="height:4px;width:420px;border-radius:2px;background:linear-gradient(90deg,#38a37a,#7fd8c8 60%,rgba(127,216,200,0))"></div>
  </div>
</div>`,
  1200,
  630,
)

const APPLE = page(fullBleed.replace('<svg ', '<svg width="180" height="180" '), 180, 180)

copyFileSync(LOGO, join(WEB_DIR, 'public/icon.svg'))

const browser = await chromium.launch()
try {
  for (const [html, width, height, out] of [
    [APPLE, 180, 180, 'public/apple-icon.png'],
    [OG, 1200, 630, 'public/og.png'],
  ] as const) {
    const tab = await browser.newPage({ viewport: { width, height } })
    await tab.setContent(html)
    mkdirSync(join(WEB_DIR, out, '..'), { recursive: true })
    await tab.screenshot({ path: join(WEB_DIR, out) })
    await tab.close()
  }
} finally {
  await browser.close()
}
console.log('public/icon.svg, public/apple-icon.png e public/og.png gerados.')
