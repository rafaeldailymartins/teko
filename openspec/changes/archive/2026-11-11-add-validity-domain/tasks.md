# Tasks

## 1. Domínio

- [x] 1.1 `domain/vigencia/date-mentions.ts` com as formas de dia e mês (pt-BR e en) e testes de não-datas (artigos, valores, códigos de registro) — `pnpm --filter @teko/api test:unit`
- [x] 1.2 `domain/vigencia/reference-resolution.ts` (precedência, `needs_clarification`, `clarified`, `markPeriodBoundary`) com os cenários da spec — testes unitários com relógio fixo em 2026-11-10
- [x] 1.3 `domain/vigencia/coverage-decision.ts` (cobertura efetiva, recusa total e parcial) com propriedades fast-check (data depois do `verified_at` nunca coberta) — testes unitários
- [x] 1.4 `domain/corpus/{family,provision-id,text-normalization,chunker}.ts` com propriedades (ida e volta da `stable_key`, chunker sem perda de texto, hash invariante a whitespace) — testes unitários

## 2. Casos de uso

- [x] 2.1 `ResolveReferenceDate` (hoje pelo `Clock` em `America/Sao_Paulo`) e `CheckCoverage` (porta `CoverageRepository`) — testes unitários
- [x] 2.2 Cenários de cobertura contra o Postgres real: data depois do `verified_at`, Anexos sem cobertura e cobertura parcial — `test/integration/corpus/hybrid-search.test.ts`

## 3. Verificação

- [x] 3.1 Cobertura do domínio e da aplicação ≥ 95% por arquivo (thresholds do `vitest.config.ts`) — `pnpm --filter @teko/api test:unit`
- [x] 3.2 Stryker ≥ 70 em `apps/api` (domain e application) e `packages/shared` — `pnpm test:mutation`
- [x] 3.3 Métricas `clarificacao`, `recusa` e `data_referencia` = 1,00 nas retrieval evals — `pnpm --filter @teko/api eval:retrieval:check`
