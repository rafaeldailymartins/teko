import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseGitleaksReport, summarizeGitleaks } from './gitleaks-report.ts'

const REPORT = JSON.stringify([
  {
    RuleID: 'generic-api-key',
    File: '/work/.vercel/output/static/_next/b.js',
    StartLine: 3,
    Secret: 'NAO-PODE-APARECER',
    Match: 'apiKey: "NAO-PODE-APARECER"',
  },
  { RuleID: 'jwt', File: '/work/.vercel/output/functions/index.func/a.mjs', StartLine: 10 },
  { RuleID: 'generic-api-key', File: '/work/.vercel/output/static/_next/a.js', StartLine: 1 },
  { File: 7 },
])

describe('parseGitleaksReport e summarizeGitleaks', () => {
  it('lista regra, arquivo relativo e linha, sem o segredo', () => {
    const findings = parseGitleaksReport(REPORT, '/work/.vercel/output')
    const summary = summarizeGitleaks(findings)
    assert.equal(
      summary,
      [
        '4 achado(s) (?: 1, generic-api-key: 2, jwt: 1)',
        '  ? ?:0',
        '  jwt functions/index.func/a.mjs:10',
        '  generic-api-key static/_next/a.js:1',
        '  generic-api-key static/_next/b.js:3',
      ].join('\n'),
    )
    assert.ok(!summary.includes('NAO-PODE-APARECER'))
  })

  it('aceita caminhos do Windows e corta a lista no limite', () => {
    const findings = parseGitleaksReport(
      JSON.stringify([
        { RuleID: 'r', File: 'C:\\out\\x.js', StartLine: 2 },
        { RuleID: 'r', File: 'C:\\out\\y.js', StartLine: 1 },
      ]),
      'C:\\out',
    )
    assert.deepEqual(
      findings.map((f) => f.file),
      ['x.js', 'y.js'],
    )
    assert.match(summarizeGitleaks(findings, 1), /x\.js:2\n {2}… e mais 1$/)
  })

  it('recusa relatório que não é lista', () => {
    assert.throws(() => parseGitleaksReport('{}', '/x'), /não é uma lista/)
  })
})
