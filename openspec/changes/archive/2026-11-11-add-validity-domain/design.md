# Design

## Context

O pacote `@teko/shared/vigencia` (F1) já tem os tipos e operações de intervalo (`[from, to)`,
`daterange` e `datemultirange` do Postgres, período de apuração, `effectiveCoverage`). Falta a
regra de negócio que decide a data de uma pergunta e se ela está coberta, e a identidade dos
dispositivos que a busca e as citações usam. O domínio da API só pode depender de `zod` e de
`@teko/shared` (dependency-cruiser), então hash e relógio ficam atrás de portas.

## Goals / Non-Goals

**Goals:**

- Precedência da data de referência idêntica ao plano, testável sem banco e com relógio fixo
  (2026-11-10).
- Recusa por cobertura antes da busca e do LLM, inclusive para datas depois do `verified_at`.
- `stable_key` com gramática fechada, validada na fixture, nas evals e na extração de referências.

**Non-Goals:**

- Extração de datas por LLM ou por NLP genérico: só formas com ano de 4 dígitos, para não confundir
  com números de artigo, valores e códigos de registro.
- Normalização de datas relativas ("mês passado", "ano-calendário anterior"): ficam para quando
  as evals de geração (F8) mostrarem a necessidade.

## Decisions

- **Mês do texto compatível com o PA.** Uma menção no mesmo mês da escolha explícita (ou mensal
  quando a escolha é um dia) não gera `needs_clarification`. Alternativa: exigir igualdade exata,
  descartada porque "em maio de 2006" com o PA 05/2006 é a mesma intenção.
- **`clarified` não confronta o texto.** Depois do `needs_clarification`, a escolha do usuário
  vence; reconfrontar faria a pergunta ficar presa em laço.
- **`periodBoundaryInside` calculado depois da busca** (`markPeriodBoundary`), porque depende das
  vigências da evidência; a resolução sai sempre com `false`.
- **Cobertura sem registro conta como não coberta.** `rcte-anexos` (onda C3) não tem linha em
  `corpus.coverage` até a F10, e a pergunta só sobre ela é recusada.
- **Lacunas como `datemultirange` (`coverage.gaps`).** O plano fala em "sem os gaps
  (`gap_reason`)"; o `mark-coverage` grava o trecho a partir da data de efeito detectada. Com o
  intervalo na tabela, o domínio usa o `effectiveCoverage` do shared sem interpretar texto. O
  `teko_watch` ganha `UPDATE (verified_at, gaps, gap_reason)` (mudança `add-corpus-schema`).
- **Texto de embedding com o caminho de títulos** (`embeddingText(heading_path, content)`). Um
  campo curto do Guia só é reconhecível como "campo do C100" com o contexto; sem ele o
  registro-pai vencia o braço semântico nas perguntas sobre o campo (retrieval evals, ADR 0010).
  O conteúdo gravado e citado continua só o do chunk, e o `embedding_cache` é indexado pelo hash
  do texto de embedding.
- **Hash fora do domínio.** `normalizeForHash` (NFC, sem invisíveis, espaços colapsados) é do
  domínio; o sha256 fica no adapter `crypto`, porque o domínio não importa `node:*`.

## Risks / Trade-offs

- A extração de datas não cobre todas as formas de escrita. Mitigação: o golden tem 4 casos
  ambíguos e 46 com data esperada (métrica `data_referencia` = 1,00 nas retrieval evals).

## Fontes Context7

Nenhuma biblioteca nova nesta mudança (só `zod` 4.6.7 e `@teko/shared`, conferidos na F1). As
fontes das mudanças irmãs estão nos `design.md` de `add-corpus-schema` e `add-hybrid-search`.
