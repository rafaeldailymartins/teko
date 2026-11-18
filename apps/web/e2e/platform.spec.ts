import { expect, test } from '@playwright/test'
import en from '../messages/en.json' with { type: 'json' }
import { enforcedViolations, recordViolations } from './support/csp.ts'

/** Endpoint de relatórios com a chave fictícia dos erros do `infra/ci/up.sh`. */
const REPORT_ENDPOINT = 'https://eu.i.posthog.com/report/?token=phc_teko_ci_e2e_ficticia'

/**
 * Rotas de plataforma e segurança do estático na stack de CI (Caddy com os snippets de
 * `scripts/caddy-static-site.ts`, a mesma semântica das rotas da Vercel): 404 por
 * locale, redirect da raiz, `/_next/static/*` imutável, headers de segurança e a CSP por documento,
 * com os hashes do HTML exportado. A CSP não pode barrar nada do próprio export.
 */

test.describe('rotas de plataforma', () => {
  test('caminho inexistente em /en/ responde 404 com a página em inglês', async ({ page }) => {
    await recordViolations(page)
    const response = await page.goto('/en/xyz')
    expect(response?.status()).toBe(404)
    expect(new URL(page.url()).pathname).toBe('/en/xyz/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.notFound.title)
    await page.waitForLoadState('networkidle')
    expect(await enforcedViolations(page)).toEqual([])
  })

  test('a raiz redireciona pelo Accept-Language, sem cache compartilhado', async ({ request }) => {
    test.skip(test.info().project.name === 'mobile', 'sem interface')
    for (const [language, location] of [
      ['en-US,en;q=0.9', '/en/'],
      ['pt-BR,pt;q=0.9', '/pt-BR/'],
    ] as const) {
      const response = await request.get('/', {
        headers: { 'accept-language': language },
        maxRedirects: 0,
      })
      expect(response.status()).toBe(302)
      expect(response.headers()['location']).toBe(location)
      expect(response.headers()['cache-control']).toBe('private, no-store')
    }
  })
})

test.describe('segurança no navegador', () => {
  test('headers de segurança e CSP com hash na página', async ({ page }) => {
    const response = await page.goto('/pt-BR/')
    expect(response?.status()).toBe(200)
    const headers = response?.headers() ?? {}
    const csp = headers['content-security-policy'] ?? ''
    expect(csp).toMatch(/^default-src 'self'; script-src 'self'( 'sha256-[A-Za-z0-9+/=]+')+;/)
    for (const directive of [
      "style-src-attr 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "worker-src 'self'",
      "connect-src 'self' https://eu.i.posthog.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ]) {
      expect(csp).toContain(directive)
    }
    expect(csp).not.toContain('strict-dynamic')
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(Buffer.byteLength(csp)).toBeLessThanOrEqual(6 * 1024)
    // A stack builda com a chave fictícia dos erros: as violações das duas políticas vão ao
    // endpoint de relatórios do PostHog na UE (ADR 0037).
    const report = `report-uri ${REPORT_ENDPOINT}; report-to posthog`
    expect(csp.endsWith(`upgrade-insecure-requests; ${report}`)).toBe(true)
    expect(headers['content-security-policy-report-only']).toBe(
      `require-trusted-types-for 'script'; ${report}`,
    )
    expect(headers['reporting-endpoints']).toBe(`posthog="${REPORT_ENDPOINT}"`)
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['strict-transport-security']).toMatch(/^max-age=\d+/)
    expect(headers['cross-origin-opener-policy']).toBe('same-origin')
    expect(headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(headers['permissions-policy']).toContain('camera=()')
  })

  test('a CSP não barra nada do export: o script de tema roda e os chunks carregam', async ({
    page,
  }) => {
    await recordViolations(page)
    await page.addInitScript(() => localStorage.setItem('teko-theme', 'dark'))
    const chunks: { url: string; status: number; cacheControl: string | undefined }[] = []
    page.on('response', (response) => {
      if (new URL(response.url()).pathname.startsWith('/_next/static/')) {
        chunks.push({
          url: response.url(),
          status: response.status(),
          cacheControl: response.headers()['cache-control'],
        })
      }
    })
    await page.goto('/en/')
    await page.waitForLoadState('networkidle')
    // O script inline de tema só roda se o hash dele estiver na CSP.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await enforcedViolations(page)).toEqual([])
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(chunk.status, chunk.url).toBe(200)
      expect(chunk.cacheControl, chunk.url).toBe('public, max-age=31536000, immutable')
    }
  })

  test('os chunks levam o chunk id do PostHog, e os source maps não são servidos', async ({
    page,
    request,
  }) => {
    const scripts: string[] = []
    page.on('response', (response) => {
      const { pathname } = new URL(response.url())
      if (pathname.startsWith('/_next/static/chunks/') && pathname.endsWith('.js')) {
        scripts.push(pathname)
      }
    })
    await page.goto('/en/')
    await page.waitForLoadState('networkidle')
    const [script] = scripts
    expect(script, 'algum chunk carregado').toBeDefined()
    const body = await (await request.get(script ?? '')).text()
    // `scripts/sourcemaps.ts inject` (offline, no up.sh): o snippet e o comentário do chunk id.
    expect(body).toMatch(/\/\/# chunkId=[0-9a-f-]{36}\s*$/)
    expect(body).toContain('_posthogChunkIds')
    const map = await request.get(`${script ?? ''}.map`)
    expect(map.status()).toBe(404)
    expect(await map.text()).not.toContain('"mappings"')
  })
})
