# Design

## Context

Web e API na mesma origem, um projeto Vercel por ambiente (`tekoia` e `tekoia-staging`, ADR 0029),
deploy sempre `--prebuilt` de um `.vercel/output` montado no CI (ADR 0017). As env vars vivem no
ambiente Production de cada projeto: Config versionadas em `infra/vercel/env.<env>.json` e
Sensitive só pelo nome. O WAF tem 3 regras custom no Hobby. No Hobby, todo token da Vercel tem
escopo da conta, e por isso os scripts param antes de escrever se o projeto não for o esperado.

Documentação consultada no Context7 (IDs):

- `/websites/vercel`:
  - env vars por REST: `GET /v10/projects/{idOrName}/env` (sem valores), `GET
    /v1/projects/{idOrName}/env/{id}` (valor decifrado de uma não sensível),
    `POST /v10/projects/{idOrName}/env` (`key`, `value`, `type`, `target`; `upsert` opcional) e
    `PATCH /v9/projects/{idOrName}/env/{id}` (`value`, `type`, `target`); tipos `system`,
    `encrypted`, `plain`, `sensitive`;
  - firewall por REST: `GET /v1/security/firewall/config/{configVersion}` (com `active`) e
    `PATCH /v1/security/firewall/config` com `projectId`/`teamId` na query e uma ação por chamada
    (`rules.insert` com `id: null`, `rules.update` com o `id` da regra, `rules.remove`,
    `rules.priority`); a página da referência troca as descrições das variantes, e o payload segue
    o que o mantenedor aplicou em 2026-11-13 (`rules.insert`);
  - Build Output API v3, configuração da Function: `environment` (mapa de env vars somadas às do
    projeto), além de `runtime`, `handler`, `maxDuration`, `supportsResponseStreaming`;
  - `GET /v9/projects/{id}` para conferir o nome do projeto.

## Goals / Non-Goals

**Goals:** env vars e WAF aplicados por código a cada deploy, idempotentes e sem vazar valores; um
lockdown versionado com contrato de CLI fixo para o guarda de uso; o commit e a versão dentro do
artefato atestado.

**Non-Goals:** o workflow de deploy (`add-deploy-pipelines`); o guarda de uso que chama o lockdown
(`add-usage-guard`); a página de aviso do web; gravar Sensitive (sempre o mantenedor).

## Decisions

- **REST em vez do CLI.** O CLI (`vercel env`, `vercel firewall`) imprime valores em alguns
  comandos, depende do projeto linkado e não tem saída estável para comparar. A API REST com
  `fetch` do Node 24 não precisa de dependência, é testável com um `fetch` de mentira e devolve só
  o que pedimos. O cliente fica em `scripts/lib/vercel-api.ts` (o guarda de uso reaproveita).
- **Projeto por constante, conferido duas vezes.** Os ids dos dois projetos são constantes por
  ambiente (os do `infra/vercel/README.md`, testados contra ele e contra o `project` dos JSON).
  `VERCEL_PROJECT_ID`, se vier, precisa ser igual à constante, e o nome devolvido por
  `GET /v9/projects/{id}` precisa bater: um token ou id trocado entre ambientes para antes de
  escrever.
- **Env sync.** Sensitive faltando (pela fase de `requiredFrom` até a `CURRENT_PHASE` F7) falha
  antes de qualquer escrita, só com os nomes. Config: a que falta é criada como `encrypted` no alvo
  `production`; a que existe tem o valor lido por id e só é editada se diferente (sem mudar o
  `target`). Config que no projeto é Sensitive é erro (resolver à mão). Sensitive gravada como não
  sensível vira aviso. `LLM_KILL_SWITCH`, `GIT_SHA` e `APP_VERSION` são recusados no JSON; os dois
  últimos também no projeto. Env vars fora do JSON ficam e aparecem no resumo só pelo nome. Nenhum
  valor vai para o log, nem de Config.
- **Firewall.** Comparação pela forma canônica (sem `id`, `valid`, `validationErrors`, nulos e
  `neg: false`, chaves ordenadas), por nome. Regra que falta: `rules.insert`; diferente:
  `rules.update`; do projeto fora do JSON: aviso, sem remover. Regras repetidas no projeto ou
  firewall desligado: erro. Projeto sem config (404): tudo vira insert.
- **Lockdown.** Payload `lockdown` por projeto no `firewall-rules.json`, com o nome da regra 1 e a
  descrição começando com `LOCKDOWN`: nega tudo exceto `/healthz`, `/api/healthz`, `/aviso/`,
  `/<locale>/aviso/`, `/_next/static/*` e `/favicon.ico`. O ativo é reconhecido pela forma
  canônica ou pela descrição. O sync sem `--lockdown` mantém a regra 1 em lockdown (aviso) e
  sincroniza as outras; só `--lockdown off` volta ao normal. Saídas `lockdown=on|off` e `changes`
  no `GITHUB_OUTPUT`.
- **Identidade no artefato.** `GIT_SHA` (40 hex, ou o `GITHUB_SHA`) e `APP_VERSION` (SemVer) vão no
  `environment` do `.vc-config.json`: o tarball atestado diz qual commit é, e o `/healthz` o devolve
  sem env var no projeto. Sem SHA (build local), a Function sai como antes. O `pack-vercel-output`
  não reclama: os dois nomes não estão nos JSON de env vars.

## Risks / Trade-offs

- A forma que a Vercel devolve das regras pode ter campos a mais que a canonização não conhece: o
  efeito é um `rules.update` a cada deploy (idempotente), não um erro. O resumo mostra.
- A página de aviso (`/aviso/`) ainda não existe no web: em lockdown, o navegador recebe o 403 da
  Vercel até ela existir.
- `environment` do `.vc-config.json` e uma env var do projeto com o mesmo nome teriam precedência
  indefinida; o env sync recusa `GIT_SHA` e `APP_VERSION` no projeto.
