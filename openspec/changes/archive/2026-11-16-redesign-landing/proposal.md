# Proposal

## Why

A fundação visual do redesign (onda 1) deixou a landing correta, mas genérica: o hero sem impacto e
as seções como grades de cartões iguais. O mantenedor pediu, no lugar de texto explicando, um
exemplo visual de como o Tekó funciona: uma animação em que um usuário digita uma pergunta e recebe a
resposta com data de referência, citações e vigência. As páginas públicas (sobre, cobertura,
privacidade, termos e 404) precisam ficar no mesmo nível.

## What Changes

- Hero novo: manchete em serif com "na sua data" sublinhado pelo fio da linha do tempo, o glow da
  marca, a chamada "Abrir o Tekó" no botão `brand` e a de cobertura, e, atravessando o hero, a linha
  do tempo do RCTE, art. 76, § 6º (redações, revogação e o ponto âmbar da data).
- Demonstração animada do chat, estática e sem API, com o caso real do RCTE, art. 76, § 6º: a
  pergunta digitada caractere a caractere, o chip 05/2008, a resposta em stream com o cabeçalho de
  data e vigência, a citação numerada e o intervalo em verde-folha; depois a mesma pergunta em
  01/2010, com a revogação. Loop com pausas, parado fora da tela e com a aba oculta, botão de pausa,
  quadro final com movimento reduzido e no HTML estático, animação `aria-hidden` com resumo para
  leitor de tela.
- Seções com layouts próprios: "Como funciona" como linha do tempo de três passos, o corpus numa
  régua de 1990 a hoje com ícone e jurisdição por família, garantias em composição assimétrica, FAQ
  em acordeão de `<details>` (um aberto por vez) e a faixa final no gradiente da marca.
- Páginas de texto longo (privacidade, termos e sobre) em tipografia editorial: cabeçalho com
  sobretítulo, versão com o ponto âmbar, sumário fixo no desktop, marca por seção (`§ 1`, `01`). O
  texto jurídico não muda. Cobertura com o mesmo cabeçalho e cartões em duas colunas; 404 com a
  linha do tempo "fora da data".
- `bg-surface-gradient` passa a misturar em `oklab` (em `oklch`, dois neutros davam matiz `none` e
  um tom rosado no Chromium).

## Capabilities

### New Capabilities

- `web-landing`: a landing (hero, demonstração animada e seções) e a apresentação das páginas
  públicas de texto longo.

## Impact

- `apps/web`: `src/components/landing/` (hero, seções e a demonstração), `landing-page.tsx`,
  `pages/legal-pages.tsx`, `pages/coverage-page.tsx`, `coverage/coverage-view.tsx`,
  `not-found-page.tsx`, `src/lib/landing/` (roteiro, player, caso e régua), `globals.css`,
  `messages/*.json`, `vitest.config.ts` e os e2e `landing.spec.ts`, `a11y.spec.ts` e `legal.spec.ts`.
- Bundle: a demonstração é o único componente de cliente novo da landing (medição no `design.md`).
