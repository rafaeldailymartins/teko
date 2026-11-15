# Proposal

## Why

A F5 entrega o frontend completo, e as próximas mudanças (chat, autenticação, páginas legais)
precisam de uma base comum: componentes acessíveis, tokens de cor com contraste garantido, tema,
tipografia e um app shell com a navegação já resolvida. Sem isso, cada onda reinventaria botão,
diálogo e layout, e o contraste e o teclado ficariam por conta de cada uma.

## What Changes

- Design system: componentes do shadcn sobre Base UI copiados do registry `base-nova` para
  `apps/web/src/components/ui` (button, dialog, command, dropdown-menu, tooltip, sheet, drawer,
  resizable, scroll-area, kbd), utilitário `cn` em `src/lib/utils.ts` e animações do
  `tw-animate-css`. Só entram os componentes que esta mudança usa; os demais chegam com quem usa.
- Tokens OKLCH novos (`--muted`, `--popover`, `--input`, `--secondary`, `--destructive`, `--radius`)
  ao lado dos de domínio, todos cobertos pelo teste de contraste nos dois temas.
- Tema: seletor no cabeçalho (claro, escuro, igual ao sistema) sobre o script inline existente.
- Tipografia: Geist Mono entra ao lado de Geist e Source Serif 4, todas self-hosted no build.
- App shell (grupo de rotas `(app)`): cabeçalho com navegação, paleta `Ctrl/⌘+K`, idioma e tema;
  `<main>` com rolagem própria e o aviso fixo "Apoio à consulta; não constitui parecer".
- Área de trabalho do chat em três painéis redimensionáveis por teclado (histórico, conversa,
  citação); abaixo de 768 px o histórico vira Sheet e a citação vira Drawer.
- Páginas-esqueleto com título e estado vazio: chat, history, settings, provision, compare (no app
  shell) e coverage, about, privacy, terms, sign-in (com cabeçalho e rodapé do site).
- Landing revista: hero com demonstração estática, "Como funciona", corpus coberto, garantias e FAQ.
- `src/components/providers.tsx` como ponto único dos providers de cliente, montado no layout de
  locale dentro do `NextIntlClientProvider`.

## Capabilities

### New Capabilities

- `web-shell`: design system, tema, app shell, paleta de comandos, área de trabalho em três painéis,
  páginas-esqueleto e landing estática do `apps/web`.

## Impact

- `apps/web`: `src/components/{ui,app-shell,pages}`, `src/lib/{utils,hotkeys,navigation,theme}.ts`,
  `src/app/[locale]/**`, `globals.css`, `messages/*.json`, `vitest.config.ts`.
- Dependências novas no catálogo: `@base-ui/react`, `class-variance-authority`, `clsx`,
  `tailwind-merge`, `lucide-react`, `cmdk`, `react-resizable-panels`, `tw-animate-css` e
  `happy-dom` (testes).
- `.gitignore`, `biome.json` e `sonar-project.properties`: o padrão `coverage/` deixa de engolir a
  rota `src/app/[locale]/coverage/`.
- Docs: `docs/architecture/frontend.md` (estrutura com o grupo `(app)`, fontes e componentes).
