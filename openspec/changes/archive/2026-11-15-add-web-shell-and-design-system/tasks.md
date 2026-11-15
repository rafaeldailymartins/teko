# Tasks

## 1. Design system

- [x] 1.1 Dependências pelo catálogo (Base UI, cva, clsx, tailwind-merge, lucide-react, cmdk, react-resizable-panels, tw-animate-css, happy-dom)
- [x] 1.2 `cn` em `src/lib/utils.ts` e componentes do registry `base-nova` em `src/components/ui`
- [x] 1.3 Tokens OKLCH novos e o teste de contraste cobrindo-os nos dois temas
- [x] 1.4 Geist Mono ao lado de Geist e Source Serif 4 (self-hosted no build)
- [x] 1.5 `CSPProvider` sem `<style>` em runtime e a regra da scroll area em `globals.css`

## 2. Tema e navegação

- [x] 2.1 `applyThemePreference`, `readThemePreference` e `subscribeThemePreference` com testes
- [x] 2.2 Seletor de tema no cabeçalho do app e do site
- [x] 2.3 Troca de idioma que mantém a página (`switchLocalePath`)
- [x] 2.4 Paleta `Ctrl/⌘+K` com navegação e tema

## 3. App shell e páginas

- [x] 3.1 Layout do grupo `(app)` com cabeçalho, `<main>` e aviso fixo
- [x] 3.2 `Workspace` em três painéis com Sheet e Drawer abaixo de 768 px
- [x] 3.3 Páginas-esqueleto dos dois locales com metadata e estado vazio
- [x] 3.4 `providers.tsx` e `NextIntlClientProvider` no layout de locale
- [x] 3.5 Landing com hero, como funciona, corpus, garantias e FAQ
- [x] 3.6 `.gitignore`, `biome.json` e Sonar sem engolir a rota `/coverage/`

## 4. Testes e documentação

- [x] 4.1 Testes unitários dos utilitários e testes de componente em happy-dom
- [x] 4.2 E2E do app shell (paleta, painéis, tema, páginas nos dois locales)
- [x] 4.3 `docs/architecture/frontend.md` e `docs/status.md`
