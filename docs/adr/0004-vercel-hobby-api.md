---

status: accepted
date: 2026-11-10
decision-makers: Rafael Daily Santos Martins
---

# 0004 — API no Vercel Hobby (uma Function Fluid, dois projetos, `gru1`) com Plano B no Render

## Contexto e problema

O plano anterior hospedava a API (Fastify 5, Node 24) em Docker numa VM Oracle Cloud Always Free
A1, atrás de Caddy, com DNS dinâmico no deSEC (`*.dedyn.io`), provisionamento por cloud-init,
imagens arm64 no GHCR, deployer blue/green pull-based, Grafana Alloy e um `pg-standby` local. O
Vercel Hobby era o Plano B.

Em 2026-11-10, o cadastro da Oracle Cloud no Brasil só ofereceu o tipo de cliente
"Customer type: Corporate", que exige CNPJ. O mantenedor não tem CNPJ, então a VM não existe. Onde
a API passa a rodar, mantendo custo zero absoluto, nenhum cartão cadastrado, SSE de até 100 s, a
mesma região do Neon (`aws-sa-east-1`) e deploy de código construído e atestado no CI?

## Fatores de decisão

- Custo zero sem cartão: o serviço precisa **parar** ao atingir a cota, nunca cobrar.
- Streaming de respostas de até 100 s, com heartbeat, sem corte nem buffering.
- Latência baixa até o Neon em `aws-sa-east-1` (cada pergunta faz várias transações curtas).
- Proveniência: produção roda só o artefato construído e atestado no GitHub Actions.
- Mantenedor solo: nada de sistema operacional, TLS, firewall ou DNS para administrar.
- Separação real entre staging e produção, cada um com domínio público estável.

## Opções consideradas

- **Vercel Hobby**: Fastify como uma única Vercel Function em Fluid compute, região `gru1`, dois
  projetos.
- **VM Oracle Cloud Always Free A1** (decisão anterior).
- **Render Free** como plataforma principal.
- **Netlify Functions** (pedido original).
- **Cloudflare Workers Free**.

## Decisão

Opção escolhida: **Vercel Hobby**, porque é a única opção sem cartão que entrega 300 s por
invocação com streaming, região em São Paulo junto do Neon e pausa em vez de cobrança. O **Render
Free** fica como Plano B, com o mesmo `server.ts`.

### Projetos e domínios

| Projeto            | Ambiente   | Domínio de produção (`STREAM_ORIGIN` e alvo do proxy) | Neon           | `WEB_ORIGIN`                            |
| ------------------ | ---------- | ----------------------------------------------------- | -------------- | --------------------------------------- |
| `teko-api`         | production | `https://teko-api.vercel.app`                         | `teko-prod`    | `https://teko-web.netlify.app`          |
| `teko-api-staging` | staging    | `https://teko-api-staging.vercel.app`                 | `teko-staging` | `https://develop--teko-web.netlify.app` |

- Os dois projetos ficam no time Hobby pessoal, com Root Directory `apps/api`, Fluid compute,
  região de Functions `gru1` (São Paulo, AWS sa-east-1) e **sem repositório Git conectado**. O
  Hobby permite uma única região de Functions, e ela basta.
- Staging é um projeto à parte, e não um Preview: Custom Environments são do plano Pro, branch
  URLs exigem a integração Git (desligada) e previews ficam atrás do Vercel Authentication. Cada
  projeto só recebe deploys `--prod`.
- Os nomes `*.vercel.app` são distribuídos por ordem de chegada e só são atribuídos no primeiro
  deploy. A F0 faz um deploy placeholder (só `/healthz`) em cada projeto. Se a Vercel atribuir
  outro nome, o nome real substitui estes no plano, nesta ADR, no plugin `context-routing`, em
  `NEXT_PUBLIC_STREAM_ORIGIN`, no CSP, no smoke, no UptimeRobot e nos READMEs.

### Deploy

- `apps/api/vercel.json` fixa `regions: ["gru1"]`, `fluid: true` e
  `git.deploymentEnabled: false`. Sem crons da Vercel: todo agendamento fica no Actions. O bloco
  `functions` (com `maxDuration: 120` e `supportsCancellation`) entra depois que o spike F1 (b)
  confirmar o nome da Function gerada pelo zero-config do Fastify.
- Fluxo do CI: `vercel pull` → `vercel build` → tarball do `.vercel/output` atestado →
  `vercel deploy --prebuilt --prod --skip-domain` → `vercel curl` na URL única →
  `vercel promote`. Rollback por `vercel rollback`/`vercel promote` de uma deployment anterior.
  Deployments são imutáveis: streams em curso terminam na deployment antiga, o que substitui o
  blue/green.
- O Vercel CLI (`vercel` 65.11.0) vive no projeto pnpm isolado `tools/vercel-cli`, com lockfile e
  exceções de proveniência próprios, e só roda nos jobs de deploy (ver
  [ADR 0002](0002-supply-chain-pnpm.md)). O workspace da aplicação não tem nenhuma exceção para a
  Vercel.
- `@vercel/functions` fica fixado em **3.7.6** no workspace da aplicação (última versão com
  proveniência SLSA; ver ADR 0002). Essa versão exporta `waitUntil`, `attachDatabasePool`,
  `ipAddress`, `geolocation` e `getContext`, mas **não** `getDeadline`. O prazo de cada invocação é
  calculado pela própria API a partir do `maxDuration` configurado (início da invocação +
  `maxDuration`), e cada tarefa de `BackgroundTasks` tem teto próprio dentro dele.

### Limites do Hobby que o código respeita

| Limite                         | Valor                                        | Consequência no Tekó                                                                         |
| ------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Memória e CPU por instância    | 2 GB / 1 vCPU                                | A stack de CI usa `API_CPUS=1` e `API_MEM=2048m`                                             |
| Duração máxima                 | 300 s, incluindo o stream                    | Teto de 100 s no stream; heartbeat a cada 15 s                                               |
| Payload                        | 4,5 MB                                       | `bodyLimit` de 32 KB                                                                         |
| File descriptors               | 1.024 por instância, entre invocações        | Pool `pg` com `max: 3`                                                                       |
| Encerramento no scale-down     | SIGTERM com 500 ms                           | `forceFlush` ≤ 400 ms e `pool.end()`                                                         |
| Logs de runtime                | 1 h, sem drains no Hobby                     | Logs duráveis via OTLP para o Grafana Cloud                                                  |
| Cotas mensais (CPU, GB-h etc.) | Estouro pausa o recurso por cerca de 30 dias | Tetos na aplicação, WAF, guarda diária de uso com kill switch, nenhuma carga contra a Vercel |

### Segurança e termos

- WAF do Hobby com 3 regras custom (`infra/vercel/firewall-rules.json`): deny fora das rotas
  conhecidas, deny em `/api/auth/*` e `/api/v1/*` sem `x-nf-sign` (exceto o stream) e rate limit
  por IP só no stream. Nenhuma regra usa Challenge, que quebraria o proxy da Netlify.
- Deployment Protection **Standard** (domínios de produção públicos; URLs únicas e deployments
  antigas exigem login na Vercel), 2FA, opt-out de Model Training no time (os Termos permitem, por
  padrão, treino com conteúdo de contas Hobby), AI Gateway, integrações do marketplace e Vercel
  Cron desligados. Checklist em `infra/vercel/README.md`.
- Segredos de runtime são env vars **Sensitive** (write-only) do ambiente Production de cada
  projeto e nunca existem no GitHub nem no ambiente de build. A configuração não secreta fica
  versionada em `infra/vercel/env.{staging,production}.json`.
- **Postura não comercial.** O Hobby é restrito a uso pessoal e não comercial (seção "Hobby Plan"
  dos Termos da Vercel, citada pelo nome porque a numeração do sumário e a do corpo divergem). O
  Tekó fica gratuito e MIT, sem anúncios, afiliados, patrocínio exibido, plano pago ou consultoria
  paga ligada ao deploy; doações são permitidas. README e CONTRIBUTING repetem a regra.
- **AUP.** Raspagem, ingestão e backfill de embeddings rodam no Actions, nunca em Functions. A API
  não é um relay aberto de LLM.

### Plano B: Render Free

- **Quando.** Pausa de 30 dias do Hobby, conta Vercel encerrada ou mudança dos termos do Hobby.
- **Como.** Web service Node do Render Free (`teko-api-planb`, região Virginia), descrito em
  `infra/planb-render/render.yaml`, com auto-deploy desligado e deploy por deploy hook; o mesmo
  `server.ts`, com `RUNTIME_TARGET=render`. Só a produção tem Plano B. Sem forma de pagamento
  cadastrada, o Render suspende o serviço ao fim das horas ou da banda em vez de cobrar.
- **Limites.** 750 instance-hours por mês por workspace, spin-down após 15 min sem tráfego e
  cerca de 1 min para voltar; mais de 100 ms por ida e volta até o Neon.
- **Proveniência.** No Render, o build é feito pelo próprio Render a partir da tag do release:
  exceção documentada, aceita só durante o corte.
- **Ensaio.** A cada release minor, registrado em `docs/runbooks/vercel-paused.md`.

### Consequências

- Bom, porque saem Caddy, deSEC, cloud-init, iptables, sshd, unattended-upgrades, timers systemd,
  deployer blue/green, imagens arm64 no GHCR, Grafana Alloy e `pg-standby`: não há servidor para
  administrar.
- Bom, porque a Function roda em `gru1`, a mesma região AWS do Neon, e as deployments imutáveis dão
  rollback instantâneo.
- Bom, porque o deploy `--prebuilt` publica exatamente o `.vercel/output` construído e atestado no
  CI.
- Ruim, porque estourar qualquer cota mensal do Hobby pausa a API por cerca de 30 dias: exige
  tetos na aplicação, WAF, guarda diária de uso e o Plano B ensaiado.
- Ruim, porque a Vercel publica o CLI e os pacotes `@vercel/*` sem proveniência SLSA desde
  ago/2026: o CLI fica isolado em `tools/vercel-cli` e `@vercel/functions` fica preso em 3.7.6, sem
  `getDeadline`.
- Ruim, porque o Hobby permite uma só região e tem logs de runtime de 1 h sem drains: a
  observabilidade depende do OTLP direto.
- Neutro: o `Dockerfile` de `apps/api` continua existindo só para a stack de CI e o dev local; a
  imagem nunca é publicada.

### Confirmação

- F0: `curl -fsS https://teko-api.vercel.app/healthz` e o equivalente de staging respondem pelo
  placeholder; domínios reais registrados nesta ADR se diferirem.
- Spikes F1 (b), (c) e (d) registrados na [ADR 0003](0003-f1-spikes.md): zero-config do Fastify no
  monorepo, SSE de 95 s, cancelamento, `waitUntil`, SIGTERM, promote durante stream, Sensitive
  ausente do output, proxy assinado, WAF, cold start e `attachDatabasePool` com o Neon.
- F7: smoke, guarda de uso e ensaio do Plano B.

## Prós e contras das opções

### VM Oracle Cloud Always Free A1

- Bom, porque 4 OCPU e 24 GB sem limite de duração de request.
- Ruim, porque exige administrar SO, TLS, DNS dinâmico, firewall e deploy blue/green.
- **Inviável**: o cadastro no Brasil só oferece "Customer type: Corporate", que exige CNPJ.

### Render Free como principal

- Bom, porque roda o servidor Node sem adaptação.
- Ruim, porque não tem região na América do Sul (Virginia, mais de 100 ms até o Neon), dorme
  após 15 min com cerca de 1 min de cold start e reinicia a qualquer momento. Serve como Plano B.

### Netlify Functions

- Bom, porque o front já está na Netlify.
- Ruim, porque param em 60 s, ficam em Ohio e consomem o mesmo pool de 300 créditos do front:
  esgotado, pausaria também o site.

### Cloudflare Workers Free

- Ruim, porque o Fastify não é suportado e o limite é de 10 ms de CPU por request.

Também descartada: uma segunda conta Vercel para somar cotas, que viola a política de uso justo.

## Mais informações

- Plano de implementação, seções "Vercel", "Plano B (Render Free)" e "Deploy e rollback".
- [ADR 0001](0001-record-architecture-decisions.md) (tabela de desvios),
  [ADR 0002](0002-supply-chain-pnpm.md) (proveniência da Vercel e `tools/vercel-cli`) e
  [ADR 0003](0003-f1-spikes.md) (spikes).
- Fontes Context7 consultadas em 2026-11-10:
  - `/websites/vercel`: limites de Functions no Hobby (300 s, 2 GB / 1 vCPU, uma região,
    1.024 file descriptors), `vercel build` + `vercel deploy --prebuilt --prod` no GitHub Actions,
    `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`, API do pacote `@vercel/functions` (`waitUntil`,
    `attachDatabasePool`, `getDeadline` nas versões atuais);
  - `/websites/render`: instância Free (750 h por workspace, spin-down em 15 min, cerca de 1 min
    para voltar, suspensão sem forma de pagamento).
