## MODIFIED Requirements

### Requirement: Cliente do PostHog na UE sem script externo

O cliente de analytics MUST ser o `posthog-js` sem carregamento de script externo (entrada
`dist/module.no-external`, pesquisas de `dist/surveys` no bundle), importado só pelo `import()` do
`client-loader.ts` e apontado para a UE. O web MUST NOT chamar `identify`. O SDK SHALL ficar fora do
JS de primeiro acesso. O cliente de erros (capability `error-tracking`) é outra instância do mesmo
módulo, importada só no primeiro erro, e MUST NOT ligar nem mexer na instância de analytics.

#### Scenario: Aceite com a chave

- **WHEN** a pessoa aceita a medição num build com `NEXT_PUBLIC_POSTHOG_KEY`
- **THEN** o SDK é importado uma vez; o `init` recebe `api_host` `https://eu.i.posthog.com`,
  `disable_external_dependency_loading: true`, `cookieless_mode: 'on_reject'`,
  `persistence: 'localStorage'`, `person_profiles: 'identified_only'` e replay, autocapture,
  pageview, pageleave e exceções desligados; e o opt-in é feito sem o evento `$opt_in`

#### Scenario: Sem consentimento

- **WHEN** não há escolha, a escolha é a recusa ou só as pesquisas foram aceitas, e nenhum erro
  aconteceu na página
- **THEN** o `posthog-js` não é importado, e nenhum cookie nem chave é gravado no navegador

#### Scenario: Erro sem consentimento

- **WHEN** um erro acontece numa visita que recusou a medição
- **THEN** só o cliente de erros é carregado; nenhum evento do catálogo sai e nada é gravado no
  navegador

### Requirement: Eventos do chat

O chat MUST emitir `question_asked` a cada envio (inclusive esclarecimento e nova tentativa), com o
locale e a origem da data, e `reference_date_set` ao trocar a data do chip. Ao fim de cada resposta
sem abort nem erro, MUST emitir `clarification_shown`, `answer_refused` ou `answer_completed` e, se
houve troca de provedor, `provider_fallback`. Cota estourada SHALL emitir `quota_reached` com o
escopo. Os eventos que vêm de uma resposta da API (`clarification_shown`, `answer_refused`,
`answer_completed`, `provider_fallback` e `quota_reached`) MUST levar o `trace_id` W3C dela quando
houver, e o catálogo SHALL recusar um `trace_id` fora do formato de 32 hex.

#### Scenario: Resposta com fallback

- **WHEN** uma resposta termina com `data-meta.fallbackFrom` preenchido e o modelo no `finish`
- **THEN** saem `answer_completed` e `provider_fallback`, ambos válidos no catálogo e com o
  `trace_id` do `finish`

#### Scenario: Resposta do cache

- **WHEN** uma resposta do cache termina sem os metadados do `finish`
- **THEN** o `answer_completed` leva o provedor como família e nenhum `trace_id`

#### Scenario: Cota estourada

- **WHEN** a API recusa a pergunta com `quota_exceeded` de escopo `user_daily` e `traceId` W3C
- **THEN** sai `quota_reached` com `scope` `user_daily` e esse `trace_id`
