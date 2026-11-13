# Spec Delta

## MODIFIED Requirements

### Requirement: Download seguro das fontes

Todo download da ingestão MUST passar pelo `SafeFetcher`: só `https` na porta 443 e sem
credenciais, host da allowlist, DNS resolvido antes e de novo na conexão sem endereço privado,
link-local, de metadata ou reservado (IPv4, IPv6 e IPv4 embutido), no máximo 3 redirects
revalidados, 1 requisição por segundo por host, User-Agent fixo e teto de bytes. Erro de rede
transitório e respostas 502, 503 e 504 SHALL ter até 2 novas tentativas, com espera crescente e
dentro do mesmo timeout; bloqueio de segurança e cancelamento MUST NOT ser repetidos.

#### Scenario: Redirect para o metadata da nuvem

- **WHEN** uma fonte responde 307 para `https://169.254.169.254/`
- **THEN** a requisição é recusada com `BlockedRequestError` antes de qualquer conexão ao destino

#### Scenario: DNS rebinding

- **WHEN** o host passa na checagem e, na conexão, o DNS resolve para `127.0.0.1`
- **THEN** o `lookup` da conexão falha e nenhum byte é trocado com o endereço interno

#### Scenario: Conexão reiniciada pelo servidor da fonte

- **WHEN** o download do RCTE falha com `ECONNRESET` e a tentativa seguinte responde 200
- **THEN** o download termina com o arquivo, depois de uma espera de 2 s, sem derrubar o run
