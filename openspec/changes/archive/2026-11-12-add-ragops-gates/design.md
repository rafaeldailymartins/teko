# Design

## Context

O `corpus-eval` (ADR 0027) roda as retrieval evals contra o staging com embeddings e reranker
reais, depois do `load`. O PR do lock (`lock-pr`) é a porta do corpus para a produção. O golden
(`evals/datasets/golden.yaml`) tem 50 casos revisados pelo mantenedor em 2026-11-11, usados na
fixture do PR e no `corpus-eval`, e foi usado para escolher os 40 candidatos do reranker.

## Decisions

- **Dois conjuntos, arquivos separados.** `golden.yaml` (dev) e `holdout.yaml`, com o mesmo
  schema. O holdout fica fora da fixture: as perguntas não têm vetor no `embeddings.json.gz`, e a
  fixture tem um décimo do corpus (a maior parte dos dispositivos do holdout não está nela). O
  `fixtures:embed` continua lendo só o dev; os resultados da fixture ficaram iguais caso a caso.
- **Geradores nomeados.** `golden-tests.ts` exporta `devTests` e `holdoutTests` e nenhum default:
  com um export default, o promptfoo procura a função de `file://…ts:nome` dentro dele.
- **Curadoria do holdout.** Perguntas escritas sem copiar o dispositivo (paráfrase, linguagem de
  contador), 10 em inglês, 10 com mais de um dispositivo esperado, 38 dispositivos fora da
  fixture, 5 recusas, 4 sem resposta e 2 ambíguos. Chaves, vigências e `source_quote` conferidos
  contra os parsers da ingestão rodados localmente sobre as fontes públicas (RCTE, CTE, Tabelas de
  Goiás, XSD da REINF; sem banco e sem neurons), os textos da fixture (Guias) e o texto extraído
  dos PDFs (capas usadas nas recusas); a data de referência e as candidatas, contra o
  `resolveReferenceDate`. Vigência esperada só onde há uma fonte por documento.
- **`unanswerable` e `sem_resposta`.** A busca não sabe dizer "não há resposta"; o que ela pode
  errar é recusar por cobertura ou pedir clarificação. A métrica aceita evidência ou `no_evidence`;
  a resposta "insuficiente" é das generation evals (F8).
- **Gates.** Dev no corpus real: os limites de `retrieval-corpus` (trava de regressão). Holdout:
  métricas determinísticas em 1,00; recall@10 e MRR informativos (`null`) até a primeira medição,
  quando o mantenedor fixa o piso; meta de MRR 0,70 (F4) em `metas`. Um gate num número nunca
  medido bloquearia o lock sem informação.
- **Intervalo de confiança.** Wilson para proporções (o recall com vários dispositivos entra como
  proporção média) e média ± 1,96 erro-padrão para o MRR, limitados a [0, 1].
- **Registro e histórico.** `corpus-eval-record.ts build` junta as duas suítes, lê a
  `corpus_version` do staging (`max(id)` de `corpus.corpus_versions`, pelo `teko_app`) e grava o
  registro e o corpo do PR; `history` grava em `eval-artifacts`
  (`history/corpus-v<NNNNNN>/<run_id>.json`) pela porta `BlobStore`, para o backend mudar sem mexer
  aqui. O registro vai ao PR do lock como `corpus/corpus.eval.json`, arquivo irmão do lock: o
  schema do lock fica intocado.
- **`eval-only` e o lock atrasado.** Com o eval vermelho por causa do golden, o lock fica atrás do
  staging. O `eval-only` sem `ref` lê o lock de `develop` pela API; se a `corpus_version` avaliada
  for maior, procura o artifact `corpus-lock` de `develop` com essa versão (do mais novo para o mais
  antigo) e abre o PR com ele. Lock e eval precisam ter a mesma `corpus_version`.
- **PR pelo rótulo.** O environment `staging` não aceita `refs/pull/N/merge` (ADR 0024), e um PR
  não deve receber segredos. O `corpus-eval-label.yml` só dispara o `ingest.yml` em `develop` no
  modo `eval-only` com o SHA do PR (`workflow_dispatch` pelo `GITHUB_TOKEN` cria run), só para PR do
  próprio repositório; o run não abre PR nem grava histórico.
- **Grupos do `affected-paths.yml`.** Reranker e embeddings mudam a ordem e os vetores da busca:
  entram no `rag`. O grupo `docs` (`docs/**`, `openspec/**`, `**/*.md`) só é criado aqui; quem o usa
  é o `ci.yml` (pacote de CI enxuto).

## Risks / Trade-offs

- **Holdout sem revisão humana.** Curadoria assistida por LLM; `reviewed_at` nulo até o mantenedor
  revisar. Um caso errado reprova o `corpus-eval` nas métricas determinísticas e segura o lock.
- **Executar o código de um PR com segredos do staging.** Só por quem pode rotular, só PR do
  próprio repositório, egress bloqueado; o role é o `teko_app` (só leitura no corpus).
- **Artifact expirado.** Depois de 90 dias o `eval-only` não acha o lock; o caminho é rodar o
  ingest completo.
- **Fila de concorrência.** O `eval-only` divide o grupo `ingest-staging`; um dispatch pendente
  substitui outro pendente.

## Context7

| Biblioteca     | ID                           | Consulta                                                                  |
| -------------- | ---------------------------- | ------------------------------------------------------------------------- |
| Promptfoo      | `/websites/promptfoo_dev`    | testes gerados por arquivo TypeScript e função nomeada (`file://…:nome`)   |
| GitHub Actions | `/websites/github_en_actions`| `workflow_dispatch` disparado pelo `GITHUB_TOKEN`; evento `pull_request` |
| download-artifact | `/actions/download-artifact` | artifact de outro run (`run-id`, `github-token`, `actions: read`)     |

O comportamento do promptfoo 0.125.1 com export default (`importModule` devolve
`mod.default[nome]`) foi conferido no código instalado.
