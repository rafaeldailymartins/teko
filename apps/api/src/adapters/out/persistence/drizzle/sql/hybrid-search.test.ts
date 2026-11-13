import { describe, expect, it } from 'vitest'
import {
  ARM_LIMIT,
  HNSW_SETTINGS_SQL,
  HYBRID_SEARCH_SQL,
  LEXICAL_ONLY_SQL,
  RRF_K,
  toVectorLiteral,
} from './hybrid-search.ts'

function placeholders(sql: string): number[] {
  return [...new Set([...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])))].sort(
    (a, b) => a - b,
  )
}

describe('SQL da busca híbrida', () => {
  it('as duas variantes usam os mesmos 7 parâmetros', () => {
    expect(placeholders(HYBRID_SEARCH_SQL)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(placeholders(LEXICAL_ONLY_SQL)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('o modo híbrido ordena o braço vetorial pelo vetor; o léxico não tem braço vetorial', () => {
    expect(HYBRID_SEARCH_SQL).toContain('ORDER BY c.embedding <=> $2::halfvec(1024)')
    expect(HYBRID_SEARCH_SQL).toContain("'sem' FROM semantic")
    expect(LEXICAL_ONLY_SQL).not.toContain('semantic')
    expect(LEXICAL_ONLY_SQL).toContain('$2::text')
    for (const sql of [HYBRID_SEARCH_SQL, LEXICAL_ONLY_SQL]) {
      expect(sql).toContain(`sum(1.0 / (${String(RRF_K)} + rnk))`)
      expect(sql).toContain('c.valid_during @> $3::date AND upper_inf(c.knowledge)')
      expect(sql).toContain('p.stable_key = ANY($5::text[])')
      expect(sql).toContain('LIMIT $7::int')
      expect(sql).toContain('lower(c.valid_during)::text AS valid_from')
      expect(sql).toContain('upper(c.valid_during)::text AS valid_to')
    }
    expect(ARM_LIMIT).toBe(50)
    // Os três ajustes locais à transação num só SELECT, sem parâmetros (protocolo simples).
    expect(HNSW_SETTINGS_SQL).toContain("set_config('hnsw.iterative_scan', 'relaxed_order', true)")
    expect(HNSW_SETTINGS_SQL).toContain("set_config('hnsw.ef_search', '100', true)")
    expect(HNSW_SETTINGS_SQL).toContain("set_config('hnsw.max_scan_tuples', '20000', true)")
    expect(placeholders(HNSW_SETTINGS_SQL)).toEqual([])
  })

  it('toVectorLiteral gera o literal do halfvec e recusa valores não finitos', () => {
    expect(toVectorLiteral([0.5, -1, 0])).toBe('[0.5,-1,0]')
    expect(() => toVectorLiteral([1, Number.NaN])).toThrow(/não finito/)
    expect(() => toVectorLiteral([Number.POSITIVE_INFINITY])).toThrow(RangeError)
  })
})
