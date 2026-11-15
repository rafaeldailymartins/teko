import {
  type IsoDate,
  isoDateSchema,
  periodoApuracaoSchema,
  type ReferenceInput,
  referenceDateFromInput,
} from '@teko/shared/vigencia'

/**
 * Data de referência no cliente: o usuário escolhe um período de apuração (`2024-03`) ou uma data
 * exata (`2024-03-15`), na mesma forma do corpo de `POST /questions` (`ReferenceInput`). O valor vai
 * para a URL (`?ref=`) e para as query keys das respostas que dependem dele.
 */

/** Lê `2024-03` como período e `2024-03-15` como data; qualquer outra coisa é `null`. */
export function parseReference(value: string): ReferenceInput | null {
  const periodo = periodoApuracaoSchema.safeParse(value)
  if (periodo.success) {
    return { periodoApuracao: periodo.data }
  }
  const date = isoDateSchema.safeParse(value)
  return date.success ? { referenceDate: date.data } : null
}

/** Forma da URL: o próprio período ou a própria data. */
export function serializeReference(reference: ReferenceInput): string {
  return reference.periodoApuracao === undefined
    ? reference.referenceDate
    : reference.periodoApuracao
}

/**
 * Data efetiva de uma referência (o período resolve para o dia 1, como na API). É o valor que entra
 * na query key: `2024-03` e `2024-03-01` pedem a mesma redação e dividem o cache.
 */
export function referenceKeyDate(reference: ReferenceInput): IsoDate {
  return referenceDateFromInput(reference)
}
