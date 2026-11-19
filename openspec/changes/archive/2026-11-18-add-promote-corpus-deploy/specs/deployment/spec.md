## ADDED Requirements

### Requirement: Corpus da produção promovido no deploy

O deploy de produção (`phase: deploy`) MUST promover o snapshot do `corpus/corpus.lock.json` do
commit implantado (`cli snapshot promote --lock`) num passo do job `deploy`, depois das migrações e
antes do env sync e do `vercel deploy`, com a URL do owner e o store só no `env` desse passo. Uma
recusa MUST terminar o job com `::error` antes de qualquer escrita na Vercel. O passo SHALL nunca
fazer rollback de corpus, e o deploy de staging SHALL nunca promover snapshot.

#### Scenario: Produção sem corpus

- **WHEN** a tag `v*` é implantada com a produção migrada e sem nenhuma versão de corpus
- **THEN** o snapshot do lock é promovido antes do `vercel deploy`, e o smoke da URL da deployment encontra a `corpusVersion` do lock em `/api/v1/coverage`

#### Scenario: Lock exportado antes de uma migração nova

- **WHEN** a última migração da produção difere da do snapshot do lock
- **THEN** o passo termina com `::error`, o job para e nada é publicado na Vercel

#### Scenario: Produção à frente do lock

- **WHEN** a produção está numa versão de corpus mais nova que a do lock (depois de um rollback de corpus)
- **THEN** o passo não escreve nada, avisa com `::warning` e o deploy segue

#### Scenario: Deploy de staging

- **WHEN** um push em `main` implanta o staging
- **THEN** o passo do `promote-corpus` não roda
