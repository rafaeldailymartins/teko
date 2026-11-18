# Proposal

## Why

No lockdown da guarda de uso (95% de uma cota da Vercel Hobby), a regra 1 do WAF passa ao payload
`lockdown` de `infra/vercel/firewall-rules.json`, que hoje nega (403) tudo exceto `/healthz`,
`/api/healthz`, a "página de aviso", `/_next/static/*` e `/favicon.ico`. A página de aviso nunca
foi criada: `/aviso/` responde 404, e quem abre o Tekó vê um 403 cru da borda, sem saber o que
houve. O mantenedor decidiu em 2026-11-18 criar a página e trocar a ação do lockdown de `deny` para
um redirect temporário até ela.

## What Changes

- **Página de aviso:** `apps/web/src/app/aviso/page.tsx`, fora de locale, nos dois idiomas lado a
  lado (cada trecho com `lang`), no padrão do 404 global. Diz que o Tekó está pausado porque o uso
  do mês chegou perto da cota gratuita da hospedagem, que volta quando a cota se renovar e que não
  há nada a fazer. Sem sessão, sem chamada à API, sem JavaScript próprio além do bootstrap de tema,
  `noindex` e título nos dois idiomas. Chaves novas no namespace `lockdown` dos dois catálogos.
- **Build:** `scripts/build-vercel-output.ts` exige `aviso/index.html` no export
  (`REQUIRED_STATIC_FILES`); a CSP do documento vem do manifesto de headers, como nas outras
  páginas.
- **WAF:** o payload `lockdown` dos dois projetos passa a `redirect` para `/aviso/` com
  `permanent: false` (307), e a exceção da página fica só na raiz (`aviso(?:/.*)?`, sem as variantes
  de locale, que não existem). `scripts/vercel-firewall.ts` recusa um lockdown que não redirecione
  para `/aviso/` de forma temporária.
- **Docs:** runbook `budget-kill-switch.md` (95% e o exercício no staging), `infra/vercel/README.md`,
  `contas-e-cotas.md`, `frontend.md`, os runbooks que citam o lockdown e a nota do painel do Grafana.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `deployment`: o lockdown versionado redireciona para `/aviso/` em vez de negar.
- `web-build`: requisito novo da página de aviso do lockdown, exigida no export.

## Impact

- `apps/web`: página `src/app/aviso/page.tsx`, componente
  `src/components/locale-gateway/lockdown-notice-page.tsx`, catálogos `messages/*.json`, testes de
  unidade e o axe da página no `e2e/a11y.spec.ts`.
- `scripts/`: `build-vercel-output.ts`, `vercel-firewall.ts` e os testes deles.
- `infra/vercel/firewall-rules.json` (os dois projetos) e a nota do painel `vercel-hobby.json`.
- Docs: runbooks, `infra/vercel/README.md`, `docs/architecture/contas-e-cotas.md` e
  `docs/architecture/frontend.md`.
- Nenhuma dependência nova. O efeito na Vercel só aparece no próximo `--lockdown on`; o deploy não
  aplica o payload de lockdown.
