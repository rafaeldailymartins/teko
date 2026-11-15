# Tasks

## 1. Transporte e fronteira

- [x] 1.1 `TekoChatTransport` (respostas síncronas sintetizadas, stream same-origin, sem resume)
- [x] 1.2 Data parts do chat (`src/lib/chat/parts.ts`), releitura de `GET /questions/:id`, feedback e cota
- [x] 1.3 Regra `noRestrictedGlobals` (`fetch(` só em `src/lib/api`) e teste de fronteira
- [x] 1.4 Cliente gerado com imports `.ts` (build do Turbopack)

## 2. Interface

- [x] 2.1 Thread e composer: bolha otimista, região viva, `aria-busy`, parar, atalhos, skeletons, `ErrorBoundary`
- [x] 2.2 Markdown com Streamdown, realce de código e `rehype-harden`; `CitationChip` com hover card
- [x] 2.3 Data de referência: chip, month picker, data exata, atalhos, `Alt+D`, inferida, esclarecimento, URL
- [x] 2.4 Cobertura, rótulos de degradação, cota e serviço pausado, recusa, feedback e sugestões
- [x] 2.5 Painel de citação com `[`/`]`, copiar, reportar e link para o dispositivo
- [x] 2.6 Carregamento sob demanda e medição do bundle

## 3. Fechamento

- [x] 3.1 Testes unitários (transporte, data parts, chip de data, PII, componentes) e e2e `chat.spec.ts`
- [x] 3.2 `frontend.md` e `status.md`
