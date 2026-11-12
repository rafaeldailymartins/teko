---

status: accepted
date: 2026-11-12
decision-makers: Rafael Daily Santos Martins
---

# 0028 — Exceção http com pin para os Guias do portal antigo do SPED

## Contexto e problema

A cobertura da EFD ICMS/IPI começava em 2025-01-01: os Guias Práticos 3.0.1 a 3.1.8 só existem no
portal antigo `sped.rfb.gov.br`, que não aceita conexão na porta 443, e o `SafeFetcher` só aceitava
https (plano, Segurança, SSRF). Sem os Guias de anos anteriores, o Tekó não responde quem retifica
uma EFD de 2022 ou responde a uma fiscalização de 2023, e a consciência de vigência é o seu
diferencial. O fisco revisa, em regra, até cerca de 5 anos para trás.

## Decisão

1. **Integridade pelo pin.** Fonte em http só no modo `pinned`, com sha256 obrigatório; o
   `discover` compara o hash antes de o arquivo entrar no plano (e no Blobs). Um intermediário que
   troque o corpo só derruba o item, sem texto adulterado no corpus. Confidencialidade não importa:
   documentos públicos, sem credenciais nem cookies.
2. **Exceção por host, em duas camadas.** O manifesto aceita http só nos hosts de
   `HTTP_PINNED_HOSTS` (hoje só `sped.rfb.gov.br`); o `SafeFetcher` aceita http, na porta 80, só nos
   hosts de `httpHosts`, que o `ingest` monta com as fontes http habilitadas (o `sources-watch` não
   recebe exceção). As demais defesas continuam valendo em http: DNS sem endereço bloqueado antes e
   na conexão, redirects revalidados (para http de outro host é recusado), 1 req/s por host, teto de
   bytes e User-Agent fixo. No `ingest.yml`, `sped.rfb.gov.br:80` só no harden-runner do
   `discover`, e a matriz do `extract` só aceita http desse host.
3. **Só os Guias com efeitos de 2021 a 2024** (decisão do mantenedor em 2026-11-12): 3.0.6, 3.0.8,
   3.1.2, 3.1.3 e 3.1.6. A cobertura da EFD ICMS/IPI passa a começar em 2021-01-01.
4. **O 3.1.8 fica de fora.** Divide o leiaute 019 com o 3.1.9, já publicado no staging, e é mais
   antigo que ele. A reconciliação (ADR 0025) fecha o conhecimento das redações abertas que cruzam a
   janela da versão nova; ingerido depois, o 3.1.8 fecharia o do 3.1.9 e passaria a responder por
   2025. As versões de anos anteriores são seguras, porque a janela delas não cruza 2025 em diante.

## Consequências

- Cerca de 15 partes do Docling a mais (uns 40 min de extract com 6 em paralelo) e embeddings só das
  redações que mudaram de um ano para o outro, dentro do orçamento diário.
- O tamanho do staging cresce; o resumo do `ingest.yml` mostra o tamanho, com aviso acima de 400 MB
  e a guarda do load em 800 MB.
- O golden `recusa-efd-antes-da-cobertura` passa a usar 2020-03.
- Habilitar outra fonte em http exige incluir o host em `HTTP_PINNED_HOSTS` e no harden-runner, ou
  seja, uma nova decisão.

## Alternativas consideradas

- **Espelho dos PDFs em outro lugar (Blobs, repositório).** Tiraria a proveniência oficial da URL
  citada e, no repositório, levaria cerca de 25 MB de binários.
- **https sem verificação de certificado ou proxy.** O portal nem aceita conexão na 443; e
  desligar a verificação não acrescentaria nada ao pin.
- **Todos os 18 Guias do portal antigo.** As versões sem efeitos não têm vigência própria, e 2019 e
  2020 ficam fora da janela de revisão.
