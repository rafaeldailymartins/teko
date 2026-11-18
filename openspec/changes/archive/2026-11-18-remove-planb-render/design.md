# Design

## Context

O Plano B (ADR 0004, seção "Plano B: Render Free", e item 10 da ADR 0029) previa um web service do
Render Free servindo web e API se a Vercel Hobby pausasse o projeto. O mantenedor decidiu não tê-lo
(ADR 0038). O serviço nunca foi criado, então não há nada a desligar fora do repositório.

## Goals / Non-Goals

**Goals:** tirar do código, da configuração, das specs e dos documentos tudo o que só existia para o
Render, sem mudar o comportamento na Vercel, na stack de CI, no Docker e no `pnpm dev`.

**Non-Goals:** o plano de reação a uma pausa da Vercel (runbooks e workflows da F7); o rate limit de
aplicação com store em Postgres, que vale na Vercel e não muda.

## Decisions

- **`RuntimeTarget` com dois valores** (`node`, `vercel`). Em staging e produção a falta da variável
  ou `node` continuam derrubando o boot; um `render` deixado num env antigo cai na validação do enum.
- **`TRUST_PROXY` removida, não só deixada opcional.** Na Vercel ela já era proibida (1 salto fixo);
  no `node` o padrão é a rede do Caddy, e nenhum compose, workflow ou Dockerfile a define. Manter
  uma variável sem leitor convidaria a configurar o proxy errado. O `trustProxy` do `node` continua
  restrito a development e ci (guarda em `platform.ts`).
- **Request id por perfil:** o mapa `REQUEST_ID_HEADER` não tem mais o `null` do Render. O gerador
  do Fastify continua aceitando `null` (sempre um UUID próprio), coberto pelo teste dele.
- **Política do estático em `scripts/lib/static-site-policy.ts`.** Sem o plugin, nenhum código da
  API importava o `policy.ts`; quem o usa são os scripts da raiz (rotas da Vercel e snippets do
  Caddy) e o teste do idioma da raiz. Ficar em `apps/api/src` deixaria um arquivo da API que só os
  scripts leem (o knip o veria como sem uso no workspace da API). Os testes da política, antes no
  Vitest junto com o plugin, passam para `node:test` (`pnpm test:scripts`); o `documentFileFor`, que
  só o plugin usava, sai.
- **Error handler sem fallback de 404:** o parâmetro `notFoundFallback` só existia para o estático do
  Plano B; o 404 volta a ser sempre problem+json.
- **Specs:** só os requisitos que citam o Plano B ou o Render mudam; o comportamento na Vercel e no
  Caddy é o mesmo. A drenagem vira um requisito novo ("Drenagem do processo Node") porque o
  OpenSpec não renomeia o cenário de um requisito modificado.

Alternativas consideradas:

- Manter `TRUST_PROXY` como ajuste opcional do `node`: descartado, nenhum ambiente a usa e a rede do
  Caddy é fixa no compose.
- Deixar o `policy.ts` onde estava: descartado pelo motivo acima.

## Fontes Context7

- `/websites/vercel`: comportamento do Hobby ao estourar uma cota (o recurso para por cerca de 30
  dias; a equipe pausada só volta com ação do dono ou pelo suporte), base da consequência registrada
  na ADR 0038. Consultado em 2026-11-18.
- Nenhuma biblioteca nova nem versão alterada: a mudança só remove o `@fastify/static` 10.1.10.

## Risks / Trade-offs

- Sem Plano B, uma pausa da Vercel derruba web e API até o ciclo virar ou até migrar. A prevenção
  fica nos tetos da aplicação, no WAF e no `vercel-usage` com kill switch (F7).
- Passkeys continuam valendo por host; sem corte para outro host, o aviso de recadastro sai.
