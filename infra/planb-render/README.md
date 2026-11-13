# Plano B: Render Free (`teko-api-planb`), web e API

Contingência da produção quando a Vercel Hobby deixa de servir o Tekó (web e API, na mesma origem desde a
[ADR 0029](../../docs/adr/0029-web-e-api-na-mesma-origem.md)): pausa de cerca de 30 dias por
estouro de cota (503 `DEPLOYMENT_PAUSED`), conta encerrada ou mudança dos termos do Hobby que
inviabilize o projeto. O passo a passo do corte fica no runbook `docs/runbooks/vercel-paused.md`
(escrito na F7); este diretório guarda a definição do serviço (`render.yaml`) e o que muda em
relação à Vercel.

Fora do corte e do ensaio, o serviço fica **parado**. Só a produção tem Plano B; o staging fica
parado durante o corte. A criação do serviço `teko-api-planb` no Render e o primeiro ensaio de
corte são entregas da F7.

## O serviço

| Item             | Valor                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipo             | Web service Node, plano Free, região Virginia (o Render não tem região na América do Sul)                                                             |
| Build            | `corepack pnpm install --frozen-lockfile --ignore-scripts --filter "@teko/api..." --filter "@teko/web..."`, o build da API (tsdown) e o export do web |
| Start            | `NODE_ENV=production node apps/api/dist/server.mjs`: o **mesmo** `src/server.ts` da Vercel, da stack de CI e do `pnpm dev`                            |
| Node             | 24 (`NODE_VERSION`, além do `.nvmrc` da raiz)                                                                                                         |
| Healthcheck      | `/healthz` (nunca toca o banco; 503 durante a drenagem)                                                                                               |
| Deploy           | auto-deploy desligado (`autoDeployTrigger: off`); só por deploy hook com `?ref=<sha da tag>`                                                          |
| `RUNTIME_TARGET` | `render`                                                                                                                                              |
| Web              | o export do Next (`apps/web/out`, `WEB_STATIC_DIR`) servido pelo próprio Fastify (`@fastify/static`), com a política das rotas da Vercel              |

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
- **Web na mesma origem**: com `WEB_STATIC_DIR`, o plugin `static-site` serve o export com a mesma
  política das rotas do `config.json` da Vercel (`static-site/policy.ts`): redirect da raiz pelo
  `Accept-Language`, `/pt-br/` → `/pt-BR/`, headers de segurança do estático, `/_next/static/*`
  imutável e 404 por locale. A API continua só em `/api/*` e `/healthz`.
- **Sem WAF**: o limite por IP passa ao `@fastify/rate-limit` com store em Postgres (10 req/60 s por
  IP do `ClientIp` medido no ensaio), ligado só com `RUNTIME_TARGET=render` (F4). O claim
  `pending → streaming` e 1 stream ativo por usuário continuam valendo.
- **Proveniência**: o Render builda a partir da tag do release, não do tarball atestado do CI. É
  uma exceção documentada, aceita só durante o corte.
- **Configuração**: os mesmos segredos de runtime do `teko-api` e a Config de
  `infra/vercel/env.production.json`, com `RUNTIME_TARGET=render`, `WEB_ORIGIN` igual ao host do
  Render e `WEB_STATIC_DIR=apps/web/out`.

## Limites do Free

- 750 instance-hours por mês por workspace (cobre um serviço 24/7);
- spin-down após 15 min sem tráfego, com cerca de 1 min de cold start: durante o corte, o
  monitor externo pinga `/healthz` a cada 5 min;
- 1 instância, sem disco, reinícios a qualquer momento;
- mais de 100 ms por ida e volta entre Virginia e o Neon `aws-sa-east-1`;
- `maxShutdownDelaySeconds: 110` pode não valer no Free; nesse caso o processo é morto em 30 s e um
  stream longo em curso é cortado.

## Corte (resumo; detalhes no runbook)

1. Deploy hook com a tag do release em produção; smoke em `https://teko-api-planb.onrender.com`
   (ou o host real atribuído).
2. A origem pública passa a ser o host do Render (web e API juntas): avisar no README e no status.
   Cookies e passkeys da Vercel não valem no host novo (outro `rpID`): os usuários entram de novo.
3. O monitor externo passa a pingar o `/healthz` do Render.

## Ensaio (a cada release minor)

Deploy hook, smoke contra o host do Render com um `WEB_ORIGIN` de ensaio, medição do `trustProxy`
(o que chega em `X-Forwarded-For` atrás do balanceador do Render) e retorno ao estado parado. O
resultado vai para `docs/runbooks/vercel-paused.md`.
