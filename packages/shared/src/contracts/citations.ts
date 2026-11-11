import { z } from 'zod'
import { validityIntervalSchema } from '../vigencia/schemas.ts'
import { familySchema, jurisdictionSchema, stableKeySchema } from './common.ts'

/** Identificador da fonte dentro da resposta: `S1`, `S2`, ... (vira o link `cite:S1` no markdown). */
export const citationIdSchema = z.string().regex(/^S[1-9]\d*$/)

/**
 * Citação de uma fonte usada na resposta: dispositivo, documento, versão e intervalo de
 * vigência. Enviada como `data-citation` (um por fonte) e atualizada no lugar, com o mesmo `id`
 * e `valid: false`, quando o `CitationValidator` a invalida no fim do stream.
 */
export const citationSchema = z
  .object({
    id: citationIdSchema,
    stableKey: stableKeySchema,
    /** Rótulo exibido do dispositivo na data, ex.: "RCTE, art. 76, § 6º, II". */
    label: z.string().min(1),
    family: familySchema,
    jurisdiction: jurisdictionSchema,
    document: z.object({
      title: z.string().min(1),
      /** Ex.: "Guia Prático 3.1.6" ou "RCTE consolidado até o Decreto nº ...". */
      versionLabel: z.string().min(1),
      sourceUrl: z.url({ protocol: /^https?$/ }),
    }),
    /** Vigência da redação citada (`chunks.valid_during`), não a do snapshot do documento. */
    validity: validityIntervalSchema,
    /** A redação citada é a vigente hoje. */
    isCurrent: z.boolean(),
    /** Trecho citado (texto legal em pt-BR). */
    excerpt: z.string().optional(),
    /** `false` quando o `CitationValidator` rejeitou a citação. */
    valid: z.boolean(),
  })
  .meta({ description: 'Fonte citada na resposta' })

export type Citation = z.infer<typeof citationSchema>
