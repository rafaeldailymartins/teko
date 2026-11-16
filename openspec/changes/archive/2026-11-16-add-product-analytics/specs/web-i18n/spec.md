# Spec Delta

## MODIFIED Requirements

### Requirement: Política de privacidade coerente com o registro de tratamento

A política de privacidade MUST seguir o `docs/privacy/ropa.md`: dados e bases legais da LGPD,
retenção de 90 dias das perguntas, operadores com o aviso de treino do provedor gratuito, os de
observabilidade com base legal e retenção, exportação e exclusão em `/settings` e contato
pelo repositório, sem nome de pessoa, CNPJ ou endereço. Mudança material no texto MUST vir com uma
`PRIVACY_POLICY_VERSION` nova.

#### Scenario: Retenção e direitos

- **WHEN** alguém lê `/pt-BR/privacy/` ou `/en/privacy/`
- **THEN** a página cita a retenção de 90 dias e leva a `/settings` para exportar e apagar os dados

#### Scenario: Observabilidade

- **WHEN** alguém lê a seção de operadores de `/pt-BR/privacy/` ou `/en/privacy/`
- **THEN** ela lista PostHog, Langfuse e Grafana Labs, na União Europeia, e a de retenção cita 1 ano
  do PostHog e 14 dias do Grafana Cloud
