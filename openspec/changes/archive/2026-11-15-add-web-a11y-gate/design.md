# Design

## Context

As ondas 1 e 2 da F5 deixaram todas as telas do web na `main` (PRs #100 a #106), com o contraste dos
tokens testado em unitário (`src/app/tokens.test.ts`) e as jornadas e2e na stack de CI. Faltava o
axe, que o DoD da F5 pede, e o registro que liga cada item do DoD à prova. Esta mudança é a da onda 3
que fecha a acessibilidade; a outra (cobertura, linha do tempo no painel de citação e helpers de
data) corre em paralelo e não toca os mesmos arquivos.

Documentação consultada pelo Context7: `/dequelabs/axe-core-npm` (`AxeBuilder`, `withTags`,
`exclude`, `disableRules`, `analyze`) e `/dequelabs/axe-core/v4.14.0` (tags `wcag2a` a `wcag22aa`,
regra `target-size` só com `wcag22aa`, `color-contrast` com resultados `incomplete`).

## Decisions

- **`@axe-core/playwright` no e2e, sem `axe-core` em happy-dom.** O axe roda no Chromium de verdade,
  com o CSS aplicado, os dois temas e os viewports do Playwright: contraste, alvo de toque e
  visibilidade só fazem sentido com layout. No happy-dom não há layout, e o contraste e o 2.5.8 sairiam
  como `incomplete`. O `AxeBuilder` injeta o axe pelo protocolo do navegador, fora da CSP da página
  (sem `'unsafe-eval'` nem script inline).
- **Matriz completa por teste.** Um `describe` por idioma e tema (`test.use({ locale, colorScheme })`
  e `localStorage['teko-theme']` gravado antes do script de tema, como o seletor faz), um teste por
  rota, e os projetos `chromium` e `mobile` do `playwright.config.ts` multiplicam por dois: 14 testes
  por combinação, 112 no total. Cada teste espera a rede parar, o `h1`, as fontes e o fim das
  animações (`document.getAnimations()`) antes do axe, para o contraste não pegar um popup no meio da
  transição.
- **Rotas.** Landing, entrada, chat vazio, histórico, dispositivo (`?k=` do RCTE, art. 76, § 6º, em
  05/2008), comparação (05/2008 contra 01/2010), configurações, privacidade, termos, sobre, cobertura,
  404, o chat com uma resposta (axe com a resposta e de novo com o painel de citação aberto, o Drawer
  no celular) e a primeira visita (o banner LGPD e, de novo, as preferências abertas). As do grupo
  `(app)` entram com `signInWithTestSession`.
- **Exceção só por seletor.** A lista `EXCEPTIONS` (seletor e motivo) vira `exclude()`; não há
  `disableRules`. Hoje ela está vazia.
- **Relatório.** Na falha, o teste grava as violações completas do axe em
  `testInfo.outputPath('axe-<n>.json')` e as anexa; a mensagem do `expect` traz regra, impacto e HTML
  de cada nó. O `e2e.yml` já publica `apps/web/test-results` como artifact na falha, então o
  workflow não muda.
- **Verificação local sem a stack.** A stack de CI é compartilhada entre os agentes da máquina. O
  `a11y.spec.ts` rodou localmente contra o export servido com a CSP do manifesto e uma API simulada
  mínima (fora do repositório), com os dados dos contratos (`/me`, cota, passkeys, conversas,
  cobertura, linha do tempo, diff e uma pergunta respondida na hora). O job `e2e` do PR confirma na
  stack real, com o stream e o LLM fake.
- **Correções.** O axe achou uma regra, em todas as rotas do grupo `(app)`:
  `label-content-name-mismatch` (WCAG 2.5.3) no botão da conta, que mostrava as iniciais e tinha o
  `aria-label` "Conta de {nome}". As iniciais passam a abrir o nome acessível, com o rótulo em
  `sr-only` ("AS Conta de Ana Souza"). E o chat com conversa ficava sem `h1` (o título era o do
  estado vazio); entra um `h1` visualmente oculto com o título da página. Contraste, `target-size`,
  landmarks, nomes de botões e `aria-*` passaram sem mudança nos dois temas.
- **Registro do DoD.** `docs/evals/dod-f5-2026-11-15.md` lista cada item do DoD com o teste, gate ou
  job, agrupa os 42 testes de interface dos specs em sete jornadas de usuário (sem apagar testes) e
  registra o bundle medido no build.

## Risks / Trade-offs

- **Cota e stream da sessão compartilhada.** A pergunta do teste do chat é a mesma do `chat.spec.ts`
  em 05/2008, para cair no cache de respostas depois da primeira (acerto do cache não consome a cota
  nem abre stream). Um `stream_busy` eventual entre workers fica com os retries do CI.
- **Tempo do job.** 112 testes a mais, cerca de 1 s cada no Chromium; o job `e2e` tem 30 minutos.
