# Proposal

## Why

A F5 precisa abrir o serviço com textos legais reais e com o consentimento LGPD resolvido antes de
qualquer analytics: o DoD exige zero cookies e zero chaves do PostHog no storage antes da escolha.
As páginas `/privacy`, `/terms` e `/about` ainda são esqueletos, a versão dos Termos existe só na
API e o i18n não tem formatação de datas nem regra para os trechos em português na UI em inglês.

## What Changes

- Páginas legais com conteúdo real em pt-BR e en: `/privacy` coerente com o `docs/privacy/ropa.md`,
  `/terms` com a versão em vigor e `/about`. Texto em Source Serif, sumário com âncoras, termos em
  português com `lang="pt-BR"` também na página em inglês. Namespaces `legal` e `about`, renderizados
  só no servidor e fora das mensagens do cliente.
- `TERMS_VERSION` e `PRIVACY_POLICY_VERSION` em `@teko/shared/legal`, sem dependência de runtime. O
  padrão do `TERMS_VERSION` da API passa a ser a mesma constante que a web exibe.
- Consentimento LGPD: banner com Aceitar, Recusar e Personalizar de mesmo peso, preferências por
  categoria (medição de uso e pesquisas) em `localStorage['teko-consent']` com a versão da política,
  e o link "Preferências de cookies" nos rodapés para reabrir. Namespace `consent`.
- Adapter de analytics em `src/lib/analytics/`, o único caminho até o SDK: só carrega com
  `analytics: true` e com `NEXT_PUBLIC_POSTHOG_KEY` no build, por `import()`. Na F5 o cliente é no-op;
  o `posthog-js` entra na F6 (`add-product-analytics`). O Biome barra o SDK fora do adapter.
- i18n transversal: paridade de chaves com diff de faltando e sobrando em todos os namespaces e das
  tags de rich text, helper de formatação de datas e períodos de apuração por locale
  (`src/lib/i18n/format.ts`), fuso `America/Sao_Paulo` testado e revisão das strings em inglês.
- E2E `consent.spec.ts` e `legal.spec.ts`; o estado inicial das demais jornadas já traz a escolha
  feita, para o banner não cobrir o que elas clicam.

## Capabilities

### New Capabilities

- `web-i18n`: idiomas, paridade dos catálogos, formatação de datas e páginas legais do `apps/web`.
- `web-consent`: consentimento LGPD no navegador e o adapter que controla o carregamento do
  analytics.

## Impact

- `apps/web`: `src/lib/{consent,analytics,i18n,env.ts,legal-documents.ts}`,
  `src/components/{consent,ui/switch.tsx,pages/legal-pages.tsx}`, `providers.tsx`,
  `locale-layout.tsx`, rodapés, `messages/*.json`, `biome.json`, `playwright.config.ts` e `e2e/`.
- `packages/shared`: subpath `./legal`.
- `apps/api`: `DEFAULT_TERMS_VERSION` vem de `@teko/shared/legal` (mesmo valor).
- Docs: `docs/architecture/frontend.md`, `docs/privacy/ropa.md` e `docs/status.md`.
- Sem dependência nova.
