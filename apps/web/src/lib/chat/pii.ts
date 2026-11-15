import { PII_KINDS, type PiiKind, redact } from '@teko/shared/pii'

/**
 * Detector de PII do composer: as mesmas regex e validações de DV que a API usa antes de gravar a
 * pergunta (`@teko/shared/pii`). A UI avisa antes de enviar e oferece trocar cada dado pelo marcador
 * (`[CPF]`, `[EMAIL]`...); a API redige de qualquer forma.
 */
export function detectPii(text: string): PiiKind[] {
  const { counts } = redact(text)
  return PII_KINDS.filter((kind) => counts[kind] > 0)
}

export function removePii(text: string): string {
  return redact(text).text
}
