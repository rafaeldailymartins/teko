-- Corpus sintético para o sql-perf: ~100k chunks em 6 famílias, com vetores aleatórios em
-- halfvec(1024), texto pseudo-fiscal e vigências encadeadas. Roda como owner num banco migrado e
-- vazio.
--
-- Distribuição (parecida com a do corpus real, em que cada data enxerga uma redação por
-- dispositivo e a maioria dos dispositivos tem poucas redações):
-- - 4.167 dispositivos por família x 4 redações = 100.008 chunks; numa data, ~25% das linhas estão
--   em vigor (todas as famílias) ou ~4% (uma família);
-- - cada chunk tem 8 palavras do vocabulário fiscal e 32 termos de um vocabulário sintético de
--   20 mil, para que uma pergunta comum não case com o corpus inteiro.
--
-- O HNSW é recriado depois da carga (mais rápido que inserir com o índice), com a mesma definição
-- da migração.
SET maintenance_work_mem = '512MB';
SET max_parallel_maintenance_workers = 2;

DROP INDEX IF EXISTS corpus.chunks_embedding_hnsw;

CREATE TEMP TABLE synthetic_words (w text[]);
INSERT INTO synthetic_words VALUES (ARRAY[
  'registro', 'campo', 'valor', 'imposto', 'icms', 'ipi', 'base', 'calculo', 'aliquota', 'operacao',
  'prestacao', 'servico', 'mercadoria', 'documento', 'fiscal', 'escrituracao', 'apuracao', 'periodo',
  'credito', 'debito', 'saldo', 'contribuinte', 'estabelecimento', 'substituicao', 'tributaria',
  'isencao', 'reducao', 'diferimento', 'prazo', 'pagamento', 'entrada', 'saida', 'nota', 'eletronica',
  'chave', 'acesso', 'codigo', 'tabela', 'leiaute', 'versao', 'obrigatorio', 'preenchimento',
  'informar', 'quantidade', 'unidade', 'item', 'produto', 'natureza', 'cfop', 'cst', 'retencao',
  'recolhimento', 'guia', 'regime', 'especial', 'beneficio', 'incentivo', 'goias', 'secretaria'
]);

CREATE FUNCTION pg_temp.synthetic_text() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT (SELECT string_agg(w[1 + floor(random() * array_length(w, 1))::int], ' ')
          FROM synthetic_words, generate_series(1, 8))
      || ' '
      || (SELECT string_agg('termo' || floor(random() * 20000)::int, ' ') FROM generate_series(1, 32))
$$;

CREATE FUNCTION pg_temp.synthetic_vector() RETURNS halfvec LANGUAGE sql VOLATILE AS $$
  SELECT array_agg((random() - 0.5)::real)::real[]::vector(1024)::halfvec(1024)
  FROM generate_series(1, 1024)
$$;

INSERT INTO corpus.documents (slug, family, jurisdiction, title, issuer, source_url)
SELECT 'synthetic-' || f, f, CASE WHEN f IN ('efd-icms-ipi', 'efd-reinf') THEN 'BR' ELSE 'GO' END,
       'Documento sintético ' || f, 'sql-perf', 'https://example.invalid/' || f
FROM unnest(ARRAY['efd-icms-ipi', 'efd-reinf', 'rcte', 'cte', 'efd-go', 'tabelas-go']) AS f;

INSERT INTO corpus.document_versions (document_id, version_label, published_on, valid_during, sha256, status)
SELECT d.id, 'sintética', '2026-01-01', '[2026-01-01,)', md5(d.slug) || md5(d.slug || 'x'), 'published'
FROM corpus.documents d;

INSERT INTO corpus.provisions (stable_key, document_id, kind, sort_path)
SELECT 'synthetic:' || d.family || ':' || g, d.id, 'sintetico', lpad(g::text, 6, '0')
FROM corpus.documents d, generate_series(1, 4167) AS g;

-- 4 redações por dispositivo, com fronteiras escalonadas por dispositivo entre 2006 e 2025: em
-- qualquer data de 2010 em diante, cada dispositivo tem exatamente uma redação em vigor.
INSERT INTO corpus.provision_versions (provision_id, display_label, valid_during, knowledge, validity_basis, text, content_hash)
SELECT p.id, p.stable_key || ' v' || v,
       daterange(
         CASE WHEN v = 0 THEN DATE '2006-01-01' ELSE DATE '2010-01-01' + ((v - 1) * 1460 + (hashtext(p.stable_key) & 1023)) END,
         CASE WHEN v = 3 THEN NULL ELSE DATE '2010-01-01' + (v * 1460 + (hashtext(p.stable_key) & 1023)) END),
       '[2026-01-01,)', 'legal_effect', 'sintético', md5(p.stable_key || v)
FROM corpus.provisions p, generate_series(0, 3) AS v;

INSERT INTO corpus.chunks (provision_version_id, ordinal, family, jurisdiction, citation_label, heading_path,
  content, content_hash, valid_during, knowledge, modality, review_status, corpus_version, embedding, embedding_model)
SELECT pv.id, 0, d.family, d.jurisdiction, pv.display_label, 'Sintético > ' || pv.display_label,
       pg_temp.synthetic_text(), md5(pv.id::text), pv.valid_during, pv.knowledge,
       pv.modality, pv.review_status, 1, pg_temp.synthetic_vector(), 'synthetic'
FROM corpus.provision_versions pv
JOIN corpus.provisions p ON p.id = pv.provision_id
JOIN corpus.documents d ON d.id = p.document_id;

INSERT INTO corpus.chunk_sources (chunk_id, document_version_id)
SELECT c.id, dv.id
FROM corpus.chunks c
JOIN corpus.provision_versions pv ON pv.id = c.provision_version_id
JOIN corpus.provisions p ON p.id = pv.provision_id
JOIN corpus.document_versions dv ON dv.document_id = p.document_id;

CREATE INDEX chunks_embedding_hnsw ON corpus.chunks USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 128);

ANALYZE corpus.documents, corpus.document_versions, corpus.provisions, corpus.provision_versions,
  corpus.chunks, corpus.chunk_sources;
