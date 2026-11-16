# Tasks

## 1. Tokens e marca

- [x] 1.1 Paleta da logo em OKLCH nos dois temas, tokens de marca, sombras, gradientes e raio
- [x] 1.2 Pares novos no teste de contraste, sem relaxar os limiares
- [x] 1.3 `TekoLogo` (selo e ícone compacto) e `TekoWordmark`
- [x] 1.4 Favicon, ícone da Apple e Open Graph gerados da logo; `theme-color` dos dois temas
- [x] 1.5 `prefers-reduced-motion` global e o tailwind-merge com os tokens do tema

## 2. Componentes e cabeçalhos

- [x] 2.1 Acabamento novo em `src/components/ui` (botão `brand`, foco, sombras), `Card` e `Badge` folha
- [x] 2.2 Cabeçalho, menu do celular e rodapé do site
- [x] 2.3 Cabeçalho do app shell, rodapé com o aviso e painéis com a linguagem nova
- [x] 2.4 Menu de idioma nos cabeçalhos e nas configurações, com a página, a query e a âncora

## 3. Plataforma

- [x] 3.1 Redirect da raiz por `Accept-Language` em `next dev`, com a regra de produção e o teste que prende as duas
- [x] 3.2 Entrada `/` estática sem escolha de idioma (script externo, `<noscript>`)
- [x] 3.3 `SessionGate` em volta do shell: tela da marca até saber a sessão, inclusive no HTML estático
- [x] 3.4 Avisos de "em construção" removidos

## 4. Testes e documentação

- [x] 4.1 Unitários do menu de idioma, do redirect da raiz, do script da entrada, da guarda e da marca
- [x] 4.2 E2E (`brand-shell.spec.ts`) e `shell.spec.ts` ajustado ao menu de idioma
- [x] 4.3 `docs/architecture/frontend.md` (Design system) com a paleta nova
