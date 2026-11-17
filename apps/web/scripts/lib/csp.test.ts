import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildHeadersManifest,
  CspConfigError,
  CspTooLargeError,
  contentSecurityPolicy,
  MAX_CSP_BYTES,
  REPORT_GROUP,
  reportingEndpoint,
  sha256Source,
  TRUSTED_TYPES_REPORT_ONLY,
  trustedTypesReportOnly,
} from './csp.ts'
import type { ParsedDocument } from './html.ts'

const doc = (inlineScripts: string[] = [], inlineStyles: string[] = []): ParsedDocument => ({
  inlineScripts,
  inlineStyles,
  firstLoadScripts: [],
})

describe('sha256Source', () => {
  it('é o hash que o navegador espera (UTF-8, base64)', () => {
    expect(sha256Source('')).toBe("'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='")
    const expected = createHash('sha256').update('alert("Tekó")', 'utf8').digest('base64')
    expect(sha256Source('alert("Tekó")')).toBe(`'sha256-${expected}'`)
  })
})

describe('contentSecurityPolicy', () => {
  it('monta a CSP do desenho, com os hashes deduplicados e ordenados', () => {
    const csp = contentSecurityPolicy(doc(['b()', 'a()', 'b()'], ['p{}']))
    const scripts = [sha256Source('a()'), sha256Source('b()')].sort().join(' ')
    const style = sha256Source('p{}')
    expect(csp).toBe(
      [
        "default-src 'self'",
        `script-src 'self' ${scripts}`,
        `style-src-elem 'self' ${style}`,
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "worker-src 'self'",
        "connect-src 'self' https://eu.i.posthog.com https://eu-assets.i.posthog.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        'upgrade-insecure-requests',
      ].join('; '),
    )
  })

  it("sem 'strict-dynamic' nem 'unsafe-inline' em scripts e elementos de estilo", () => {
    const csp = contentSecurityPolicy(doc(['x()'], ['y{}']))
    expect(csp).not.toContain('strict-dynamic')
    expect(csp).not.toMatch(/(?:script-src|style-src-elem)[^;]*'unsafe-inline'/)
    expect(contentSecurityPolicy(doc())).toContain("script-src 'self'; style-src-elem 'self';")
  })
})

describe('buildHeadersManifest', () => {
  it('dá a cada HTML a própria CSP e o Trusted Types em report-only', () => {
    const manifest = buildHeadersManifest(
      new Map([
        ['en/index.html', doc(['en()'])],
        ['404.html', doc(['nf()'])],
      ]),
    )
    expect(manifest.version).toBe(1)
    expect(Object.keys(manifest.documents)).toEqual(['404.html', 'en/index.html'])
    expect(manifest.documents['en/index.html']).toEqual({
      'Content-Security-Policy': contentSecurityPolicy(doc(['en()'])),
      'Content-Security-Policy-Report-Only': TRUSTED_TYPES_REPORT_ONLY,
    })
    expect(TRUSTED_TYPES_REPORT_ONLY).toBe("require-trusted-types-for 'script'")
  })

  it('falha se a CSP de um documento passar de 6 KB', () => {
    const many = Array.from({ length: 120 }, (_, index) => `s${index}()`)
    expect(MAX_CSP_BYTES).toBe(6144)
    expect(() => buildHeadersManifest(new Map([['grande.html', doc(many)]]))).toThrow(
      CspTooLargeError,
    )
    expect(() => buildHeadersManifest(new Map([['ok.html', doc(many.slice(0, 80))]]))).not.toThrow()
  })
})

describe('relatórios ao PostHog (ADR 0037)', () => {
  const KEY = 'phc_teko_ci_e2e_ficticia'
  const ENDPOINT = `https://eu.i.posthog.com/report/?token=${KEY}`

  it('sem a chave, a CSP e os headers ficam como estavam', () => {
    const manifest = buildHeadersManifest(new Map([['en/index.html', doc(['en()'])]]), {
      reportKey: undefined,
    })
    expect(manifest.documents['en/index.html']).toEqual({
      'Content-Security-Policy': contentSecurityPolicy(doc(['en()'])),
      'Content-Security-Policy-Report-Only': TRUSTED_TYPES_REPORT_ONLY,
    })
    expect(contentSecurityPolicy(doc())).not.toMatch(/report-/)
  })

  it('com a chave: report-uri e report-to nas duas políticas e o Reporting-Endpoints', () => {
    expect(reportingEndpoint(KEY)).toBe(ENDPOINT)
    const options = { reportKey: KEY }
    const csp = contentSecurityPolicy(doc(['x()']), options)
    expect(
      csp.endsWith(`upgrade-insecure-requests; report-uri ${ENDPOINT}; report-to posthog`),
    ).toBe(true)
    const manifest = buildHeadersManifest(new Map([['en/index.html', doc(['x()'])]]), options)
    expect(manifest.documents['en/index.html']).toEqual({
      'Content-Security-Policy': csp,
      'Content-Security-Policy-Report-Only': `${TRUSTED_TYPES_REPORT_ONLY}; report-uri ${ENDPOINT}; report-to ${REPORT_GROUP}`,
      'Reporting-Endpoints': `posthog="${ENDPOINT}"`,
    })
    expect(trustedTypesReportOnly()).toBe(TRUSTED_TYPES_REPORT_ONLY)
  })

  it('uma chave fora do formato derruba o build (nada de injetar diretiva)', () => {
    for (const key of ['phx_pessoal', "phc_x; script-src 'unsafe-inline'", 'phc_"x"', '']) {
      expect(() => buildHeadersManifest(new Map([['a.html', doc()]]), { reportKey: key })).toThrow(
        CspConfigError,
      )
    }
  })
})
