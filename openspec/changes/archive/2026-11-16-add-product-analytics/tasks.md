# Tasks

## 1. SDK e cliente

- [x] 1.1 `posthog-js` 1.447.3 no catálogo (licença, idade e proveniência conferidas) e o build script do `core-js` recusado
- [x] 1.2 `posthog-hosts.ts`, `posthog-config.ts` (configuração, `before_send`, limpeza do storage) e `posthog-client.ts`
- [x] 1.3 `client-loader.ts` com `import('./posthog-client.ts')`, fora do first-load

## 2. Eventos

- [x] 2.1 Mapeamento puro dos eventos do chat (`chat-events.ts`) e das Web Vitals (`web-vitals.ts`)
- [x] 2.2 Emissão no chat, no painel de citação, no diff, no feedback, no menu de idioma e no consentimento
- [x] 2.3 `useReportWebVitals` num chunk carregado só com o analytics ligado

## 3. CSP e build

- [x] 3.1 `connect-src` com os dois hosts da UE, lidos de `posthog-hosts.ts`
- [x] 3.2 Orçamento de bundle medido (461,1 KiB gz; SDK em chunk sob demanda)

## 4. Privacidade

- [x] 4.1 `/privacy` reescrita para a F6 nos dois locales e banner no presente
- [x] 4.2 `PRIVACY_POLICY_VERSION` `2026-11-17`
- [x] 4.3 `docs/privacy/ropa.md`

## 5. Testes e documentação

- [x] 5.1 Unitários do carregador, do cliente, da configuração, do mapeamento de eventos e da política
- [x] 5.2 Stack de CI com chave fictícia e o e2e de consentimento com os hosts da UE interceptados
- [x] 5.3 `frontend.md`, `observabilidade.md` e `qualidade-e-seguranca.md`
