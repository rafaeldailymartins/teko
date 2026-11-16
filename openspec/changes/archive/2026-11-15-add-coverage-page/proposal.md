# Proposal

## Why

A onda 3 fecha a F5. A página `/[locale]/coverage/` ainda é o último esqueleto
(`placeholder-pages.tsx`), embora a API já sirva a cobertura efetiva por família em
`GET /api/v1/coverage` (pública). O painel de citação do chat só leva à página de dispositivo para
ver a linha do tempo e o "O que mudou", que o desenho do front pede dentro do próprio painel, com os
mesmos componentes da página de dispositivo. E as ondas anteriores deixaram três formatadores de data
de calendário (`calendarDate` em `lib/validity.ts`, `lib/chat/format.ts` e `lib/i18n/format.ts`).

## What Changes

- Página de cobertura pública (fora do grupo `(app)`, sem sessão): por jurisdição e família, as
  fontes, os períodos cobertos, as lacunas entre eles e a última verificação, com uma barra
  proporcional numa escala comum (tokens `--validity-current` e `--coverage-out`), mais
  carregamento, erro com nova tentativa e vazio. `placeholder-pages.tsx` deixa de existir.
- Painel de citação com `ProvisionTimeline` (redação vigente na data de referência da resposta
  marcada) e "O que mudou" (`ProvisionDiff`, código e consulta só no clique), mantendo o link para a
  página do dispositivo, agora "Abrir o dispositivo".
- Um helper de datas só, em `src/lib/i18n/format.ts` (estilo `numeric`, limites de vigência e nome do
  mês), com os usos trocados e as duplicatas apagadas, sem mudar o texto das telas.
- Testes unitários da página, da costura do painel e do helper; e2e `coverage.spec.ts` e a linha do
  tempo no painel ao fim da jornada do DoD em `chat.spec.ts`.

## Capabilities

### New Capabilities

- `web-coverage`: página pública da cobertura do corpus.

### Modified Capabilities

- `web-chat`: o painel de citação traz a linha do tempo e o "O que mudou" do dispositivo.

## Impact

- `apps/web`: `components/coverage/`, `components/pages/coverage-page.tsx`, a rota de coverage,
  `lib/coverage.ts`, `components/chat/citation-panel.tsx` e `citation-timeline.tsx`,
  `components/provision/provision-timeline.tsx` (`aria-current` também na lista sem escolha),
  `components/query-error.tsx` (o erro com "tentar de novo", também usado pelo `ProvisionDiff`),
  `lib/i18n/format.ts`, `lib/validity.ts`, os componentes de chat, histórico e dispositivo que
  formatavam datas, mensagens (`coverage`, `pages.coverage`, `chat.citation.openProvision`) e os e2e
  `coverage.spec.ts` e `chat.spec.ts`.
- Docs: `frontend.md` e `status.md`. Sem mudança de API nem de dependência.
