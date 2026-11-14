# Design

## Context

Medições no corpus real do staging (`docs/evals/mrr-f4-2026-11-14.md`, rodadas 6 e 7).

## Decisions

- **Consulta só no léxico.** É o único braço que depende de vocabulário; o embedding (`bge-m3`) e o
  reranker (`bge-reranker-base`) comparam a pergunta, em frase, com o texto do dispositivo.
- **Referências citadas** continuam saindo das duas versões.

## Risks / Trade-offs

- O ganho medido é pequeno (+0,014 no holdout) e cabe na variação entre runs; a reescrita continua
  desligada fora do `corpus-eval`.

## Context7

Sem biblioteca nova.
