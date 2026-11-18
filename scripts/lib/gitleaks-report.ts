/**
 * Resumo do relatório JSON do gitleaks (`--report-format json`) para o log do CI: regra, arquivo e
 * linha de cada achado, nunca o `Secret`, o `Match` nem o trecho da linha. Sem isso, o
 * `pack-vercel-output.ts` só dizia "leaks found: N" e o primeiro deploy da F7 não tinha como saber o
 * que corrigir.
 */
export interface GitleaksFinding {
  readonly rule: string
  readonly file: string
  readonly line: number
}

/** Lê os achados do relatório; campos ausentes ou de outro tipo viram `?` e 0. */
export function parseGitleaksReport(json: string, root: string): GitleaksFinding[] {
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed)) {
    throw new Error('relatório do gitleaks não é uma lista')
  }
  const prefix = root.replaceAll('\\', '/').replace(/\/?$/, '/')
  return parsed.map((item: unknown) => {
    const record = (typeof item === 'object' && item !== null ? item : {}) as Record<
      string,
      unknown
    >
    const file = typeof record['File'] === 'string' ? record['File'].replaceAll('\\', '/') : '?'
    return {
      rule: typeof record['RuleID'] === 'string' ? record['RuleID'] : '?',
      file: file.startsWith(prefix) ? file.slice(prefix.length) : file,
      line: typeof record['StartLine'] === 'number' ? record['StartLine'] : 0,
    }
  })
}

/** Contagem por regra e os primeiros `limit` achados, em ordem estável. */
export function summarizeGitleaks(findings: readonly GitleaksFinding[], limit = 40): string {
  const byRule = new Map<string, number>()
  for (const finding of findings) {
    byRule.set(finding.rule, (byRule.get(finding.rule) ?? 0) + 1)
  }
  const rules = [...byRule.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([rule, count]) => `${rule}: ${String(count)}`)
  const sorted = [...findings].sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  )
  const lines = sorted.slice(0, limit).map((f) => `  ${f.rule} ${f.file}:${String(f.line)}`)
  const rest = sorted.length > limit ? [`  … e mais ${String(sorted.length - limit)}`] : []
  return [`${String(findings.length)} achado(s) (${rules.join(', ')})`, ...lines, ...rest].join(
    '\n',
  )
}
