---

status: proposed
date: 2026-11-11
decision-makers: Rafael Daily Santos Martins
---

# 0017 — Deploy `--prebuilt` de um `.vercel/output` montado a partir do bundle do tsdown

## Contexto e problema

O plano previa que o builder zero-config do Fastify (`@vercel/fastify` 24.0.1 sobre
`@vercel/node` 29.0.1, na Vercel CLI 65.11.0) compilasse `apps/api/src/server.ts` no `vercel build`
do CI, e deixava como fallback o tsdown gerar o Build Output API (seção Backend do plano e
[ADR 0003](0003-f1-spikes.md), spike F1 (b)).

Na primeira execução do spike (run 42980171686 do `spike-api-vercel.yml`, 2026-11-11), `vercel
pull`, `vercel build --prod`, o tarball atestado e `vercel deploy --prebuilt --prod --skip-domain`
funcionaram, mas a Function caiu no boot: o builder compila `src/server.ts` para `server.js`
mantendo os imports relativos com extensão `.ts`, e o runtime responde
`ERR_MODULE_NOT_FOUND: /var/task/apps/api/src/composition-root.ts` (HTTP 500
`FUNCTION_INVOCATION_FAILED`). Mesmo com os imports reescritos, sobrariam os subpath imports
(`#domain/*` → `./src/domain/*.ts`) e o `@teko/shared`, que exporta `.ts` de dentro do
`node_modules`, onde o Node não faz type stripping.

Como a API chega à Vercel sem perder o mesmo `server.ts` em todas as plataformas, o artefato
atestado e o custo zero?

## Fatores de decisão

- O mesmo `server.ts` (e o mesmo bundle) na Vercel, no Render, na stack de CI e no `pnpm dev`, sem
  entrypoint de plataforma.
- O artefato implantado é o tarball construído e atestado no Actions.
- Nenhuma dependência nova no workspace da aplicação (a Vercel publica `@vercel/*` sem
  proveniência; ADR 0002).
- As travas de boot (`RUNTIME_TARGET`, Node 24, `VERCEL_REGION=gru1`) continuam valendo.

## Opções consideradas

- **Build Output API v3 montado a partir do bundle do tsdown** (o fallback do plano).
- **Continuar no zero-config**, reescrevendo as extensões dos imports.
- **Entrypoint próprio da Vercel** (`api/index.ts` exportando um handler `(req, res)`).
- **Bundle único sem `node_modules`** (tudo embutido pelo tsdown).

## Decisão

Opção escolhida: **Build Output API v3 montado a partir do bundle do tsdown**.

- O `vercel build` sai do fluxo (e o `vercel pull`, que só servia a ele). O CI roda
  `pnpm --filter @teko/api build` (tsdown → `apps/api/dist/server.mjs`), `pnpm --filter @teko/api
  --prod deploy --ignore-scripts --config.node-linker=hoisted dist/vercel/api-prod` e
  `node scripts/build-vercel-output.ts`, que recria `.vercel/output` na raiz do repositório.
- `config.json`: `version: 3` e as mesmas rotas que o zero-config emitia
  (`{ handle: "filesystem" }`, depois `/(.*)` → `/` com `request.path` restaurado para `/$1`).
- Uma única Function, `functions/index.func`, com `.vc-config.json`: `runtime: "nodejs24.x"`,
  `handler: "server.mjs"`, `launcherType: "Nodejs"`, `shouldAddHelpers: false`,
  `shouldAddSourcemapSupport: true`, `supportsResponseStreaming: true` e `maxDuration: 300`.
  O handler é o próprio bundle: o launcher `Nodejs` captura o servidor pelo `listen`, como fazia
  com o `server.js` do zero-config (`apps/api/test/integration/server.test.ts`).
- Dependências de produção no `node_modules` da Function, vindas do `pnpm deploy` com linker
  hoisted (sem links simbólicos). Ficam de fora os `.bin`, os metadados do pnpm e o
  `@teko/shared`, já embutido no bundle.
- A região não vai no `.vc-config.json`: vem da configuração do projeto (`gru1`), e a trava de boot
  `VERCEL_REGION=gru1` derruba a Function se ela mudar.
- Com output pronto, o bloco `functions` do `vercel.json` não se aplica. `maxDuration` e
  `supportsCancellation` passam a ser constantes de `scripts/build-vercel-output.ts`, e o teste
  `scripts/build-vercel-output.test.ts` exige `maxDuration` igual a `FUNCTION_MAX_DURATION_S` de
  `infra/vercel/env.*.json`. Os 120 s com `supportsCancellation: true` do plano só entram depois da
  conferência manual de desconexão do spike.
- Na Vercel, o `under-pressure` roda sem o limite de atraso do event loop
  (`maxEventLoopDelay: 0`, o "desligado" do plugin); no Render, na stack de CI e no local, o
  limite de 1 s do plano continua. No primeiro deploy pelo Build Output API (run 42987608534), o
  `https://teko-api-staging.vercel.app/healthz` respondeu 503 `service_paused` em sequência
  depois de ~10 s de ociosidade: em Fluid compute a instância fica congelada entre invocações, o
  timer de amostragem do plugin para, e o congelamento entra na medida como atraso, que só se
  renova quando a instância fica acordada por um intervalo inteiro. Decisão do mantenedor em
  2026-11-11; quem limita a carga na Vercel é a plataforma (concorrência do Fluid e as regras do
  WAF).

### Consequências

- Bom: o artefato da Vercel é o mesmo bundle do Render, da stack de CI e do Docker; o Install e o
  Build Command do projeto deixam de importar, porque a Vercel não constrói nada.
- Bom: o nome da Function (`index`) e a configuração dela ficam no repositório, testados, e não
  dependem da detecção do builder.
- Ruim: o contrato do Build Output API (campos do `.vc-config.json`, comportamento do launcher
  `Nodejs`) passa a ser nosso. Uma mudança da Vercel nele aparece só no smoke do deploy.
- Ruim: a Function leva o `node_modules` inteiro das dependências de produção (cerca de 40 MB
  descompactados na F1, contra o limite de 250 MB), sem o tree-shaking por arquivo que o
  `@vercel/nft` do builder faria.
- Ruim: na Vercel, um event loop travado de verdade não vira 503 rápido; a requisição espera, e o
  teto é o `maxDuration`.
- Neutro: `framework`, `regions` e `fluid` do `vercel.json` continuam como documentação e segunda
  barreira; o que vale para a Function é a configuração do projeto e o `.vc-config.json`.

### Confirmação

- `scripts/build-vercel-output.test.ts` (`pnpm test:scripts`): forma do `config.json`, do
  `.vc-config.json` e da árvore da Function.
- `apps/api/test/integration/server.test.ts`: o protocolo de captura do `listen` do launcher.
- Spike F1 (b) no `spike-api-vercel.yml`: `/healthz` com 200 na URL única (com bypass) e no
  domínio de produção do `teko-api-staging` (sem bypass). Resultado em
  [ADR 0003](0003-f1-spikes.md).

## Prós e contras das opções

### Build Output API v3 a partir do bundle do tsdown

- Bom: reaproveita o bundle que já resolve subpath imports e embute `@teko/shared`.
- Bom: sem dependência nova; o script usa só o Node 24.
- Ruim: mantemos o contrato do Build Output API e a cópia das dependências.

### Continuar no zero-config, reescrevendo as extensões

- Bom: nenhum código de build próprio.
- Ruim: não resolve o `@teko/shared` em `.ts` dentro do `node_modules` nem os subpath imports
  apontando para `.ts`; exigiria um build próprio do pacote compartilhado.

### Entrypoint próprio da Vercel

- Bom: contrato de handler documentado (`(req, res)` ou `fetch`).
- Ruim: um entrypoint por plataforma, contra a regra do plano, e o mesmo problema de build do
  zero-config se continuar compilado pela Vercel.

### Bundle único sem `node_modules`

- Bom: Function menor, um arquivo só.
- Ruim: o `@scalar/fastify-api-reference` lê arquivos do próprio pacote em runtime, e outras
  dependências podem fazer o mesmo; o bundle quebraria em produção sem aviso no build.
