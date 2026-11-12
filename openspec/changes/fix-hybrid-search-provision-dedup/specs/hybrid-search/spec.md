# Spec Delta

## MODIFIED Requirements

### Requirement: Busca filtrada por vigência

A busca MUST devolver só chunks em vigor na data de referência, com conhecimento atual, das
famílias cobertas e com status de revisão permitido no ambiente (produção: `auto` e `approved`;
staging: também `pending`), fundindo os braços léxico, vetorial e da referência citada por RRF
com k = 60. Cada braço SHALL ranquear no máximo um chunk por versão de dispositivo, e a fusão
SHALL somar os votos por versão de dispositivo, devolvendo um único chunk representante por
versão.

#### Scenario: Toda evidência em vigor

- **WHEN** a pergunta é sobre 2006-05-01
- **THEN** toda evidência devolvida tem vigência que contém 2006-05-01

#### Scenario: Mesmo dispositivo em datas diferentes

- **WHEN** a pergunta cita "art. 76, § 6º do RCTE" em 03/2004, 05/2006 e 01/2010
- **THEN** a busca devolve, respectivamente, a redação do Dec. 5.825, a do Dec. 6.026 e a revogação pelo Dec. 7.028

#### Scenario: Dispositivo partido em vários chunks

- **WHEN** a versão de um dispositivo tem três chunks que casam com a pergunta
- **THEN** a busca devolve um único resultado para essa versão, e as outras vagas do top-k ficam para outros dispositivos
