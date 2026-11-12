# Design

## Contexto

O portal antigo do SPED (`sped.rfb.gov.br`) só responde em http: a porta 443 não aceita conexão.
Os Guias 3.0.1 a 3.1.8 só existem lá, e o download responde 302 para
`http://sped.rfb.gov.br/estatico/.../Guia Prático EFD - Versão X.pdf`, no mesmo host. Os sha256
de `corpus/sources.yaml` foram conferidos de novo em 2026-11-12, baixando os cinco arquivos.

## Decisões

1. **Integridade pelo pin, não pelo transporte.** Em http, um intermediário pode trocar o corpo da
   resposta. Como toda fonte http é `pinned` e o `discover` compara o sha256 antes de gravar o raw
   no Blobs (`PinMismatchError`), uma troca só derruba o item; nunca entra texto adulterado. A
   confidencialidade não importa (documentos públicos, sem credenciais nem cookies).
2. **Exceção por host, em duas camadas.** O manifesto só aceita http para os hosts de
   `HTTP_PINNED_HOSTS` (hoje só `sped.rfb.gov.br`) e só no modo `pinned`; o `SafeFetcher` só aceita
   http para os hosts de `httpHosts`, que o `ingest` monta a partir das fontes http habilitadas.
   O `sources-watch` passa a lista vazia. Todas as outras defesas valem também para http: DNS sem
   endereço bloqueado antes e na conexão, no máximo 3 redirects revalidados (um redirect para http
   de outro host é recusado), 1 req/s por host, teto de bytes e User-Agent fixo.
3. **Transporte.** O transporte real escolhe `node:http` ou `node:https` pelo protocolo do salto,
   com as mesmas opções (`lookup` validado, `agent: false`, `signal`).
4. **Só os Guias com efeitos de 2021 a 2024.** A reconciliação (ADR 0025) é segura para versões
   de períodos anteriores aos já publicados: a janela `W` de cada uma (o próprio período) não cruza
   as redações de 2025 em diante, então nada é fechado; redação igual alarga, diferente é inserida.
   O 3.1.8 fica de fora, porque divide o período 019 com o 3.1.9 já publicado e é mais antigo que
   ele: ingerido depois, fecharia o conhecimento do 3.1.9 e passaria a responder por 2025.
5. **Partes do Docling.** 339 a 362 páginas por Guia, em partes de até 125 páginas (3 por Guia), com
   `timeout_seconds: 7200`, como os Guias do gov.br.

## Referências conferidas

- Context7 `/websites/nodejs_latest-v24_x_api`: `http.request(url, options, callback)` aceita
  `lookup`, `agent: false`, `signal`, `method` e `headers`, como o `https.request`.
