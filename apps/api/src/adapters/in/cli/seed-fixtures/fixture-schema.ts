import { isoDateSchema, validityIntervalSchema } from '@teko/shared/vigencia'
import { z } from 'zod'
import {
  ChangeKind,
  FAMILIES,
  Modality,
  ReviewStatus,
  ValidityBasis,
} from '#domain/corpus/family.ts'
import { isStableKey } from '#domain/corpus/provision-id.ts'

/**
 * Formato da fixture única do corpus (`apps/api/test/fixtures/corpus/`): um JSON por documento em
 * `documents/<slug>.json` e a cobertura em `coverage.json`. É a entrada do `seed-fixtures`, que a
 * grava no Postgres pelo mesmo `IngestDocumentVersion` da ingestão real (uma versão de documento
 * por vez: chunking, hashes, embeddings pelo cache, reconciliação, `chunk_sources`), seguido do
 * `RefreshCoverage` e da cobertura declarada aqui. Os textos são excertos reais das fontes
 * oficiais; a procedência de cada documento fica no `README.md` da fixture.
 */

const stableKeySchema = z.string().refine(isStableKey, { message: 'stable_key inválida' })
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const intervalSchema = validityIntervalSchema

const fixtureAmendmentSchema = z.strictObject({
  /** Ex.: "Decreto nº 6.026, de 27.10.04". */
  actLabel: z.string().min(1),
  /** Ex.: "decreto", "lei", "ato-cotepe", "nota-tecnica". */
  actKind: z.string().regex(/^[a-z-]+$/),
  actDate: isoDateSchema,
  effectiveFrom: isoDateSchema,
  changeKind: z.enum(ChangeKind),
  /** Nota da fonte, como publicada (ex.: "CONFERIDA NOVA REDAÇÃO AO § 6º ... - vigência: 04.11.04."). */
  rawNote: z.string().min(1),
})

const fixtureProvisionVersionSchema = z.strictObject({
  /** Rótulo exibido na data (ex.: "RCTE, art. 76, § 6º"). Vira o `citation_label` do chunk. */
  displayLabel: z.string().min(1),
  validDuring: intervalSchema.refine((interval) => interval.from !== null, {
    message: 'valid_during precisa de limite inferior',
  }),
  /**
   * Informativo (o `eval-fixture export` o grava quando difere do padrão `[publishedOn da primeira
   * versão de documento citada, ∞)`). O seed não o usa: o conhecimento sai da ingestão, como no
   * staging. Só conhecimento atual (`to: null`): a fixture não tem redação superada.
   */
  knowledge: intervalSchema
    .refine((interval) => interval.to === null, {
      message: 'knowledge da fixture é sempre atual (to: null)',
    })
    .optional(),
  modality: z.enum(Modality).default(Modality.Mandatory),
  validityBasis: z.enum(ValidityBasis),
  retroactive: z.boolean().default(false),
  reviewStatus: z.enum(ReviewStatus).default(ReviewStatus.Auto),
  text: z.string().trim().min(1),
  /** Dados estruturados (ex.: campo do Guia: nome, tipo, tamanho, obrigatoriedade). */
  structured: z.record(z.string(), z.unknown()).optional(),
  amendment: fixtureAmendmentSchema.optional(),
  /** Chaves (`versions[].key`) das versões de documento que contêm esta redação. */
  documentVersions: z.array(z.string().min(1)).min(1),
})

const fixtureProvisionSchema = z.strictObject({
  stableKey: stableKeySchema,
  /** Ex.: "artigo", "paragrafo", "inciso", "alinea", "registro", "campo", "evento", "codigo". */
  kind: z.string().regex(/^[a-z-]+$/),
  parent: stableKeySchema.optional(),
  /** Ordem dentro do documento (ex.: "0076.p06.i02"); só ordena, não é exibido. */
  sortPath: z.string().min(1).max(120),
  /** Ex.: "RCTE > Livro I > Título III > Capítulo II > Art. 76 > § 6º". Entra no `tsv` com peso A. */
  headingPath: z.string().min(1),
  versions: z.array(fixtureProvisionVersionSchema).min(1),
})

const fixtureDocumentVersionSchema = z.strictObject({
  /** Identificador local, referenciado por `provisions[].versions[].documentVersions`. */
  key: z.string().min(1),
  versionLabel: z.string().min(1),
  publishedOn: isoDateSchema,
  /** Snapshot (consolidados) ou vigência do leiaute; não é a vigência do dispositivo. */
  validDuring: intervalSchema,
  consolidatedUntil: z.string().min(1).nullable().default(null),
  actRef: z.string().min(1).nullable().default(null),
  /** sha256 do arquivo-fonte baixado. */
  sha256: sha256Schema,
})

export const fixtureDocumentSchema = z
  .strictObject({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    family: z.enum(FAMILIES),
    title: z.string().min(1),
    issuer: z.string().min(1),
    sourceUrl: z.url({ protocol: /^https$/ }),
    versions: z.array(fixtureDocumentVersionSchema).min(1),
    provisions: z.array(fixtureProvisionSchema).min(1),
  })
  .superRefine((doc, ctx) => {
    const versionKeys = new Set(doc.versions.map((version) => version.key))
    const stableKeys = new Set<string>()
    for (const [index, provision] of doc.provisions.entries()) {
      if (stableKeys.has(provision.stableKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['provisions', index, 'stableKey'],
          message: 'stable_key repetida',
        })
      }
      stableKeys.add(provision.stableKey)
      if (!provision.stableKey.split(':').slice(0, 2).join(':').endsWith(`:${doc.family}`)) {
        ctx.addIssue({
          code: 'custom',
          path: ['provisions', index, 'stableKey'],
          message: `stable_key fora da família ${doc.family}`,
        })
      }
      for (const [versionIndex, version] of provision.versions.entries()) {
        for (const key of version.documentVersions) {
          if (!versionKeys.has(key)) {
            ctx.addIssue({
              code: 'custom',
              path: ['provisions', index, 'versions', versionIndex, 'documentVersions'],
              message: `versão de documento desconhecida: ${key}`,
            })
          }
        }
      }
    }
    for (const [index, provision] of doc.provisions.entries()) {
      if (provision.parent !== undefined && !stableKeys.has(provision.parent)) {
        ctx.addIssue({
          code: 'custom',
          path: ['provisions', index, 'parent'],
          message: `pai ausente do documento: ${provision.parent}`,
        })
      }
    }
  })

export type FixtureDocument = z.output<typeof fixtureDocumentSchema>

export const fixtureCoverageSchema = z.array(
  z.strictObject({
    family: z.enum(FAMILIES),
    covered: z.array(intervalSchema).min(1),
    verifiedAt: isoDateSchema,
    gaps: z
      .array(z.strictObject({ interval: intervalSchema, reason: z.string().min(1) }))
      .default([]),
  }),
)

export type FixtureCoverage = z.output<typeof fixtureCoverageSchema>
