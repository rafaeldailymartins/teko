## MODIFIED Requirements

### Requirement: WAF aplicado por código, com lockdown versionado

`scripts/vercel-firewall.ts` MUST aplicar as regras de `infra/vercel/firewall-rules.json` por nome,
escrevendo só o que difere. `--lockdown on` MUST trocar a regra `deny-unknown-api` pelo payload
`lockdown` do JSON, e `--lockdown off` MUST voltar à normal. Sem `--lockdown`, um lockdown ativo
SHALL ser mantido, com aviso. O lockdown MUST levar a `/aviso/` por redirect temporário (307).

#### Scenario: Lockdown sem o redirect temporário

- **WHEN** o payload `lockdown` do JSON nega, redireciona para outro destino ou usa `permanent: true`
- **THEN** o script termina com 1 antes de chamar a API

#### Scenario: Projeto em dia

- **WHEN** as 3 regras do projeto têm o mesmo conteúdo do JSON
- **THEN** o script não escreve nada e informa `lockdown=off` e `changes=0`

#### Scenario: Lockdown pelo guarda de uso

- **WHEN** o guarda de uso roda `--env production --lockdown on`
- **THEN** a regra `deny-unknown-api` do `tekoia` passa ao payload de lockdown, `/pt-BR/` e `GET /api/v1/coverage` recebem 307 para `/aviso/` na borda, e `/aviso/` e `/healthz` respondem 200

#### Scenario: Lockdown antigo com deny

- **WHEN** a regra 1 ativa é um lockdown gravado antes, com `deny`, e o guarda roda `--lockdown on`
- **THEN** o script grava o payload com o redirect por `rules.update`

#### Scenario: Deploy durante o lockdown

- **WHEN** o deploy roda o sync sem `--lockdown` com o lockdown ativo
- **THEN** a regra 1 continua em lockdown, as outras são sincronizadas e o log traz um `::warning`
