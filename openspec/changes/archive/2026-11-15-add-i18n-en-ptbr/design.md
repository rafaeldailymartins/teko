# Design

## Context

A onda 1 da F5 deixou o design system, o app shell, a camada de dados e a CSP por documento. As
páginas legais eram esqueletos, a versão dos Termos vivia só no `env.ts` da API e não havia camada
de consentimento. Quatro agentes trabalham em paralelo na onda 2; esta mudança fica com i18n,
páginas legais e consentimento (namespaces `legal`, `about` e `consent`).

Documentação consultada pelo Context7: `/amannn/next-intl` (rich text com `t.rich`, `useFormatter`
e `createFormatter`, `timeZone` global), `/websites/posthog` (`cookieless_mode: 'on_reject'`,
`opt_in_capturing` e `opt_out_capturing`, o que é gravado antes do consentimento), `/posthog/posthog-js`
e `/mui/base-ui` (Switch: rótulo, `checked` e `onCheckedChange`).

## Decisions

- **O `posthog-js` não entra na F5.** A camada de consentimento e o adapter entram agora; o SDK fica
  para a F6 (`add-product-analytics`), que é onde o roteiro e o `ropa.md` põem o PostHog. Motivos: sem
  a chave do projeto (criada na F7) o SDK nunca carregaria, então seria código morto no lockfile
  (licença `Apache-2.0 AND MIT` e dez dependências diretas, como `core-js`, `preact` e `dompurify`);
  a política de privacidade teria de descrever uma coleta que não acontece; e a F6 precisa decidir
  junto o Error Tracking e o destino dos relatórios de CSP. O DoD ("antes do consentimento, zero
  cookies e zero chaves do PostHog") é verificável já: o e2e confere storage, cookies e rede.
- **Adapter como ponto único.** `src/lib/analytics/adapter.ts` só chama o carregador com a escolha
  `analytics: true` **e** a chave pública (`NEXT_PUBLIC_POSTHOG_KEY`, lida só em `src/lib/env.ts`,
  pela regra do Semgrep). Sem a chave, nada carrega nem com aceite: o staging, o CI e o
  desenvolvimento ficam sem PostHog porque não recebem a chave. Evento sem cliente é descartado (sem
  fila). Recusar depois de aceitar chama `disable()`, que na F6 vira `opt_out_capturing` e a limpeza
  do storage; uma recusa durante o carregamento desliga o cliente que chega. O carregador da F5
  devolve um cliente no-op; a F6 troca o corpo por `import('./posthog-client.ts')` com EU,
  `disable_external_dependency_loading: true`, `cookieless_mode: 'on_reject'`,
  `person_profiles: 'identified_only'` e replay desligado. O `import()` mantém o SDK fora do
  first-load. O Biome barra `posthog-js` e `@posthog/**` fora de `src/lib/analytics/**` (teste em
  `test/biome-boundary.test.ts`).
- **Escolha em `localStorage`, gravada só depois da decisão.** Chave `teko-consent` com
  `policyVersion`, `decidedAt` e as categorias. Valor de outra versão da política, malformado ou
  com categoria faltando vale "sem escolha", e o banner volta. Storage bloqueado: a escolha vale
  para a página atual (estado em memória) e o banner não volta a cada clique. Leitura por
  `useSyncExternalStore` com o valor cru como snapshot (estável), igual ao tema; o HTML estático sai
  sem banner (o servidor não conhece o storage), que aparece depois da hidratação, fixo no rodapé
  da janela e sem deslocar o layout.
- **Mesmo peso, sem dark pattern.** Os três botões do banner têm a mesma variante (`outline`) e o
  mesmo tamanho; nas preferências, as categorias começam desligadas e "Recusar tudo", "Salvar
  escolhas" e "Aceitar tudo" também têm o mesmo peso. O link "Preferências de cookies" fica no
  rodapé do site e no do app shell.
- **`TERMS_VERSION` em `@teko/shared/legal`.** Um subpath novo, sem Zod, para a web exibir a versão
  sem levar os schemas dos contratos. A API usa a constante como padrão do `TERMS_VERSION` (o valor
  não muda: `2026-11-14`). `PRIVACY_POLICY_VERSION` (`2026-11-15`) mora junto e vai na escolha de
  consentimento.
- **Texto longo só no servidor.** `legal` e `about` saem das mensagens que o
  `NextIntlClientProvider` serializa em toda página (`clientMessages`), senão cada HTML levaria
  dezenas de KB de texto legal. Os blocos (`<p>`, `<ul>`, `<li>`) e os links ficam no catálogo como
  tags de rich text, para o tradutor controlar a estrutura; a lista de tags é tipada e testada, e as
  seções de cada documento seguem uma lista na ordem do sumário, conferida contra o catálogo.
- **`lang="pt-BR"` por tag `<ptBR>`.** Nome de lei ou de órgão em português ganha
  `<span lang="pt-BR">` na página em inglês (WCAG 3.1.2). A paridade exige as mesmas tags nos dois
  idiomas, então o pt-BR usa a mesma marcação, sem efeito visível.
- **Datas sem deslocamento de fuso.** `src/lib/i18n/format.ts` formata data de calendário (vigência,
  versão de um texto) a partir da meia-noite UTC com `timeZone: 'UTC'`; instante no fuso de
  exibição (`America/Sao_Paulo`, o mesmo do next-intl); período de apuração como `MM/AAAA` em
  qualquer idioma (a forma do SPED) ou por extenso. É `Intl` puro, sem React, para servir a
  componentes de servidor e de cliente.
- **Paridade com diff.** O teste compara as chaves de todos os namespaces e mostra o que falta e o
  que sobra em en; também exige os mesmos argumentos ICU e as mesmas tags de rich text.
- **E2E com a escolha feita por padrão.** O `playwright.config.ts` dá às jornadas um `storageState`
  com a recusa gravada, para o banner fixo não cobrir o composer e os botões do rodapé; o
  `consent.spec.ts` volta ao estado vazio. A CSP é conferida com o mesmo listener de
  `securitypolicyviolation` do `platform.spec.ts` (`e2e/csp.ts`).
- **Sem nome de pessoa, CNPJ ou endereço.** O controlador é descrito como o mantenedor, pessoa
  física, com contato pelo repositório; os pontos que pedem revisão jurídica estão no PR.
