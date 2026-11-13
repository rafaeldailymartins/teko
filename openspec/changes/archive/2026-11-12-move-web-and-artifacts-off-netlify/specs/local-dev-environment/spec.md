# Spec Delta

## REMOVED Requirements

### Requirement: Token do proxy de dev renovável

**Reason**: a web e a API passam a ficar na mesma origem (ADR 0029); não há mais proxy assinado
da Netlify a imitar, e a API não confere `x-nf-sign`.

**Migration**: o `DEV_PROXY_JWS_SECRET` e o `DEV_STATIC_JWS` deixam de ser gerados; as linhas que
sobrarem nos `.env` locais são ignoradas e podem ser apagadas.

### Requirement: Proxy assinado de dev

**Reason**: sem a Netlify, o caminho web → API em dev é o mesmo de produção: uma origem só, sem
proxy de terceiros (ADR 0029).

**Migration**: o requisito "Web e API na mesma origem em dev" substitui este; o serviço
`dev-proxy` sai do `infra/local/compose.yaml`.

## ADDED Requirements

### Requirement: Web e API na mesma origem em dev

O `next dev` (`127.0.0.1:3000`) MUST repassar `/api/*` para a API local (`pnpm dev`, porta 4000),
para o navegador ver uma origem só, como em produção, e o `WEB_ORIGIN` local SHALL ser a origem do
`next dev`.

#### Scenario: Chamada da web à API

- **WHEN** o navegador chama `http://localhost:3000/api/v1/...`
- **THEN** a requisição chega à API local sem proxy assinado nem CORS
