# Tasks

## 1. Nota de alteração por dispositivo

- [x] 1.1 `parseCitedLabels` (artigo, §, inciso, alínea, item; listas e intervalos; sem o ato alterador) e `AmendmentNote.cited`
- [x] 1.2 `takePending`/`citedAhead` no `go-html-state-machine`: a nota espera o dispositivo citado adiante no mesmo artigo
- [x] 1.3 `diagnostics.retargetedAmendments` e varredura dos dois documentos (casos no `design.md`)

## 2. Notas de vigência em revisão

- [x] 2.1 Mês com zero a mais, nota vazia sem lacuna, nota da última de várias redações e nota da história do dispositivo
- [x] 2.2 Triagem das `NotaVigncia` restantes e `corpus/overrides/rcte.yaml` e `cte.yaml`
- [x] 2.3 Relatório `docs/evals/triagem-notas-pending-2026-11-13.md`

## 3. Verificação

- [x] 3.1 Testes de domínio e do parser com recortes reais (art. 12 e art. 68; arts. 167-A, 167-J, 213-O e 401)
- [x] 3.2 `PARSER_REVISIONS[go-html-state-machine]` = 3, medição antes e depois e gates locais
