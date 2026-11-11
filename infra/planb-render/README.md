# Plano B da API: Render Free (`teko-api-planb`)

Contingência da produção quando a Vercel Hobby deixa de servir a API: pausa de cerca de 30 dias por
estouro de cota (503 `DEPLOYMENT_PAUSED`), conta encerrada ou mudança dos termos do Hobby que
inviabilize o projeto. O passo a passo do corte fica no runbook `docs/runbooks/vercel-paused.md`;
este diretório guarda a definição do serviço (`render.yaml`) e o que muda em relação à Vercel.

Fora do corte e do ensaio, o serviço fica **parado**. Só a produção tem Plano B; o staging fica
parado durante o corte.

## O serviço

| Item             | Valor                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipo             | Web service Node, plano Free, região Virginia (o Render não tem região na América do Sul)                                                                     |
| Build            | `corepack pnpm install --frozen-lockfile --ignore-scripts --filter "@teko/api..."` e `corepack pnpm --filter @teko/api build` (tsdown, embute `@teko/shared`) |
| Start            | `NODE_ENV=production node apps/api/dist/server.mjs`: o **mesmo** `src/server.ts` da Vercel, da stack de CI e do `pnpm dev`                                    |
| Node             | 24 (`NODE_VERSION`, além do `.nvmrc` da raiz)                                                                                                                 |
| Healthcheck      | `/healthz` (nunca toca o banco; 503 durante a drenagem)                                                                                                       |
| Deploy           | auto-deploy desligado (`autoDeployTrigger: off`); só por deploy hook com `?ref=<sha da tag>`                                                                  |
| `RUNTIME_TARGET` | `render`                                                                                                                                                      |

O Blueprint é criado uma vez pelo dashboard (New → Blueprint, apontando para
`infra/planb-render/render.yaml`). Os segredos (`sync: false`) são pedidos só nessa criação; depois,
qualquer mudança é feita no dashboard do serviço. O deploy hook vai para o secret
`RENDER_DEPLOY_HOOK_URL` do environment `production` do GitHub. Nenhuma forma de pagamento é
cadastrada no workspace: sem ela, o Render suspende o serviço ao fim das horas ou da banda em vez
de cobrar.

## O que muda em relação à Vercel

- **Plataforma** (`apps/api/src/config/platform.ts`): `BackgroundTasks` só acompanha a promise (o
  processo vive além da resposta, e o SIGTERM espera as tarefas); não há prazo de invocação; o
  encerramento usa `SHUTDOWN_GRACE_MS`/`DRAIN_DELAY_MS`.
- **`trustProxy` e `ClientIp`**: vêm do ensaio, nunca do perfil da Vercel. `TRUST_PROXY` é
  obrigatória com `RUNTIME_TARGET=render` (a API não sobe sem ela) e aceita número de saltos
  (`1`) ou IPs/CIDRs. O request id é sempre um UUID próprio, porque o Render repassa o
  `X-Request-Id` do cliente.
- **Sem WAF**: o pré-filtro da regra 2 fica só no plugin `netlifySignature`, e o limite por IP do
  stream passa ao `@fastify/rate-limit` com store em Postgres (10 req/60 s por IP do `ClientIp`
  medido no ensaio), ligado só com `RUNTIME_TARGET=render` (F4). O claim único do ticket e 1 stream
  ativo por usuário continuam valendo.
- **Proveniência**: o Render builda a partir da tag do release, não do tarball atestado do CI. É
  uma exceção documentada, aceita só durante o corte.
- **Configuração**: os mesmos segredos de runtime do `teko-api` e a Config de
  `infra/vercel/env.production.json`, com `RUNTIME_TARGET=render` e `STREAM_ORIGIN` do host do
  Render.

## Limites do Free

- 750 instance-hours por mês por workspace (cobre um serviço 24/7);
- spin-down após 15 min sem tráfego, com cerca de 1 min de cold start: durante o corte, o
  UptimeRobot pinga `/healthz` a cada 5 min para o cold start não estourar o corte de 26 s do proxy
  da Netlify;
- 1 instância, sem disco, reinícios a qualquer momento;
- mais de 100 ms por ida e volta entre Virginia e o Neon `aws-sa-east-1`;
- `maxShutdownDelaySeconds: 110` pode não valer no Free; nesse caso o processo é morto em 30 s e um
  stream longo em curso é cortado.

## Corte (resumo; detalhes no runbook)

1. Deploy hook com a tag do release em produção; smoke em `https://teko-api-planb.onrender.com`
   (ou o host real atribuído).
2. Na Netlify, `TEKO_API_PROXY_TARGET` e `NEXT_PUBLIC_STREAM_ORIGIN` passam ao host do Render; o
   CSP `connect-src` acompanha. Custa um deploy de produção na Netlify (15 créditos).
3. `WEB_ORIGIN`, CORS e o `aud` do ticket (`APP_ENV`) não mudam.
4. UptimeRobot passa a pingar o `/healthz` do Render.

## Ensaio (a cada release minor)

Deploy hook, smoke contra o host do Render com um `WEB_ORIGIN` de ensaio, medição do `trustProxy`
(o que chega em `X-Forwarded-For` atrás do balanceador do Render) e retorno ao estado parado. O
resultado vai para `docs/runbooks/vercel-paused.md`.
