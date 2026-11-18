---

status: accepted
date: 2026-11-15
decision-makers: Rafael Daily Santos Martins
---

# 0035 — Front da F5: componentes copiados, CSP por documento e orçamento total

## Contexto e problema

A F5 entrega o front completo como export estático do Next na mesma origem da API (ADR 0029). O
desenho de [`frontend.md`](../architecture/frontend.md) deixava em aberto como trazer os componentes,
como fechar a CSP sem `'unsafe-inline'` nem `'unsafe-eval'`, como fazer o passkey sem o código de
servidor do Better Auth no web, quando carregar o PostHog e qual teto dar ao bundle. As respostas
saíram nos PRs #100 a #108 e valem para as próximas fases.

## Decisão

1. **Componentes do shadcn copiados do registry `base-nova` (Base UI), sem o CLI no lockfile.** Só
   entra no repositório o componente com uso real (o knip reprova arquivo morto). O Base UI roda com
   `CSPProvider disableStyleElements`; a regra que ele injetaria fica no `globals.css`.
2. **CSP por documento, gerada no build.** O `apps/web/scripts/postbuild.ts` calcula o sha256 de cada
   `<script>` e `<style>` inline do HTML exportado e grava um manifesto. A Vercel (rotas do
   `config.json`), o Plano B (`static-site.ts`) e o Caddy da stack de CI aplicam a mesma política,
   sem `'strict-dynamic'`, sem `'unsafe-eval'` e com Trusted Types em report-only. O build falha se
   um HTML ficar sem CSP ou se ela passar de 6 KB.
3. **Zod sem JIT no navegador.** O Zod 4 testa `new Function` ao construir o primeiro `z.object`, e a
   CSP barra o teste. O `src/instrumentation-client.ts` liga `z.config({ jitless: true })` antes de
   qualquer schema de `@teko/shared`.
4. **Passkey sem o cliente do Better Auth.** As rotas `/api/auth/*` passam pelo cliente gerado da API
   (`src/lib/api/auth.ts`), e a cerimônia WebAuthn usa o `@simplewebauthn/browser`, carregado só no
   clique (≈2,8 KiB gz, contra ≈15,5 KiB do cliente do Better Auth com o plugin). O Biome continua
   proibindo `better-auth` no web.
5. **Consentimento antes do PostHog, SDK na F6.** A F5 entrega o banner LGPD, as preferências e o
   adapter em `src/lib/analytics/` como único ponto que pode carregar o PostHog, hoje no-op. O
   `posthog-js` entra com a chave pública na F6 (`add-product-analytics`), por `import()` depois do
   aceite.
6. **Orçamento de bundle total de 500 KiB gz** (decisão do mantenedor em 2026-11-15), medido como a
   união dos chunks de primeiro acesso de todas as páginas do export. O teto provisório de 400 KiB da
   onda 1 não comportava shell, histórico, autenticação e chat juntos. O código do chat (AI SDK,
   Streamdown, Shiki) e o das configurações ficam fora do primeiro acesso, por `import()`.

## Consequências

- Atualizar um componente do shadcn é copiar de novo do registry e revisar o diff à mão.
- Script inline novo ganha CSP sozinho no próximo build; script injetado em runtime é barrado, e o e2e
  de cada jornada confere as violações aplicadas.
- O Zod do navegador usa só o parser interpretado, um pouco mais lento, sem efeito perceptível nos
  payloads do Tekó.
- A troca de chunks do Turbopack pesa no orçamento total mesmo quando o código novo é lazy; a medição
  fica registrada no `bundle-budget.json` e no `frontend.md`.
- A política de privacidade diz que medição e pesquisas ainda não estão ligadas; a F6 atualiza o texto
  e a `PRIVACY_POLICY_VERSION` junto com o SDK.

## Revisão (2026-11-18): sem Plano B ([ADR 0039](0039-sem-plano-b-no-render.md))

A política do estático vale na Vercel e no Caddy da stack de CI; o Plano B (`static-site.ts`) saiu.
