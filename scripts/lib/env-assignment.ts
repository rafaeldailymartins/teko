/**
 * Detecção de env var "com valor" num arquivo do `.vercel/output` (`pack-vercel-output.ts`): linha
 * de dotenv (`NOME=valor`, opcionalmente com `export`) ou chave JSON com string não vazia
 * (`"NOME": "valor"`).
 *
 * A chave JSON só conta depois de `{` ou `,` (ou no início do arquivo), que é onde uma chave pode
 * estar. Sem isso, um ternário do código compilado com dois nomes entre aspas
 * (`a ? "LANGFUSE_PUBLIC_KEY" : "LANGFUSE_SECRET_KEY"`) parecia `"NOME": "valor"` e derrubava o
 * primeiro deploy da F7. O código-fonte compilado cita os nomes (`env.WEB_ORIGIN`,
 * `issue('NODE_ENV', ...)`) sem casar com nenhum dos dois formatos.
 */
export function envAssignmentPattern(names: readonly string[]): RegExp {
  if (names.length === 0) {
    throw new Error('envAssignmentPattern: nenhum nome')
  }
  const alternatives = names.map(escapeRegExp).join('|')
  return new RegExp(
    `(?:^|\\n)[ \\t]*(?:export[ \\t]+)?(?:${alternatives})=\\S|(?:^|[{,])\\s*"(?:${alternatives})"\\s*:\\s*"[^"]`,
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
