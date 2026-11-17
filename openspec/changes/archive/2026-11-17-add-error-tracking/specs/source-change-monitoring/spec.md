## ADDED Requirements

### Requirement: Evento de mudança ao destino de erros

Quando o `detect` encontra mudança (`has_changes=true`), o `source-watch.yml` MUST mandar ao PostHog
da UE um evento `source_watch_changed` com o número de mudanças, as famílias, os tipos, se houve erro
de verificação, a data do run e o link dele, sem perfil de pessoa e sem o conteúdo das páginas, com a
chave do projeto do environment `staging`. Sem a chave, ou com o PostHog recusando o evento, o job
SHALL só avisar e seguir.

#### Scenario: Decreto novo

- **WHEN** o RCTE ganha um consolidado novo e o environment `staging` tem `POSTHOG_PROJECT_KEY`
- **THEN** sai um `source_watch_changed` com `families` `["rcte"]` e o link do run, e o job continua

#### Scenario: Sem a chave

- **WHEN** há mudança e o environment não tem `POSTHOG_PROJECT_KEY`
- **THEN** o job registra um aviso e termina sem erro
