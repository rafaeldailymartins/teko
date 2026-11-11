import { z } from 'zod'
import { isIsoDate } from './iso-date.ts'
import { isPeriodoApuracao } from './periodo-apuracao.ts'
import { ReferenceSource } from './reference-date.ts'
import { isNonEmptyInterval } from './validity-interval.ts'

/**
 * Schemas Zod dos valores de vigência, usados pelos contratos HTTP e pela validação de env/CLI.
 * `z.iso.date()` já rejeita datas inexistentes (ex.: 2023-02-29); o refine extra só exclui o ano
 * 0000, que o Postgres e o resto do domínio não aceitam.
 */
export const isoDateSchema = z.iso
  .date()
  .refine(isIsoDate, { message: 'Data fora do intervalo suportado (0001-01-01 a 9999-12-31)' })
  .meta({ description: 'Data de calendário ISO 8601 (AAAA-MM-DD)', example: '2024-03-01' })

export const periodoApuracaoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .refine(isPeriodoApuracao, { message: 'Período de apuração inválido (use AAAA-MM)' })
  .meta({ description: 'Período de apuração mensal (AAAA-MM)', example: '2024-03' })

export const referenceSourceSchema = z.enum(ReferenceSource)

/** Intervalo `[from, to)` serializado; `to: null` = em vigor, `from: null` = sem limite inferior. */
export const validityIntervalSchema = z
  .object({
    from: isoDateSchema.nullable(),
    to: isoDateSchema.nullable(),
  })
  .refine((interval) => isNonEmptyInterval(interval.from, interval.to), {
    message: 'Intervalo vazio: "from" deve ser anterior a "to"',
    path: ['to'],
  })
  .meta({ description: 'Intervalo de vigência [from, to) com semântica de daterange do Postgres' })
