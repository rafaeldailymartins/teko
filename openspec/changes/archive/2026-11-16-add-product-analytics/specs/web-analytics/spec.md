# Spec Delta

## ADDED Requirements

### Requirement: Cliente do PostHog na UE sem script externo

O cliente de analytics MUST ser o `posthog-js` sem carregamento de script externo (entrada
`dist/module.no-external`, pesquisas de `dist/surveys` no bundle), importado só pelo `import()` do
`client-loader.ts` e apontado para a UE. O web MUST NOT chamar `identify`. O SDK SHALL ficar fora do
JS de primeiro acesso.

#### Scenario: Aceite com a chave

- **WHEN** a pessoa aceita a medição num build com `NEXT_PUBLIC_POSTHOG_KEY`
- **THEN** o SDK é importado uma vez; o `init` recebe `api_host` `https://eu.i.posthog.com`,
  `disable_external_dependency_loading: true`, `cookieless_mode: 'on_reject'`,
  `persistence: 'localStorage'`, `person_profiles: 'identified_only'` e replay, autocapture,
  pageview, pageleave e exceções desligados; e o opt-in é feito sem o evento `$opt_in`

#### Scenario: Sem consentimento

- **WHEN** não há escolha, a escolha é a recusa ou só as pesquisas foram aceitas
- **THEN** o `posthog-js` não é importado, e nenhum cookie nem chave é gravado no navegador

### Requirement: Só o catálogo sai, sem texto livre

Todo evento do app MUST passar pelo schema estrito de `@teko/shared/analytics`
(`parseAnalyticsProperties`) antes do `capture`; propriedade desconhecida ou fora do formato SHALL
descartar o evento. O `before_send` MUST descartar todo evento que não seja do catálogo nem das
pesquisas (`survey shown`, `survey sent`, `survey dismissed`), descartar tudo com o consentimento
retirado e tirar query e âncora de toda URL das propriedades, de `$set` e de `$set_once`.

#### Scenario: Texto da pergunta

- **WHEN** um `question_asked` chega ao cliente com uma propriedade `question`
- **THEN** o evento não é enviado

#### Scenario: Evento do SDK fora da lista

- **WHEN** o SDK tenta enviar um `$pageview`
- **THEN** o `before_send` devolve `null`

#### Scenario: URL com identificadores

- **WHEN** um evento sai com `$current_url` `https://tekoia.vercel.app/pt-BR/chat/?c=…&q=…`
- **THEN** a propriedade chega como `https://tekoia.vercel.app/pt-BR/chat/`

### Requirement: Eventos do chat

O chat MUST emitir `question_asked` a cada envio (inclusive esclarecimento e nova tentativa), com o
locale e a origem da data, e `reference_date_set` ao trocar a data do chip. Ao fim de cada resposta
sem abort nem erro, MUST emitir `clarification_shown`, `answer_refused` ou `answer_completed` (com
`trace_id` W3C quando houver) e, se houve troca de provedor, `provider_fallback`. Cota estourada
SHALL emitir `quota_reached` com o escopo.

#### Scenario: Resposta com fallback

- **WHEN** uma resposta termina com `data-meta.fallbackFrom` preenchido e o modelo no `finish`
- **THEN** saem `answer_completed` e `provider_fallback`, ambos válidos no catálogo

#### Scenario: Resposta do cache

- **WHEN** uma resposta do cache termina sem os metadados do `finish`
- **THEN** o `answer_completed` leva o provedor como família e nenhum `trace_id`

### Requirement: Eventos de leitura, preferências e desempenho

O web MUST emitir `citation_opened` (família do documento e se a redação é a vigente) ao abrir uma
citação, `diff_opened` a cada diff montado, `answer_feedback` com o polegar gravado,
`locale_changed` no menu de idioma, `consent_updated` ao salvar a escolha e `web_vital` (LCP, INP,
CLS, FCP e TTFB) por um componente carregado só com o cliente de analytics ligado.

#### Scenario: Web Vitals sem consentimento

- **WHEN** a medição não foi aceita
- **THEN** o código do `web-vitals` não é baixado e nenhum `web_vital` é enviado

#### Scenario: Métrica fora do catálogo

- **WHEN** o Next entrega uma métrica que não é LCP, INP, CLS, FCP nem TTFB
- **THEN** nenhum evento sai

### Requirement: Retirar o consentimento limpa o navegador

Retirar o consentimento com o cliente carregado MUST fazer o `opt_out_capturing`, desligar as
pesquisas, fazer o `before_send` descartar tudo e apagar do `localStorage`, do `sessionStorage` e
dos cookies as chaves do PostHog e das pesquisas, sem tocar nas do Tekó. Um novo aceite na mesma
página SHALL reaproveitar a instância e refazer o opt-in.

#### Scenario: Recusar tudo depois de aceitar

- **WHEN** a pessoa aceita a medição e depois escolhe "Recusar tudo" nas preferências
- **THEN** as chaves `ph_*`, `__ph_*` e das pesquisas somem, `teko-consent` e `teko-theme` ficam, e
  nenhum cookie existe

### Requirement: Só os hosts da UE

Depois do aceite, os pedidos do SDK MUST ir só a `https://eu.i.posthog.com` e
`https://eu-assets.i.posthog.com` (configuração remota), sem cookie.

#### Scenario: E2E com os hosts interceptados

- **WHEN** a pessoa aceita no build da stack de CI (chave fictícia) com todo host `*.posthog.com`
  interceptado pelo Playwright
- **THEN** há um `POST` ao host de ingestão da UE, nenhum pedido a outro host, nenhum cookie e
  nenhuma violação de CSP aplicada
