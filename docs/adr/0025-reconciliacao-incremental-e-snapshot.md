---

status: accepted
date: 2026-11-11
decision-makers: Rafael Daily Santos Martins
---

# 0025 — Reconciliação incremental do corpus e identidade no snapshot

## Contexto e problema

A F3 troca o seed da fixture (`WriteCorpus`, que grava tudo de uma vez) pela ingestão real: cada
versão de documento chega sozinha (um consolidado novo do RCTE, um Guia Prático por período, uma
versão corretiva) e precisa ser reconciliada com o que já está publicado, sem reembutir texto que
não mudou (orçamento de 8.000 neurons/dia) e sem perder o histórico bitemporal (ADR 0009). Depois,
o staging exporta um snapshot que a produção promove sem ler o staging e sem recalcular
embeddings. O plano fixa as regras gerais ("Escrita, Blobs, snapshot e promoção"), mas deixa em
aberto três pontos: o que fazer com uma redação que só em parte cai na janela reescrita pela versão
nova, como "alargar" num documento que reescreve todo o histórico e como os IDs `uuidv7()` do
staging se relacionam com os da produção.

## Decisão

1. **Janela de substituição (`ReplacementWindow`, `W`).** Cada `ParsedSource` declara o trecho de
   vigência que reescreve: consolidados (RCTE, CTE), tudo; Guias e leiautes, o próprio período.
   A reconciliação, por `stable_key`, contra as redações de conhecimento aberto:
   - mesma identidade (hash do conteúdo, modalidade, classe de revisão: `auto`/`approved` juntas,
     `pending` e `rejected` cada uma consigo) e mesmo intervalo → reaproveita a linha e só
     acrescenta fontes;
   - mesma identidade e `T = (E − W) ∪ P` contíguo contendo `E` → alarga a linha e os chunks até
     `T` (versões consecutivas iguais do Guia viram uma linha; num consolidado, `T = P`, então
     só alarga quando a nova vigência contém a antiga);
   - redação aberta que cruza `W` e não casou → `knowledge` fechado em `published_on` e os trechos
     `E − W` voltam como linhas novas (conhecimento a partir do fechamento), com cópia dos chunks,
     embeddings e fontes no próprio banco. Assim uma versão corretiva de 2026 que omite um campo não
     apaga o que se sabia dele em 2025, e nada é reembutido;
   - redação parseada que encolhe uma existente (correção de vigência) não alarga: a antiga fecha e
     a nova entra.
2. **Fechamento sem range vazio.** Se `published_on` não for posterior ao início do conhecimento,
   o fechamento vai para o dia seguinte a esse início.
3. **Versões de documento.** Uma versão nova fecha em `valid_during.from` o `valid_during` das
   versões anteriores ainda em aberto do mesmo documento (`[published_on, próxima consolidação)`).
   As antigas continuam `published` e citáveis; `superseded` fica reservado (a F3 não o usa).
4. **Chunks sem versão.** Os chunks gravados durante o run levam `corpus_version = 0` e são
   carimbados pelo `RefreshCoverage`, que grava o `corpus_versions` novo por último.
5. **Identidade entre ambientes.** Os IDs do staging viajam no snapshot. Na promoção,
   `documents` (`slug`), `document_versions` (`sha256`), `provisions` (`stable_key`) e `chunks`
   (`provision_version_id, ordinal`) são remapeados pela chave natural quando o destino já tem a
   linha com outro ID; `amendments`, `provision_labels` (substituídos por dispositivo) e
   `provision_versions` casam pelo ID. Linhas abertas do destino ausentes do snapshot têm o
   `knowledge` fechado na data da promoção. A numeração de `corpus_versions` é a do staging; o
   destino recusa snapshot mais antigo que a versão dele.
6. **Formato.** JSON Lines por tabela, comprimido com o zstd do `node:zlib` (Node 24), tipos sem
   JSON nativo como texto canônico do Postgres (o `halfvec` volta idêntico), lido por cursor numa
   transação `REPEATABLE READ` e carregado na promoção por `jsonb_to_recordset` em tabelas
   temporárias.

## Consequências

- A segunda execução da mesma versão (mesmo sha256) não toca o banco; um novo download com o mesmo
  conteúdo só acrescenta fontes. Os testes de `test/integration/ingest/` provam os dois casos, a
  retomada depois do `budget_exhausted`, a anomalia sobreposta e a promoção num banco vazio com
  resultados idênticos no `HybridSearch`.
- Reingerir o staging do zero muda os IDs; a promoção seguinte remapeia documentos, versões,
  dispositivos e chunks, mas as redações entram como linhas novas (as antigas fecham). O histórico
  de conhecimento da produção cresce nesse caso; é aceitável porque reingerir do zero é raro.
- A ordem das versões de um documento importa (a ingestão processa da mais antiga para a mais nova).
- `node:zlib` com zstd é experimental no Node 24 (estabilidade 1); o formato zstd é estável, e a
  troca por outro compressor mudaria só o adapter.

## Alternativas consideradas

- **Fechar a redação inteira quando ela cruza `W`** (regra literal do plano): perde o conhecimento
  da parte não reescrita (um campo do Guia de 2025 sumiria ao chegar a corretiva de 2026).
- **Alargar como união `E ∪ P` sempre**: num consolidado, uma correção de vigência ficaria com a
  vigência errada para sempre.
- **IDs novos na produção, só chave natural**: `provision_versions` não tem chave natural estável
  (a vigência muda ao alargar), e os chunks dependem dela.
- **`COPY` binário ou `pg_dump` por tabela**: exige ferramenta externa no runner e não deixa
  filtrar `pending`/`rejected` nem conferir o sha256 por arquivo de forma portátil.
