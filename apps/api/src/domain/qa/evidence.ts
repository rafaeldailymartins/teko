import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
import { containsDate } from '@teko/shared/vigencia'

/**
 * Evidência devolvida pela busca híbrida: um chunk com a vigência da redação (`chunks.valid_during`)
 * e a versão de documento escolhida para a citação (a publicada cuja vigência contém a data, ou o
 * snapshot publicado mais recente que contém o chunk).
 */
export interface Evidence {
  readonly chunkId: string
  readonly stableKey: string
  readonly family: string
  readonly citationLabel: string
  readonly content: string
  /** Caminho de títulos do dispositivo ("RCTE > … > Art. 20 > inciso I"). */
  readonly headingPath: string
  /**
   * Texto dos dispositivos ancestrais vigentes na data de referência, da raiz para o pai imediato
   * (o caput do artigo, o inciso de uma alínea, o registro de um campo). Um inciso curto
   * ("I - 17% …") só se entende com o caput ("As alíquotas do imposto são:").
   */
  readonly ancestors: readonly string[]
  /** Vigência da redação citada (a que o usuário vê), nunca a do snapshot do documento. */
  readonly validity: ValidityInterval
  readonly document: {
    readonly versionId: string
    readonly versionLabel: string
    readonly title: string
    readonly sourceUrl: string
  }
  /** Pontuação RRF (k = 60) e posição em cada braço (`null` = ausente do braço). */
  readonly rrf: number
  readonly lexicalRank: number | null
  readonly semanticRank: number | null
  readonly referenceRank: number | null
}

/** Invariante da busca: toda evidência está em vigor na data de referência. */
export function isValidAt(evidence: Evidence, date: IsoDate): boolean {
  return containsDate(evidence.validity, date)
}

/** Maior RRF da lista (0 se vazia), comparado com `MIN_EVIDENCE_RRF` para recusar sem LLM. */
export function maxRrf(evidence: readonly Evidence[]): number {
  return evidence.reduce((max, item) => Math.max(max, item.rrf), 0)
}

/** Trecho de cada ancestral no texto do reranker e o teto somado deles (o pai imediato primeiro). */
const ANCESTOR_EXCERPT_CHARS = 200
export const ANCESTORS_BUDGET_CHARS = 600

/** Primeiros `limit` caracteres do texto, com espaços colapsados, cortados em fim de palavra. */
function excerpt(text: string, limit: number): string {
  const flat = text
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .join(' ')
  if (flat.length <= limit) {
    return flat
  }
  const cut = flat.lastIndexOf(' ', limit)
  return `${flat.slice(0, cut > limit / 2 ? cut : limit)}…`
}

/**
 * Trechos dos ancestrais que acompanham a evidência (reranker e prompt): do pai imediato para cima,
 * até o teto, devolvidos na ordem de leitura (da raiz para o pai).
 */
export function ancestorExcerpts(evidence: Evidence): string[] {
  const kept: string[] = []
  let used = 0
  for (const ancestor of [...evidence.ancestors].reverse()) {
    const piece = excerpt(ancestor, ANCESTOR_EXCERPT_CHARS)
    if (used + piece.length > ANCESTORS_BUDGET_CHARS) {
      break
    }
    if (piece.length > 0) {
      kept.unshift(piece)
      used += piece.length
    }
  }
  return kept
}

/**
 * Texto que o reranker pontua contra a pergunta: o caminho de títulos, os trechos dos ancestrais e
 * o conteúdo do chunk. O `bge-reranker-base` corta o par em 512 tokens: o contexto tem teto e o
 * conteúdo vem inteiro.
 */
export function rerankText(evidence: Evidence): string {
  return [evidence.headingPath, ...ancestorExcerpts(evidence), evidence.content].join('\n')
}
