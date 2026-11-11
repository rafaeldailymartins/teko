# Proposal

## Why

A resposta certa do Tekó depende da data: a mesma pergunta sobre o RCTE tem respostas diferentes
em 2004, 2006 e 2010. Antes de buscar qualquer coisa, a API precisa saber de que data a pergunta
fala e se o corpus cobre essa data, e recusar sem chamar o LLM quando não cobre. É a primeira
mudança da F2 do roteiro ("Domínio de vigência, schema e busca híbrida").

## What Changes

- Domínio de vigência em `apps/api/src/domain`, sobre o que já existe em `@teko/shared/vigencia`:
  - `date-mentions.ts`: datas citadas no texto da pergunta (dia e mês, pt-BR e en, ano com 4
    dígitos);
  - `reference-resolution.ts`: a regra de `ResolveReferenceDate` (escolha explícita > data única
    do texto > mês anterior a hoje em `America/Sao_Paulo`; PA resolve para o dia 1; conflito vira
    `needs_clarification`) e o aviso de fronteira de vigência dentro do PA;
  - `coverage-decision.ts`: a regra de `CheckCoverage` (cobertura efetiva limitada pelo
    `verified_at` e sem as lacunas; recusa total ou parcial por família).
- Corpus no domínio: famílias e jurisdições, bases de vigência, status de revisão
  (`family.ts`), a gramática da `stable_key` (`provision-id.ts`), a normalização do
  `content_hash` e o chunker (com o texto de embedding que leva o caminho de títulos).
- Casos de uso `ResolveReferenceDate` e `CheckCoverage` em `apps/api/src/application`, com o
  `Clock` e a porta `CoverageRepository`.
- Fora de escopo: as rotas HTTP que usam esses casos de uso (`POST /api/v1/questions`, F4), o
  `RefreshCoverage` da ingestão (F3) e o avanço diário do `verified_at` pelo `source-watch` (F3).

## Capabilities

### New Capabilities

- `validity-domain`: resolução da data de referência, decisão de cobertura e identidade estável
  dos dispositivos.

### Modified Capabilities

Nenhuma.

## Impact

- Código novo em `apps/api/src/domain/{vigencia,corpus,qa}` e `apps/api/src/application`.
- Nenhuma ADR alterada; a decisão de modelo bitemporal fica na ADR 0009, escrita nesta fase.
