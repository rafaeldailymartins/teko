# Proposal

## Why

A F6 liga a observabilidade. A F5 deixou o consentimento LGPD e um adapter de analytics com cliente
no-op; falta o SDK do PostHog, os eventos do catálogo de `@teko/shared/analytics` emitidos nos
pontos certos do web e a política de privacidade que hoje diz que a medição "ainda não está ligada".
O roteiro (F6, "SDK do PostHog") pede o SDK, o texto de `/privacy` e a nova
`PRIVACY_POLICY_VERSION` no mesmo PR.

## What Changes

- `posthog-js` 1.447.3 no catálogo, carregado só por `import()` depois do consentimento
  `analytics: true` e com `NEXT_PUBLIC_POSTHOG_KEY` no build. Entrada `dist/module.no-external` com
  as pesquisas no bundle (`dist/surveys`), host da UE, `disable_external_dependency_loading`,
  `cookieless_mode: 'on_reject'`, `person_profiles: 'identified_only'`, persistência só em
  `localStorage`, replay, autocapture, pageview e exceções desligados.
- Cliente em `src/lib/analytics/posthog-client.ts`: valida cada evento pelo schema estrito do
  catálogo antes do `capture`, e um `before_send` deixa sair só o catálogo e os eventos das
  pesquisas, sem query nem âncora nas URLs. Retirar o consentimento faz o opt-out, corta o envio e
  apaga do navegador o que o PostHog gravou.
- Os 13 eventos do catálogo emitidos no web (chat, painel de citação, diff, feedback, cota,
  idioma, consentimento e Web Vitals pelo `useReportWebVitals`, num chunk carregado só com o
  analytics ligado). Sem `identify`.
- CSP: `connect-src` ganha `https://eu-assets.i.posthog.com`, de onde o SDK lê a configuração
  remota do projeto (a Vercel, o Plano B e o Caddy da stack de CI usam o mesmo manifesto).
- `/privacy` reescrita para a F6 inteira de uma vez (PostHog para produto e erros, Langfuse e
  Grafana Cloud), com bases legais e retenções dos planos gratuitos; banner no presente.
  `PRIVACY_POLICY_VERSION` vai para `2026-11-17`, o que pede a escolha de novo. `ropa.md`
  atualizado.
- A stack de CI builda com uma chave fictícia, e o e2e de consentimento prova, com os hosts do
  PostHog interceptados, que depois do aceite só a UE é chamada, sem cookie, e que retirar o
  consentimento limpa o storage.

## Capabilities

### New Capabilities

- `web-analytics`: o cliente do PostHog, o filtro de envio e os eventos de produto emitidos pelo web.

### Modified Capabilities

- `web-consent`: o adapter passa a carregar o SDK de verdade, e retirar o consentimento limpa o
  navegador.
- `web-build`: `connect-src` com os dois hosts do PostHog na UE.
- `web-i18n`: a política de privacidade passa a cobrir os operadores de observabilidade.

## Impact

- `apps/web`: `src/lib/analytics/*`, `src/components/{chat,consent,provision}/*`,
  `language-menu.tsx`, `scripts/lib/csp.ts`, `messages/*.json`, `e2e/consent.spec.ts`.
- `packages/shared`: `PRIVACY_POLICY_VERSION`.
- `infra/ci/up.sh`: build do web com chave fictícia.
- Dependência nova: `posthog-js` (Apache-2.0 AND MIT, com proveniência SLSA) e, por ele, `core-js`
  (build script recusado em `allowBuilds`), `preact`, `dompurify`, `fflate`, `web-vitals` e
  `@posthog/*`. Fora do first-load.
- Docs: `docs/architecture/{frontend,observabilidade,qualidade-e-seguranca}.md` e
  `docs/privacy/ropa.md`.
