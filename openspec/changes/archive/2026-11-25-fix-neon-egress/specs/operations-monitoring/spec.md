## ADDED Requirements

### Requirement: Alertas de transferência do Neon

O Grafana as code MUST ter os alertas `teko-neon-transfer-50` (aviso) e `teko-neon-transfer-80`
(crítico) sobre `teko_neon_data_transfer_ratio` por projeto e ambiente, com o runbook
`neon-suspended.md#transferencia-acima-da-cota`, e o dashboard de cotas SHALL mostrar a razão por
projeto.

#### Scenario: Staging com 4,1 GB no período

- **WHEN** `teko_neon_data_transfer_ratio{project="teko-staging"}` vale 0,82
- **THEN** os dois alertas disparam com o link do runbook

## MODIFIED Requirements

### Requirement: Métricas de cota do ops.yml

O job `quotas` MUST empurrar por OTLP/HTTP ao Grafana Cloud, uma vez por dia,
`teko_neon_compute_hours`, `teko_neon_cu_hours_ratio` e `teko_neon_data_transfer_ratio` (pela API
do Neon, sem acordar o compute), `teko_token_expiry_days`, `teko_coverage_verified_age_days` e
`teko_ops_job_last_success_timestamp_seconds`. Fonte não configurada SHALL ser pulada com aviso;
fonte configurada que falha MUST deixar o job vermelho depois de enviar o resto.

#### Scenario: Projeção de CU-h

- **WHEN** o projeto consumiu 30 CU-h e passaram 40% do período de cobrança
- **THEN** `teko_neon_compute_hours` vale 30 e `teko_neon_cu_hours_ratio` vale 0,75

#### Scenario: Transferência do período

- **WHEN** o Neon informa `data_transfer_bytes` de 4.000.000.000 no período
- **THEN** `teko_neon_data_transfer_ratio` vale 0,8 para o projeto (sobre os 5 GB do Free, sem projeção), qualquer que seja a fração decorrida do período

#### Scenario: Neon sem data_transfer_bytes

- **WHEN** a resposta do `GET /projects/{id}` não traz `data_transfer_bytes`
- **THEN** o job envia as outras métricas e termina vermelho, sem contar a transferência como zero

#### Scenario: Credencial OTLP ausente

- **WHEN** `GRAFANA_OTLP_TOKEN` não existe
- **THEN** o job imprime as métricas calculadas, avisa que não enviou e termina verde
