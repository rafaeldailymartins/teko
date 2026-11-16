# Proposal

## Why

O DoD da F5 pede "axe zero nas rotas principais, en/pt-BR, claro/escuro, desktop/mobile", e nenhum
teste roda o axe hoje: o contraste dos tokens tem teste unitário, mas nomes acessíveis, landmarks,
`aria-*` e o alvo de toque do 2.5.8 só eram conferidos à mão. Falta também o registro que diz onde
cada item do DoD da F5 é provado.

## What Changes

- `apps/web/e2e/a11y.spec.ts` com o `@axe-core/playwright` nas regras WCAG 2.2 AA (`wcag2a`,
  `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`), na stack de CI: landing, entrada, chat vazio e com
  uma resposta e o painel de citação aberto, histórico, dispositivo, comparação, configurações,
  privacidade, termos, sobre, cobertura, 404 e o banner de consentimento com as preferências. Cada
  rota em en e pt-BR, tema claro e escuro, nos projetos desktop e mobile. Exceção só por seletor e
  com motivo; na falha, as violações vão em arquivo para o artifact de traces do job `e2e`.
- Correções do que o axe achou: o botão da conta mostrava as iniciais com um `aria-label` que não as
  continha (WCAG 2.5.3, `label-content-name-mismatch`); o chat com conversa ficava sem `h1`.
- Registro `docs/evals/dod-f5-2026-11-15.md`: cada item do DoD da F5 com o teste, gate ou job que o
  prova, as jornadas de interface agrupadas e o bundle medido.

## Capabilities

### New Capabilities

- `web-a11y`: o gate de acessibilidade do `apps/web` (axe nas rotas principais) e o critério de
  exceção.

## Impact

- `apps/web`: `e2e/a11y.spec.ts`, `src/components/auth/user-menu.tsx` (e o teste),
  `src/components/chat/chat-session.tsx`, `package.json`.
- Dependência nova de desenvolvimento: `@axe-core/playwright` 4.14.0 (MPL-2.0, com proveniência),
  que traz o `axe-core` 4.14.0 (MPL-2.0, com proveniência).
- Docs: `docs/evals/dod-f5-2026-11-15.md`, `docs/architecture/frontend.md`, `docs/status.md`.
