# Proposal

## Why

O mantenedor quer o front do Tekó com cara de produto profissional: a logo e as cores dela em todo
o site, nenhum aviso de "em construção", a raiz sem tela de escolha de idioma, um menu de idioma
como o de tema e o "Abrir o Tekó" sem mostrar o app e pular para o login. Esta é a fundação visual
do redesign (onda 1): as ondas seguintes (landing com demonstração animada, login com e-mail e
senha, telas internas) usam os tokens e os componentes daqui, sem paletas próprias.

## What Changes

- Tokens de cor tirados da logo nos dois temas: petróleo `#005766` → `#003540` na marca e na
  primária, verde-folha `#38a37a` → `#7fd8c8` no vigente e nos detalhes vivos, âmbar `#e0a53b` só na
  data; neutros puxados para o petróleo e o tema escuro em petróleo muito escuro. Tokens novos de
  marca (`--brand`, `--brand-deep`, `--brand-foreground`, `--leaf`, `--leaf-soft`, `--date-mark`),
  sombras em camadas (`shadow-soft`, `shadow-raised`, `shadow-overlay`), gradientes sutis
  (`bg-brand-gradient`, `bg-leaf-gradient`, `bg-surface-gradient`, `bg-brand-glow`, `timeline-rule`),
  raio de 0,75 rem e `prefers-reduced-motion` global. O teste de contraste ganha os pares novos.
- Logo no código: `TekoLogo` (selo e ícone compacto, SVG inline) e `TekoWordmark`; favicon, ícone da
  Apple e imagem do Open Graph gerados da logo (`scripts/brand-assets.ts`); `theme-color` dos dois
  temas igual ao fundo.
- Cabeçalho e rodapé do site redesenhados (navegação com a página atual, menu do celular, chamada
  "Abrir o Tekó" no gradiente da marca, rodapé com produto, projeto e legal) e o cabeçalho do app
  (marca, abas, busca da paleta, idioma, tema e conta). Os componentes de `src/components/ui`
  ganham o acabamento novo (foco em anel sólido, sombras, cantos), e entram `Card` e a variante
  `brand` do botão.
- Menu de idioma (`LanguageMenu`) com ícone, os idiomas pelo nome nativo, que mantém a página, a
  query e a âncora; nos cabeçalhos e nas configurações.
- Raiz sem tela de idioma: em `next dev`, redirects por `Accept-Language` com a regra de produção;
  a página estática de `/` vira uma tela neutra com a logo que vai na hora para o idioma do
  navegador, com os links só no `<noscript>`.
- `SessionGate` em volta do shell: tela da marca enquanto o `GET /me` carrega (também no HTML
  estático), direto para a entrada sem sessão e "Tentar de novo" com o `/me` indisponível.
- Fim dos avisos de "em construção" nos catálogos e na landing.

## Capabilities

### Modified Capabilities

- `web-shell`: tokens da marca, identidade visual (logo, ícones, metadados), cabeçalhos, guarda de
  sessão sem flash e a troca de idioma no app shell.
- `web-i18n`: menu de idioma que mantém a página, a query e a âncora.
- `web-build`: a raiz sem tela de idioma em desenvolvimento e na página estática de entrada.

## Impact

- `apps/web`: `src/app/globals.css`, `src/components/{brand,ui,app-shell}`, `site-header`,
  `site-footer`, `site-nav`, `language-menu`, `locale-gateway`, `locale-layout`,
  `src/components/auth/session-gate.tsx`, `src/lib/{navigation,site,utils}.ts`,
  `src/lib/i18n/root-locale.ts`, `next.config.ts`, `public/` (ícones, Open Graph, script da raiz),
  `scripts/brand-assets.ts`, `messages/*.json` e os testes e e2e correspondentes.
- `scripts/root-locale.test.ts` prende a regra da raiz do web à do `policy.ts` da API.
- `docs/architecture/frontend.md` (Design system).
