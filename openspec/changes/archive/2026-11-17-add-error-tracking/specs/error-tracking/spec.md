## ADDED Requirements

### Requirement: Erros inesperados da API no PostHog

Com `POSTHOG_PROJECT_KEY`, a API MUST mandar ao PostHog Error Tracking da UE cada erro inesperado
(Problem Details `internal`) pela `ErrorReporterPort`, com `trace_id`, método, rota declarada,
status, `app_env` e o release (`teko@X.Y.Z` na produção, `teko@<sha7>` nos demais), e o flush SHALL
ir para `BackgroundTasks` com teto de 500 ms só quando houve erro. Os 4xx e os 503 deliberados MUST
NOT ser reportados. Sem a chave, nada SHALL sair.

#### Scenario: Bug numa rota

- **WHEN** um handler lança um erro inesperado em `GET /api/v1/provisions/:id` no staging
- **THEN** a resposta é o 500 `internal` de sempre, um `$exception` sai com `trace_id` igual ao
  `x-trace-id`, `http_route` `/api/v1/provisions/:id` e `release` `teko@<sha7>`, e uma tarefa
  `error-flush` de 500 ms é agendada

#### Scenario: Erro esperado

- **WHEN** a API responde 400 `validation_error` ou 503 `service_paused`
- **THEN** nada vai ao PostHog e nenhum flush é agendado

### Requirement: Erro sem dado pessoal

O erro reportado MUST ser uma cópia com nome, mensagem e pilha, sem `cause` nem propriedades do
original (só um `code` técnico): a PII de texto livre SHALL ser trocada pelos marcadores do
`PiiRedactor`, credenciais de URL por `[REDACTED]`, a mensagem cortada em 500 caracteres, e as
linhas de código-fonte dos frames removidas. O `distinct_id` SHALL ser o `trace_id`, sem perfil de
pessoa nem GeoIP; corpo, pergunta, e-mail, IP e usuário MUST NOT sair.

#### Scenario: Mensagem com e-mail e URL de banco

- **WHEN** o erro diz `falhou para maria@example.com em postgres://app:senha@host/db`
- **THEN** sai `falhou para [EMAIL] em postgres://[REDACTED]@host/db`, com
  `$process_person_profile` falso

### Requirement: Erros do navegador capturados

Com `NEXT_PUBLIC_POSTHOG_ERRORS_KEY` no build, o web MUST capturar os erros não tratados (`error` e
`unhandledrejection`), os dos `ErrorBoundary` e as consultas e mutações que falham com `ApiError`
`internal` vindo da API, independente do consentimento de analytics. O evento SHALL levar o release
do build e, para um `ApiError`, o `trace_id` dele; no máximo 10 erros por página, o mesmo erro uma
vez.

#### Scenario: Erro repetido

- **WHEN** o mesmo erro é lançado duas vezes na página
- **THEN** só um `$exception` sai

### Requirement: Cliente de erros sem gravar nada

O `posthog-js` SHALL ser carregado por `import()` só no primeiro erro, numa instância própria com
`persistence: 'memory'`, `person_profiles: 'never'` e sem `identify`, pageview, autocapture nem
flags. O `before_send` MUST deixar sair só `$exception`, com a PII das mensagens redigida e as URLs
sem query. Nenhum cookie nem chave de storage MUST ser gravado.

#### Scenario: Consulta que falha com 500

- **WHEN** `GET /api/v1/coverage` responde 500 `internal` com `traceId` numa visita que recusou a
  medição
- **THEN** um `$exception` vai a `https://eu.i.posthog.com` com esse `trace_id` e o release, e o
  navegador continua sem cookie e sem chave do PostHog no storage

#### Scenario: Página sem erro

- **WHEN** uma página carrega sem erro e sem consentimento de medição
- **THEN** o SDK do PostHog não é baixado e nenhum pedido vai a ele

### Requirement: Source maps para o PostHog

O web MUST gerar os `.map` do export e a API os do bundle. O `scripts/sourcemaps.ts inject` SHALL
injetar os chunk ids sem rede nem credencial real (fora do repositório, sem as variáveis do CI, com a
rede bloqueada), e o `upload` MUST exigir a chave pessoal e mandar os `.map` ao host da UE com o
release `teko@<versão>`. O `posthog-cli` MUST vir de `tools/posthog-cli`, com o binário conferido
pelo sha256 fixado.

#### Scenario: Inject na stack de CI

- **WHEN** o `infra/ci/up.sh` builda o web
- **THEN** cada chunk com `.map` termina em `//# chunkId=<uuid>`, sem nenhum pedido à rede

#### Scenario: Upload sem a chave

- **WHEN** `node scripts/sourcemaps.ts upload --release-version 0.1.0` roda sem
  `POSTHOG_CLI_API_KEY`
- **THEN** sai com código 2 antes de chamar o CLI

#### Scenario: Binário adulterado

- **WHEN** o artefato baixado do GitHub Releases não tem o sha256 fixado
- **THEN** o `install-binary.mjs` falha e não extrai nada
