# Vercel: projetos `teko-api` e `teko-api-staging`

A API roda na Vercel Hobby como **uma única Function Fastify** em Fluid compute, na região `gru1`
(São Paulo, AWS sa-east-1, a mesma dos projetos Neon). O código não tem entrypoint específico de
plataforma: o mesmo `apps/api/src/server.ts` roda na Vercel, no Render (Plano B,
`infra/planb-render`), na stack de CI e no `pnpm dev`; `RUNTIME_TARGET` escolhe os adapters
(`apps/api/src/config/platform.ts`).

Este diretório guarda o que é versionável da configuração:

| Arquivo               | Conteúdo                                                                               |
| --------------------- | -------------------------------------------------------------------------------------- |
| `firewall-rules.json` | As 3 regras custom do WAF por projeto (payloads de `vercel firewall rules add --data`) |
| `env.production.json` | Env vars do `teko-api`: valores Config e só os **nomes** das Sensitive                 |
| `env.staging.json`    | O mesmo para o `teko-api-staging`                                                      |
| `README.md`           | Este checklist (aplicado na F0, reconferido à mão todo mês no relatório do `ops.yml`)  |

A configuração do projeto que vive no repositório fica em `apps/api/vercel.json` e
`apps/api/.vercelignore`.

## Projetos

| Projeto            | Ambiente lógico | Domínio de produção                   | Neon           | `WEB_ORIGIN`                          |
| ------------------ | --------------- | ------------------------------------- | -------------- | ------------------------------------- |
| `teko-api`         | `production`    | `https://teko-api.vercel.app`         | `teko-prod`    | `https://tekoia.netlify.app`          |
| `teko-api-staging` | `staging`       | `https://teko-api-staging.vercel.app` | `teko-staging` | `https://develop--tekoia.netlify.app` |

- Os dois ficam no time Hobby pessoal. Staging é um **projeto à parte**, não um Preview: cada
  projeto só recebe deploys `--prod`, e todas as env vars vão no ambiente Production do projeto.
- Os nomes `*.vercel.app` são atribuídos por ordem de chegada no primeiro deploy (que é sempre de
  produção). Por isso a F0 faz um deploy placeholder (só `/healthz`) logo depois de criar cada
  projeto. Se a Vercel atribuir outro nome, o nome real substitui estes em todo lugar: plugin
  `context-routing`, `NEXT_PUBLIC_STREAM_ORIGIN`, `STREAM_ORIGIN` (env JSON), CSP, smoke,
  UptimeRobot e READMEs.
- Postura não comercial (Hobby): o Tekó é gratuito e MIT, sem anúncios, afiliados, patrocínio
  exibido ou plano pago. Um link de doação é permitido (ADR 0004).

## Configuração de cada projeto (checklist)

Aplicar nos dois projetos, no dashboard (Project Settings), e conferir todo mês.

**Build and Deployment**

- [ ] **Root Directory:** `apps/api`.
- [ ] **Include files outside the Root Directory in the Build Step:** ligado (padrão de projetos
  novos). A Function importa `packages/shared` e precisa do `pnpm-lock.yaml` da raiz.
- [ ] **Framework Preset:** Fastify. O `vercel.json` também fixa `"framework": "fastify"`.
- [ ] **Node.js Version:** 24.x. O `apps/api/package.json` declara `engines.node: "24.x"` (o padrão
  de projetos novos é 26.x), e a API recusa subir com outra major quando
  `RUNTIME_TARGET=vercel` em staging ou produção.
- [ ] **Travas de boot** (`apps/api/src/config/env.ts`): em staging e produção, `RUNTIME_TARGET`
  precisa estar definido explicitamente (sem default) e não pode ser `node`; com a variável de sistema
  `VERCEL=1` presente, qualquer valor diferente de `vercel` impede o boot (vale também para
  `vercel dev`/`vercel env pull`). Os `env.*.json` deste diretório já definem `RUNTIME_TARGET=vercel`.
- [ ] **Install/Build Command:** sem efeito. O deploy é sempre `--prebuilt` de um `.vercel/output`
  montado no CI (ADR 0017); a Vercel não instala nem constrói nada.

**Functions**

- [ ] **Fluid compute:** ligado (também `"fluid": true` no `vercel.json`).
- [ ] **Function Region:** `gru1` (também `"regions": ["gru1"]`). O Hobby permite uma região só.
- [ ] Memória/CPU: o padrão do Hobby (2 GB / 1 vCPU, fixo). Com Fluid, memória não vai no
  `vercel.json`.
- [ ] `maxDuration`: 120 s (100 s de stream + 20 s de reserva), com `supportsCancellation: true`,
  declarados no `.vc-config.json` da Function `index` por `scripts/build-vercel-output.ts`. O bloco
  `functions` do `vercel.json` não vale para output pronto. A env Config `FUNCTION_MAX_DURATION_S`
  acompanha o valor (a API calcula o prazo de cada invocação a partir dela, porque o
  `@vercel/functions` 3.7.6 não tem `getDeadline`), e o teste do script exige os dois iguais. Sem
  `supportsCancellation`, a Function não percebe a desconexão do cliente (spike F1 (b)).

**Git**

- [ ] **Nenhum repositório Git conectado.** O deploy só acontece pela CLI, no Actions. O
  `"git": { "deploymentEnabled": false }` do `vercel.json` é uma segunda barreira, caso alguém
  conecte o repositório por engano.

**Deployment Protection** (os dois projetos, inclusive o staging)

- [ ] **Vercel Authentication: Standard Protection** (o padrão). O domínio de produção de cada
  projeto fica público, porque recebe o proxy da Netlify, o stream direto do navegador e o
  preflight CORS; as URLs únicas de deployment e os deployments antigos exigem login na Vercel.
- [ ] **Nunca "All Deployments"**: bloquearia o proxy e o navegador no domínio de produção.
- [ ] **Protection Bypass for Automation:** um segredo por projeto, guardado no environment do
  GitHub como `VERCEL_AUTOMATION_BYPASS_SECRET` e usado só pelo smoke (`vercel curl
      --protection-bypass`) contra a URL única, antes do `promote`. O smoke nunca cria um bypass
  novo.
- [ ] Password Protection e Trusted IPs: indisponíveis no Hobby; não usar.

**Firewall** (`firewall-rules.json`)

- [ ] As 3 regras custom de cada projeto, ativas: (1) negar tudo fora da API, (2) negar
  `/api/auth/*` e `/api/v1/*` sem `x-nf-sign` (exceto o caminho do stream, que também recebe o
  preflight `OPTIONS` direto do navegador), (3) rate limit de 10 `POST` por IP em 60 s no stream.
- [ ] Nenhuma regra com `challenge`; Attack Challenge Mode desligado (quebra o proxy da Netlify;
  só como último recurso, pelo runbook `vercel-paused.md`).
- [ ] Aplicação: dashboard ou `vercel firewall rules add --data "$(jq -c '.projects["teko-api"].rules[0]' firewall-rules.json)" --yes`
  (com o projeto linkado), regra a regra. A automação e o smoke do efeito chegam na F7.

**Time e conta**

- [ ] 2FA na conta.
- [ ] Opt-out de **Model Training** nas configurações do time (por padrão, os Termos permitem treino
  com o conteúdo de contas Hobby).
- [ ] AI Gateway, integrações do marketplace e Vercel Cron desligados (todo agendamento fica no
  Actions).
- [ ] Nenhum cartão cadastrado. Estourar uma cota do Hobby bloqueia o recurso por cerca de 30 dias
  (503 `DEPLOYMENT_PAUSED`); o Plano B é o Render (`infra/planb-render`).

## Variáveis de ambiente

- **Config** (não secretas): versionadas em `env.<ambiente>.json`, campo `config`, com o valor e a
  fase (`since`) em que a API passa a lê-las. Antes de cada deploy, `scripts/vercel-env-sync.ts`
  (F7) as aplica como env vars do tipo Config e falha se faltar alguma Sensitive obrigatória para a
  fase (`vercel env ls`).
- **Sensitive** (write-only): só os nomes ficam aqui, no campo `sensitive`. O mantenedor grava o
  valor pelo dashboard ou com `vercel env add NAME production --sensitive` lendo o valor do stdin
  (nunca na linha de comando). Elas não existem no GitHub e nunca entram no build: o `vercel pull`
  só traz Config e placeholders.
- `LLM_KILL_SWITCH` **não** está nos JSON de propósito: só o job `vercel-usage` (85% de qualquer
  cota) ou o mantenedor o gravam, e um sync de deploy não pode desligá-lo.
- `VERCEL_REGION` é variável de sistema (só em runtime; falta no build com `--prebuilt`). A API exige
  `gru1` em staging e produção.
- Env var só vale em deployment nova. Rotação: atualizar a Sensitive e rodar o `deploy-api.yml` com
  `phase: redeploy` (`vercel redeploy` da deployment de produção atual, reaproveitando o output
  prebuilt atestado).

## Como o deploy acontece

O Vercel CLI não faz parte do workspace da aplicação: ele vive em `tools/vercel-cli`, um projeto
pnpm isolado com lockfile próprio e as exceções de `trustPolicy` que a Vercel exige (desde ago/2026
ela publica `vercel` e `@vercel/*` sem proveniência SLSA; ADR 0002). Os jobs de deploy instalam
esse projeto com `--frozen-lockfile` e chamam o binário dele. No app, o único pacote da Vercel é
`@vercel/functions` 3.7.6 (a última versão com proveniência), confinado a
`apps/api/src/adapters/out/platform/vercel` pelo dependency-cruiser.

Fluxo do `deploy-api.yml` (`develop` → `teko-api-staging`; release em `main` → `teko-api`), com
`VERCEL_TOKEN`, `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` do environment do GitHub:

1. `pnpm install --frozen-lockfile`, `pnpm audit --prod` e osv-scanner no commit exato;
2. sem `vercel pull` nem `vercel build` (ADR 0017): `pnpm --filter @teko/api build` (tsdown),
   `pnpm --filter @teko/api --prod deploy --ignore-scripts --config.node-linker=hoisted
   dist/vercel/api-prod` (dependências de produção, sem links simbólicos);
3. `node scripts/build-vercel-output.ts`: recria `.vercel/output` (Build Output API v3) com a
   Function `index`;
4. `node scripts/pack-vercel-output.ts --env production|staging`: tarball determinístico do
   `.vercel/output` (sem `.vercel/.env*` nem `project.json`), com sha256. `--env` é o único
   argumento; o resto é fixo: env vars de `infra/vercel/env.<env>.json`, build no primeiro de
   `.vercel/output` e `apps/api/.vercel/output` que existir, saída em
   `dist/vercel/<env>/output.tgz` e `output.tgz.sha256`, e as saídas `tarball`, `sha256` e
   `bytes` no `GITHUB_OUTPUT`. `gitleaks` e `tar` saem só de diretórios absolutos e protegidos do
   PATH, então o job instala o gitleaks verificado por SHA-256 num diretório que acrescenta ao
   `GITHUB_PATH`;
5. SBOM (syft) e Grype; `actions/attest` do tarball;
6. migrações (`drizzle-kit migrate`, a partir da F2);
7. `scripts/vercel-env-sync.ts` (F7);
8. `gh attestation verify`, extração e `vercel deploy --prebuilt --prod --skip-domain
   --archive=tgz --meta artifactSha256=<sha256> --meta gitSha=$GITHUB_SHA`;
9. smoke da URL única com `vercel curl` e o bypass de automação;
10. `vercel promote <url>`; preflight CORS real no domínio de produção; falha → `vercel rollback`.

O `.vercel/` gerado no CI fica no `.gitignore` e nunca entra em artifact ou release além do
tarball filtrado.

## Como a Function carrega o `server.ts`

O builder zero-config do Fastify não é usado (ADR 0017): no spike F1 (b) ele compilou
`src/server.ts` mantendo os imports `.ts`, e a Function caiu com `ERR_MODULE_NOT_FOUND`. O
`.vercel/output` sai de `scripts/build-vercel-output.ts`:

- Uma Function, `functions/index.func`, com `.vc-config.json` `runtime: "nodejs24.x"`,
  `launcherType: "Nodejs"`, `handler: "server.mjs"` (o bundle do tsdown),
  `supportsResponseStreaming: true` e `maxDuration`; o `node_modules` dela tem só as dependências
  de produção. O `config.json` manda tudo o que não é arquivo estático para ela, com o caminho
  original (as mesmas rotas que o zero-config emitia). A região vem do projeto.
- O launcher `Nodejs` (o mesmo que carregava o `server.js` do zero-config; lido do `@vercel/node`
  29.0.1 da Vercel CLI 65.11.0) troca `http.Server.prototype.listen` por um interceptador que só captura o servidor,
  importa o módulo, espera até 1 s pela captura e então faz o `listen` real numa porta efêmera.
  Por isso o `server.ts` aguarda o boot no topo do módulo, mas não aguarda o `listen` (o teste
  `apps/api/test/integration/server.test.ts` reproduz esse protocolo).

## Pendências que dependem de tokens (spikes F1 (b) e (c))

O `spike-api-vercel.yml` roda no environment `staging` do GitHub. Itens marcados têm resultado
registrado; o resto continua aberto:

- [x] zero-config detecta `src/server.ts` no monorepo pnpm com Root Directory `apps/api` e resolve
  `@teko/shared` em `.ts` e os subpath imports? **Não** (run 42980171686): o `server.js` gerado
  importa `./composition-root.ts` e a Function cai com `ERR_MODULE_NOT_FOUND` (HTTP 500
  `FUNCTION_INVOCATION_FAILED`). Adotado o fallback do Build Output API a partir do bundle do
  tsdown (ADR 0017);
- [x] Install/Build Command: sem efeito, porque a Vercel não constrói mais nada (no run
  42980171686, o `vercel build` reaproveitou a instalação do CI: "Done in 2ms using pnpm
  v12.18.0");
- [x] `engines.node` 24.x efetivo, `VERCEL_REGION=gru1` em runtime e o nome da Function: **sim**
  (run 42987608534). O `/healthz` responde 200 com `env: staging`, o que só acontece com as travas
  de boot de Node `v24.*` e `VERCEL_REGION=gru1` satisfeitas; `vercel inspect` mostra
  `λ index (8.54MB) [gru1]`. A Function é `index` (`.vc-config.json` com `nodejs24.x`), e
  `maxDuration`/`supportsCancellation` vão no `.vc-config.json`, não no `vercel.json`;
- [x] env vars do `teko-api-staging`: o projeto não tinha nenhuma. As Config da F1 de
  `env.staging.json` (`APP_ENV`, `NODE_ENV`, `RUNTIME_TARGET`, `WEB_ORIGIN`,
  `FUNCTION_MAX_DURATION_S`, `LOG_LEVEL`) foram **gravadas à mão no spike** (2026-11-11, Config de
  Production, `vercel env add --no-sensitive`), com aval do mantenedor; nenhuma Sensitive. O
  `scripts/vercel-env-sync.ts` da F7 assume isso. O `teko-api` (produção) ainda não existe;
- [x] `under-pressure` na Vercel: com `maxEventLoopDelay: 1000`, o domínio de produção ficou em 503
  `service_paused` depois de ~10 s de ociosidade (o congelamento da instância Fluid conta como
  atraso do event loop). Na Vercel, o limite fica desligado (rafaeldailymartins/teko#8, ADR 0017);
  depois disso (run 42989881707), 13 de 13 respostas 200 com até 60 s de ociosidade entre elas;
- [x] SSE de 95 s com heartbeat de 15 s e primeiro byte atrasado em 30 s, sem corte nem buffering:
  `start` aos 30,2 s, heartbeats a cada 15 s e `end` aos 95,2 s (run 43007922090);
- [x] desconexão: sem `supportsCancellation`, a Function não percebe (um SSE de 60 s abandonado aos
  15 s rodou até o fim); com ele, `request.signal` e o `close` da resposta disparam aos 14,7 s.
  `supportsCancellation: true` passou a ser o padrão do `.vc-config.json`;
- [x] `waitUntil` depois da resposta: a tarefa terminou 1.501 ms depois de um 202 em 2 ms;
- [ ] SIGTERM no scale-down: não apareceu nos logs da janela de 30 min (retenção curta do Hobby);
  risco residual, coberto pelo teto de 450 ms do encerramento;
- [x] `promote` de uma deployment de produção anterior durante um stream ativo: o stream terminou na
  deployment de origem, e o promote de volta funcionou. Logo depois do "Success", o domínio ainda
  pode servir a deployment anterior por um instante. `vercel rollback` não foi rodado;
- [x] Sensitive de teste visível em runtime (`/api/_spike/runtime`, só o tamanho) e fora do output por
  construção (o build não lê env da Vercel, e o pack recusa `.env*`);
- [x] Deployment Protection: URL única sem bypass bloqueada (HTTP 302 para o login da Vercel) e
  domínio de produção público (200 sem bypass), no run 42987608534;
- [x] `trustProxy` de 1 salto: a Vercel sobrescreve `x-forwarded-for` e `x-real-ip` com o IP de quem
  conectou (um valor forjado some); no caminho proxiado, esse IP é o de saída da Netlify, que muda
  a cada requisição (spike c, run 43009440530);
- [x] `x-nf-client-connection-ip`: a Netlify sobrescreve o valor enviado pelo cliente, e uma chamada
  direta à Vercel o deixa passar forjado. `NETLIFY_CLIENT_IP_TRUSTED` passou a `true`, valendo só
  com `x-nf-sign` válido;
- [x] `x-nf-sign`: presente e verificado com o `NETLIFY_PROXY_JWS_SECRET` (Sensitive aqui; variável
  comum no site `tekoia`, porque o Netlify Free não tem escopo nem valor secreto). No alias
  `develop`, `deploy_context` é `branch-deploy`. Sem cache na Netlify nem na Vercel, Cookie e
  Set-Cookie passam, e o proxy soma 27 ms de mediana;
- [ ] regras do WAF: ainda não aplicadas (`/api/v1/*` direto e sem assinatura dá 404, não 403); F7;
- [ ] cold start (p95) e o pior caso de cold start + resume do Neon dentro dos 26 s do proxy: F2.
