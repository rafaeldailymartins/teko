/**
 * Busca híbrida numa só instrução (plano: "Busca híbrida (uma instrução, RRF k=60)").
 *
 * Parâmetros: $1 pergunta redigida, $2 vetor `halfvec(1024)` em texto (só no modo híbrido),
 * $3 data de referência, $4 famílias, $5 `stable_key` citadas, $6 `review_status` permitidos,
 * $7 limite, $8 parentes acrescentados ao fim (0 sem reranker).
 *
 * - O vetor entra direto no `ORDER BY` do braço semântico, para o planner usar o HNSW, e o filtro de
 *   vigência, família e status fica no mesmo `WHERE`, para o iterative scan
 *   (`hnsw.iterative_scan = relaxed_order`) devolver k linhas mesmo com filtro seletivo. O `dist + 0`
 *   da numeração impede que o planner reaproveite a ordenação do índice fora do braço.
 * - A citação prefere a versão de documento publicada cuja vigência contém $3; se não houver, usa o
 *   snapshot publicado mais recente que contém o chunk (ex.: RCTE consolidado de 2026 citando a
 *   redação de 2006). A vigência citada é sempre a do chunk.
 * - A variante `lexical_only` (embedding indisponível) omite os CTEs `sem` e `semantic`.
 * - As datas da vigência saem como `::text` (`AAAA-MM-DD`): o parser padrão do `pg` cria um `Date`
 *   à meia-noite local, e convertê-lo de volta perde um dia a leste de UTC.
 * - Um resultado por versão de dispositivo (`provision_version_id`, coluna `pv` dos braços): cada
 *   braço ranqueia só o melhor chunk de cada versão, e o RRF soma os votos por versão, com o chunk
 *   mais bem colocado como representante. Sem isso, um dispositivo partido em vários chunks (a
 *   página de um registro da EFD com a tabela de campos) ocupava várias vagas do top-k e dividia o
 *   voto entre chunks diferentes nos braços léxico e vetorial (corpus-eval de 2026-11-12).
 */

/** RRF k = 60 e 50 candidatos por braço (10 no braço exato). */
export const RRF_K = 60
export const ARM_LIMIT = 50
const EXACT_LIMIT = 10
/**
 * O braço léxico ordena em dois estágios: os `LEXICAL_CANDIDATES` melhores por `ts_rank` (barato)
 * e, entre eles, os 50 melhores por `ts_rank_cd` (densidade de cobertura, que favorece termos
 * próximos, como pede o plano). Ordenar todas as linhas por `ts_rank_cd` custava ~140 ms sobre
 * 16 mil casamentos no sql-perf de 100k chunks; o primeiro estágio custa ~40 ms (ADR 0010).
 */
const LEXICAL_CANDIDATES = 200

/**
 * Ajustes do braço vetorial, locais à transação curta (compatível com o PgBouncer em modo
 * transação): `set_config(..., true)` equivale a `SET LOCAL`, e os três vão num só `SELECT`, uma
 * ida ao banco em vez de três. Sem parâmetros, para rodar no protocolo simples junto do `BEGIN`.
 */
export const HNSW_SETTINGS_SQL = `SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true),
  set_config('hnsw.ef_search', '100', true), set_config('hnsw.max_scan_tuples', '20000', true)`

/** Abertura da transação de leitura da busca: com o vetor, já traz os ajustes do HNSW. */
export const BEGIN_SEARCH = 'BEGIN READ ONLY'
export const BEGIN_HYBRID_SEARCH = `${BEGIN_SEARCH}; ${HNSW_SETTINGS_SQL}`

const PUBLISHABLE_FILTER = `c.valid_during @> $3::date AND upper_inf(c.knowledge)
    AND c.family = ANY($4::text[]) AND c.review_status = ANY($6::text[])`

const COMMON_HEAD = `WITH tsq AS MATERIALIZED (
  SELECT coalesce(string_agg(quote_literal(lexeme), ' | '), '')::tsquery AS q
  FROM unnest(to_tsvector('pg_catalog.portuguese', public.immutable_unaccent($1::text)))),
base AS NOT MATERIALIZED (SELECT c.* FROM corpus.chunks c WHERE ${PUBLISHABLE_FILTER}),
lexical_candidates AS MATERIALIZED (
  SELECT b.id, b.provision_version_id AS pv, b.tsv FROM base b, tsq t WHERE b.tsv @@ t.q
  ORDER BY ts_rank(b.tsv, t.q, 1 | 32) DESC, b.id LIMIT ${String(LEXICAL_CANDIDATES)}),
lexical AS (
  SELECT d.id, d.pv, row_number() OVER (ORDER BY d.score DESC, d.id) AS rnk
  FROM (SELECT DISTINCT ON (l.pv) l.id, l.pv, ts_rank_cd(l.tsv, t.q, 1 | 32) AS score
        FROM lexical_candidates l, tsq t ORDER BY l.pv, score DESC, l.id) d
  ORDER BY rnk LIMIT ${String(ARM_LIMIT)}),`

const SEMANTIC_ARMS = `
sem AS MATERIALIZED (
  SELECT c.id, c.provision_version_id AS pv, c.embedding <=> $2::halfvec(1024) AS dist
  FROM corpus.chunks c
  WHERE c.embedding IS NOT NULL AND ${PUBLISHABLE_FILTER}
  ORDER BY c.embedding <=> $2::halfvec(1024) LIMIT ${String(ARM_LIMIT)}),
semantic AS (
  SELECT d.id, d.pv, row_number() OVER (ORDER BY d.dist + 0, d.id) AS rnk
  FROM (SELECT DISTINCT ON (pv) id, pv, dist FROM sem ORDER BY pv, dist, id) d),`

/**
 * Braço da referência citada. A chave citada sempre entra (é a garantia do braço: "art. 76, § 6º"
 * acha o § 6º mesmo sem casar por texto). Os descendentes dela entram só se já estão no braço
 * léxico ou no semântico, e a ordem é a melhor posição em um desses braços (o dispositivo citado
 * sem posição neles vai por último, pelo `sort_path`). Assim "R-4020" escopa a busca ao evento sem
 * dar ao evento inteiro o voto do braço quando a pergunta é sobre um campo dele (ADR 0010).
 */
function exactArm(withSemantic: boolean): string {
  const semanticPool = withSemantic ? 'UNION SELECT id FROM semantic' : ''
  const semanticJoin = withSemantic ? 'LEFT JOIN semantic sr ON sr.pv = c.provision_version_id' : ''
  const semanticRank = withSemantic ? 'sr.rnk' : 'NULL::bigint'
  const semanticId = withSemantic ? 'OR e.id = sr.id' : ''
  // O conjunto parte só de linhas pequenas: os chunks da chave citada (pelo índice único de
  // stable_key, como no plano) e os candidatos que os outros braços já trouxeram. Um chunk por
  // versão de dispositivo: o representante dela num dos outros braços ou, sem ele, o primeiro.
  return `
exact_pool AS (
  SELECT b.id FROM base b
  JOIN corpus.provision_versions pv ON pv.id = b.provision_version_id
  JOIN corpus.provisions p ON p.id = pv.provision_id
  WHERE p.stable_key = ANY($5::text[])
  UNION SELECT id FROM lexical ${semanticPool}),
exact AS (
  SELECT d.id, d.pv, row_number() OVER (ORDER BY d.arm_rank, d.sort_path, d.ordinal) AS rnk
  FROM (
    SELECT DISTINCT ON (c.provision_version_id) e.id, c.provision_version_id AS pv,
      coalesce(least(lr.rnk, ${semanticRank}), ${String(ARM_LIMIT + 1)}) AS arm_rank,
      p.sort_path, c.ordinal
    FROM exact_pool e
    JOIN corpus.chunks c ON c.id = e.id
    JOIN corpus.provision_versions v ON v.id = c.provision_version_id
    JOIN corpus.provisions p ON p.id = v.provision_id
    LEFT JOIN lexical lr ON lr.pv = c.provision_version_id
    ${semanticJoin}
    WHERE p.stable_key = ANY($5::text[])
       OR EXISTS (SELECT 1 FROM unnest($5::text[]) AS k WHERE p.stable_key LIKE k || ':%')
    ORDER BY c.provision_version_id, (e.id = lr.id ${semanticId}) IS TRUE DESC, c.ordinal) d
  ORDER BY rnk LIMIT ${String(EXACT_LIMIT)}),`
}

function fused(withSemantic: boolean): string {
  const semanticUnion = withSemantic ? `UNION ALL SELECT id, pv, rnk, 'sem' FROM semantic` : ''
  // Votos somados por versão de dispositivo; o representante é o chunk mais bem colocado.
  return `
fused AS (
  SELECT pv, (array_agg(id ORDER BY rnk, src))[1] AS id, sum(1.0 / (${String(RRF_K)} + rnk)) AS rrf,
    min(rnk) FILTER (WHERE src = 'lex') AS lex_rank,
    min(rnk) FILTER (WHERE src = 'sem') AS sem_rank,
    min(rnk) FILTER (WHERE src = 'ref') AS ref_rank
  FROM (SELECT id, pv, rnk, 'lex' AS src FROM lexical ${semanticUnion}
        UNION ALL SELECT id, pv, rnk, 'ref' FROM exact) u
  GROUP BY pv),${EXPANSION}`
}

/** Candidatos do topo do RRF cujos parentes entram no fim da lista (com reranker). */
export const EXPANSION_ANCHORS = 5

/**
 * Parentes dos candidatos mais fortes (ADR 0027, adendo): o dispositivo certo costuma ser irmão
 * ou filho de um candidato do topo (o inciso do artigo cujo parágrafo veio, o campo do registro
 * cujo outro campo veio), mas não casa sozinho com a pergunta. `ranked` são os $7 primeiros do
 * RRF; os filhos do pai e do próprio dispositivo de cada um dos `EXPANSION_ANCHORS` primeiros,
 * vigentes e publicáveis, que ainda não estão em `ranked`, entram depois deles, até $8, pelo
 * `ts_rank` contra a pergunta. Sem voto no RRF (`rrf = 0`): só o reranker os reordena.
 */
const EXPANSION = `
ranked AS (
  SELECT f.*, row_number() OVER (ORDER BY f.rrf DESC, f.id) AS ord
  FROM fused f ORDER BY f.rrf DESC, f.id LIMIT $7::int),
anchors AS (
  SELECT p.id, p.parent_id
  FROM (SELECT pv FROM ranked ORDER BY ord LIMIT ${String(EXPANSION_ANCHORS)}) r
  JOIN corpus.provision_versions v ON v.id = r.pv
  JOIN corpus.provisions p ON p.id = v.provision_id),
kin AS (
  SELECT k.id FROM corpus.provisions k
  WHERE k.parent_id IN (SELECT parent_id FROM anchors UNION SELECT id FROM anchors)),
expanded AS (
  SELECT d.pv, d.id, 0::numeric AS rrf, NULL::bigint AS lex_rank, NULL::bigint AS sem_rank,
    NULL::bigint AS ref_rank, $7::int + row_number() OVER (ORDER BY d.score DESC, d.id) AS ord
  FROM (SELECT DISTINCT ON (b.provision_version_id) b.id, b.provision_version_id AS pv,
          ts_rank(b.tsv, t.q, 1 | 32) AS score
        FROM kin
        JOIN corpus.provision_versions v ON v.provision_id = kin.id
        JOIN base b ON b.provision_version_id = v.id
        CROSS JOIN tsq t
        WHERE NOT EXISTS (SELECT 1 FROM ranked r WHERE r.pv = b.provision_version_id)
        ORDER BY b.provision_version_id, b.ordinal) d
  ORDER BY d.score DESC, d.id LIMIT $8::int),
results AS (SELECT * FROM ranked UNION ALL SELECT * FROM expanded)`

/** Profundidade máxima da cadeia de ancestrais (artigo > parágrafo > inciso > alínea > item …). */
const MAX_ANCESTOR_DEPTH = 8

/**
 * Ancestrais de cada resultado: a cadeia de `parent_id` e, de cada ancestral, a redação de
 * conhecimento aberto vigente na data ($3), preferindo um `review_status` permitido ($6), da raiz
 * para o pai imediato. Só para as linhas devolvidas (`results`).
 */
const ANCESTORS = `
LEFT JOIN LATERAL (
  WITH RECURSIVE up(provision_id, depth) AS (
    SELECT p.parent_id, 1 WHERE p.parent_id IS NOT NULL
    UNION ALL
    SELECT a.parent_id, up.depth + 1 FROM up JOIN corpus.provisions a ON a.id = up.provision_id
    WHERE a.parent_id IS NOT NULL AND up.depth < ${String(MAX_ANCESTOR_DEPTH)})
  SELECT array_agg(t.text ORDER BY up.depth DESC) AS texts
  FROM up
  JOIN LATERAL (
    SELECT v.text FROM corpus.provision_versions v
    WHERE v.provision_id = up.provision_id AND v.valid_during @> $3::date AND upper_inf(v.knowledge)
    ORDER BY (v.review_status = ANY($6::text[])) DESC, v.id LIMIT 1) t ON true) anc ON true`

const TAIL = `
SELECT c.id, p.stable_key, c.family, c.content, c.citation_label, c.heading_path,
       coalesce(anc.texts, '{}'::text[]) AS ancestors,
       lower(c.valid_during)::text AS valid_from, upper(c.valid_during)::text AS valid_to,
       dv.version_label, dv.id AS doc_version_id, d.title AS doc_title, d.source_url,
       f.rrf::float8 AS rrf, f.lex_rank, f.sem_rank, f.ref_rank
FROM results f
JOIN corpus.chunks c ON c.id = f.id
JOIN corpus.provision_versions pv ON pv.id = c.provision_version_id
JOIN corpus.provisions p ON p.id = pv.provision_id${ANCESTORS}
JOIN LATERAL (
  SELECT dv.* FROM corpus.chunk_sources s
  JOIN corpus.document_versions dv ON dv.id = s.document_version_id
  WHERE s.chunk_id = c.id AND dv.status = 'published'
  ORDER BY (dv.valid_during @> $3::date) DESC, dv.published_on DESC LIMIT 1) dv ON true
JOIN corpus.documents d ON d.id = dv.document_id
ORDER BY f.ord`

export const HYBRID_SEARCH_SQL = `${COMMON_HEAD}${SEMANTIC_ARMS}${exactArm(true)}${fused(true)}${TAIL}`

/**
 * Mesma consulta sem o braço vetorial. Mantém o placeholder $2 (`$2::text IS NULL`) para os
 * parâmetros terem a mesma posição nas duas variantes.
 */
export const LEXICAL_ONLY_SQL = `${COMMON_HEAD.replace(
  'WITH tsq AS MATERIALIZED (',
  'WITH unused_vector AS (SELECT $2::text AS v), tsq AS MATERIALIZED (',
)}${exactArm(false)}${fused(false)}${TAIL}`

/**
 * Vigências que têm fronteira dentro do período `[$1, $2)` (o mês do PA), com os filtros da busca
 * ($3 famílias, $4 `review_status`, conhecimento atual), nos dispositivos sob as unidades $5 (a
 * chave ou as descendentes, `k:%`; as unidades são `tipo:valor` de topo, sem `_` nem `%`). Consulta
 * barata, pelos índices de `stable_key` e `provision_id`, só quando a referência veio de um PA.
 */
export const PERIOD_VERSIONS_SQL = `
SELECT DISTINCT lower(pv.valid_during)::text AS valid_from, upper(pv.valid_during)::text AS valid_to
FROM corpus.provisions p
JOIN corpus.documents d ON d.id = p.document_id
JOIN corpus.provision_versions pv ON pv.provision_id = p.id
WHERE d.family = ANY($3::text[])
  AND (p.stable_key = ANY($5::text[])
       OR EXISTS (SELECT 1 FROM unnest($5::text[]) AS k WHERE p.stable_key LIKE k || ':%'))
  AND pv.valid_during && daterange($1::date, $2::date)
  AND upper_inf(pv.knowledge) AND pv.review_status = ANY($4::text[])
  AND (lower(pv.valid_during) > $1::date OR upper(pv.valid_during) < $2::date)
ORDER BY valid_from, valid_to`

/** `[0.1,0.2,...]`, o formato de entrada do `halfvec`. */
export function toVectorLiteral(vector: readonly number[]): string {
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new RangeError('vetor com valor não finito')
  }
  return `[${vector.join(',')}]`
}
