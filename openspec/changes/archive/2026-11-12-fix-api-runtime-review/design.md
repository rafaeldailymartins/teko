# Design

## Context

Pacote A da revisão de arquitetura de 2026-11-12 (runtime da API), aprovado pelo mantenedor para
rodar antes da F4. Os achados foram conferidos no código antes de cada correção.

## Decisions

- **Fronteira do PA pelas unidades das evidências.** A busca continua no dia 1 (o plano resolve o
  PA para o dia 1, e as evals não mudam). Se as vigências das evidências não mostram fronteira, uma
  consulta barata procura vigências que cruzam o mês com fronteira estrita dentro dele, nos
  dispositivos sob a unidade de topo de cada evidência e de cada chave citada
  (`<jurisdição>:<família>:<tipo>:<valor>`). Varrer a família inteira avisaria quase todo mês no
  RCTE; buscar no intervalo do mês mudaria o ranking e daria ao LLM redação que não vale no dia 1.
- **Corpo do Workers AI no mesmo tratamento de erro.** `postWorkersAi` (comum a embeddings e
  reranker) converte falha de rede, HTTP e leitura do corpo no erro degradável de quem chama.
- **Retry único só em leitura idempotente.** `retryTransientRead` repete a leitura inteira numa
  conexão nova quando o erro (ou o `cause`, que o Drizzle embrulha) é 57P01 ou ECONNRESET; a
  conexão caída sai do pool com `release(erro)`. Escrita e transação nunca passam por ele.
- **Três idas ao banco na busca.** `BEGIN READ ONLY; SELECT set_config(..., true) x3` vai no
  protocolo simples (sem parâmetros), a busca no estendido com instrução sem nome (PgBouncer em modo
  transação) e o `COMMIT`. A vigência sai `::text`: o parser padrão do `pg` cria `Date` à
  meia-noite local, e o `toISOString()` perdia um dia a leste de UTC.
- **Cache da cobertura por prazo.** 10 min por instância, leituras simultâneas compartilhadas e
  falha fora do cache. A `corpus_version` nova vem de outro processo (Actions); sem um canal de
  invalidação, o prazo é o limite de atraso (regra 5 de CU-h do plano).
- **Seed pela ingestão.** Cada versão de documento da fixture vira um `ParsedSource` (janela de
  substituição: todo o histórico nas famílias consolidadas, o próprio período nos Guias e leiautes)
  e passa pelo `IngestDocumentVersion`; o `RefreshCoverage` abre a `corpus_version`, e a cobertura
  declarada em `coverage.json` vai por cima (a fixture é recorte do staging). O `knowledge` da
  fixture vira informativo: o seed usa o da ingestão.

## Context7

- `/brianc/node-postgres`: `release(err)` descarta a conexão; `date` vira `Date` no fuso do
  processo; consulta sem parâmetros usa o protocolo simples (várias instruções).
- `/websites/postgresql/18`: `set_config(nome, valor, true)` equivale a `SET LOCAL`.
- `/drizzle-team/drizzle-orm-docs`: `insert(...).onConflictDoUpdate({ target, set })`.

## Risks / Trade-offs

- A consulta de fronteiras acrescenta uma ida ao banco nas perguntas por PA cujas evidências não
  mostram fronteira; é por índice (`stable_key`, `provision_id`) e só lê vigências.
- Dispositivo novo fora das unidades das evidências continua sem aviso.
- O cache da cobertura pode recusar ou aceitar por até 10 min com a cobertura anterior.
