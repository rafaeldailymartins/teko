# Proposal

## Why

No art. 12 do RCTE, a nota "Conferida nova redação ao INCISO IV do art. 12 … vigência: 05.04.22"
vem logo antes do texto antigo do inciso V, e o texto novo do inciso IV só aparece depois da nota
do inciso V ("… AO INCISO V … vigência: 01.05.23"). O parser liga cada nota de alteração ao
primeiro dispositivo depois dela: o inciso IV novo começa em 2023-05-01, e o
`go:rcte:art:12:inc:IV` fica sem redação vigente entre 2022-04-05 e 2023-04-30 (o inciso V
original ainda vai para revisão por estilo trocado).

Além disso, 40 `NotaVigncia` do RCTE e 11 do CTE ficam `pending`, fora da produção, e
`corpus/overrides/` só tem o exemplo.

## What Changes

- A nota de alteração passa a ler os dispositivos que cita (maiúsculas ou minúsculas, com ou sem
  aspas, listas e intervalos como "incisos IV a VI", sem o ato alterador). Se a redação seguinte
  não é do dispositivo citado nem de um filho dele, e o dispositivo citado aparece adiante no
  mesmo artigo, a nota espera a redação dele. Nota que cita só um artigo, ou sem o dispositivo
  adiante, segue a ordem dos parágrafos.
- Quatro formas de `NotaVigncia` que iam para revisão passam a ser lidas: nota vazia ("de 01.05.23
  a 30.04.23") sem lacuna, mês com zero a mais ("31.010.07"), nota que fecha várias redações
  seguidas do mesmo dispositivo com início inline, e nota que conta a história do dispositivo.
- `corpus/overrides/rcte.yaml` e `cte.yaml` com as resoluções da triagem
  (`docs/evals/triagem-notas-pending-2026-11-13.md`).
- `PARSER_REVISIONS[go-html-state-machine]` sobe para 3.

## Capabilities

### Modified Capabilities

- `rcte-cte-parser`: nota de alteração ligada ao dispositivo citado e notas de vigência
  irregulares.

## Impact

- `apps/api/src/domain/corpus/validity.ts` (`parseCitedLabels`, data com mês "010", nota vazia e
  nota da história do dispositivo em `resolveTimeline`), `go-html-state-machine.ts` (olhar adiante
  no artigo, nota da última de várias redações), `parsers/index.ts`, `corpus/overrides/`.
- RCTE: 20 dispositivos mudam de vigência, `NotaVigncia` em revisão de 40 para 27 no parser e 9
  depois dos overrides; CTE: nenhum dispositivo muda, 11 para 1 depois dos overrides.
