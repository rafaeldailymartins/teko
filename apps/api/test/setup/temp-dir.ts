import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'

/**
 * Cria uma pasta temporária (`<tmpdir>/<prefix>XXXXXX`) e agenda a remoção para quando o teste
 * corrente terminar, passe ou falhe. Chame no corpo do teste ou num `beforeEach`: o
 * `onTestFinished` exige um teste corrente. Uma pasta compartilhada pelos testes de um `describe`
 * nasce no `beforeAll` e sai no `afterAll`, com `removeTempDir`.
 */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  onTestFinished(() => removeTempDir(dir))
  return dir
}

/** Remove a pasta e o conteúdo; no Windows, um arquivo ainda aberto pede algumas tentativas. */
export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
}
