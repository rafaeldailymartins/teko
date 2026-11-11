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

| Projeto            | Ambiente lógico | Domínio de produção                   | Neon           | `WEB_ORIGIN`                            |
| ------------------ | --------------- | ------------------------------------- | -------------- | --------------------------------------- |
| `teko-api`         | `production`    | `https://teko-api.vercel.app`         | `teko-prod`    | `https://teko-web.netlify.app`          |
| `teko-api-staging` | `staging`       | `https://teko-api-staging.vercel.app` | `teko-staging` | `https://develop--teko-web.netlify.app` |

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
- [ ] **Install/Build Command:** padrão do preset até o spike F1 (b) decidir (ver "Pendências").

**Functions**

- [ ] **Fluid compute:** ligado (também `"fluid": true` no `vercel.json`).
- [ ] **Function Region:** `gru1` (também `"regions": ["gru1"]`). O Hobby permite uma região só.
- [ ] Memória/CPU: o padrão do Hobby (2 GB / 1 vCPU, fixo). Com Fluid, memória não vai no
  `vercel.json`.
- [ ] `maxDuration`: padrão do Hobby (300 s) até o spike F1 (b) confirmar o nome da Function
  gerada pelo zero-config. Depois, entra no `vercel.json`
  `functions["<entry>"]: { "maxDuration": 120, "supportsCancellation": true }` e a env Config
  `FUNCTION_MAX_DURATION_S` passa para `120` no mesmo PR (a API calcula o prazo de cada
  invocação a partir dela, porque o `@vercel/functions` 3.7.6 não tem `getDeadline`).

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
2. `vercel pull --yes --environment=production`;
3. `vercel build --prod` (ou o Build Output API gerado pelo tsdown, se o spike F1 (b) escolher o
   fallback);
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

O `.vercel/` gerado por `vercel pull`/`vercel build` fica no `.gitignore` e nunca entra em artifact
ou release além do tarball filtrado.

## Como a Function carrega o `server.ts`

Lido do builder `@vercel/fastify` 24.0.1 e do runtime `@vercel/node` 29.0.1 que acompanham a Vercel
CLI 65.11.0 (`tools/vercel-cli`); o spike F1 (b) confirma em deploy real:

- O entrypoint é o primeiro de `app`, `index`, `server`, `src/app`, `src/index`, `src/server` (com
  extensão `js`, `cjs`, `mjs`, `ts`, `cts` ou `mts`) cujo **texto** importe `fastify`. O
  `src/server.ts` tem um `import type ... from 'fastify'` só para isso. Todas as rotas vão para essa
  Function.
- O runtime troca `http.Server.prototype.listen` por um interceptador que só captura o servidor,
  importa o módulo, espera até 1 s pela captura e então faz o `listen` real numa porta efêmera.
  Por isso o `server.ts` aguarda o boot no topo do módulo, mas não aguarda o `listen` (o teste
  `apps/api/test/integration/server.test.ts` reproduz esse protocolo).

## Pendências que dependem de tokens (spikes F1 (b) e (c))

Ainda não há `VERCEL_TOKEN` nem projetos linkados, então nada abaixo foi executado:

- [ ] zero-config detecta `src/server.ts` no monorepo pnpm com Root Directory `apps/api` e resolve
  `@teko/shared` em `.ts` e os subpath imports `#domain/*`, `#app/*`, `#adapters/*`; senão,
  fallback do Build Output API gerado pelo tsdown;
- [ ] Install/Build Command: o `vercel build` no runner reinstala dependências com pnpm 12 (via
  corepack)? Se sim, decidir entre deixar o padrão ou um Install Command que reaproveite a
  instalação do CI;
- [ ] `engines.node` 24.x efetivo, `VERCEL_REGION=gru1` em runtime e o nome da Function (para o
  glob de `functions` no `vercel.json`);
- [ ] SSE de 95 s com heartbeat de 15 s e primeiro byte atrasado em 30 s, sem corte nem buffering;
- [ ] desconexão (`request.signal`, `close` do `request.raw`) com e sem `supportsCancellation`;
- [ ] `waitUntil` depois da resposta, SIGTERM no scale-down e prazo de invocação calculado a partir
  do `maxDuration`;
- [ ] deploy e `promote` durante um stream ativo; `vercel rollback`/`promote` no Hobby;
- [ ] Sensitive de teste visível em runtime e ausente do `.vercel/output` e do tarball;
- [ ] Deployment Protection: URL única sem bypass bloqueada, domínio de produção público;
- [ ] `trustProxy` de 1 salto: o `X-Forwarded-For` que chega ao servidor capturado tem só o IP do
  cliente; `x-real-ip` e `x-forwarded-for` no caminho proxiado (spike c);
- [ ] `x-nf-client-connection-ip`: a Netlify sobrescreve um valor enviado pelo cliente? Só então
  `NETLIFY_CLIENT_IP_TRUSTED` (em `apps/api/src/config/platform.ts`) passa a `true`.
