---

status: accepted
date: 2026-11-12
decision-makers: Rafael Daily Santos Martins
---

# 0026 — Revisão do parser na identidade da versão de documento

## Contexto e problema

A ingestão é incremental (ADR 0025): um sha256 já publicado volta `unchanged`, sem tocar o banco
nem a porta de embeddings. Isso torna a reingestão barata, mas também impede que uma correção de
parser chegue a um arquivo já ingerido.

O primeiro `corpus-eval` contra o staging (2026-11-12) mostrou o problema. O Guia EFD ICMS/IPI 3.1.9
estava sem o registro 0000 (o Docling juntou o título do Bloco 0 ao do registro) e com todos os
campos do C100 em `pending` (o TableFormer fundiu linhas da tabela de campos), fora da busca de
produção. O parser foi corrigido, mas o mesmo PDF continuaria `unchanged`, e a produção, que só
recebe o corpus pelo snapshot do staging, herdaria o erro.

## Decisão

1. **Revisão por parser.** Cada `ParserName` tem uma revisão inteira (`PARSER_REVISIONS`, em
   `parsers/index.ts`), incrementada quando a mudança altera a saída para um arquivo já ingerido
   (extração, chave, vigência ou texto). Refatoração sem efeito na saída não incrementa.
2. **Revisão gravada.** `corpus.document_versions.parser_revision` guarda a revisão que produziu a
   versão; a migração dá 1 a tudo o que já estava gravado. O snapshot leva a coluna, e o promote de
   um snapshot anterior a ela usa 1.
3. **`unchanged` com revisão igual ou maior.** Com revisão menor, a mesma versão de documento é
   reprocessada pela reconciliação de sempre (o `insertDocumentVersion` já é upsert por sha256):
   redações iguais ficam, as que mudaram têm o `knowledge` fechado e as corrigidas entram, com os
   embeddings novos sob o orçamento e o cache. Um run com revisão mais antiga (ramo desatualizado)
   não desfaz uma mais nova.
4. **Primeira revisão incrementada:** `docling-guia` = 2, pela correção do registro 0000 e das
   linhas fundidas.

## Consequências

- Uma correção de parser chega ao staging no run seguinte e à produção no próximo snapshot, só
  para os documentos daquele parser.
- O incremento é manual. Esquecer de incrementar deixa a correção só para arquivos novos, como
  antes desta decisão; o `design.md` de cada mudança de parser registra se a revisão subiu.
- O reprocessamento acrescenta linhas só para as redações que mudaram (no Guia 3.1.9, cerca de 50),
  sob a guarda de 800 MB.
- O teste do registro exige uma revisão inteira positiva para cada `ParserName`.

## Alternativas consideradas

- **Recarregar o staging do zero a cada correção.** Resolve a primeira vez, mas cada correção de
  parser futura exigiria repetir a operação manualmente.
- **Versão global da aplicação na identidade.** Reprocessaria o corpus inteiro a cada release,
  mesmo sem mudança de parser.
- **Hash da saída do parser.** Detectaria qualquer mudança sem incremento manual, mas exigiria
  parsear tudo em todo run só para comparar, o que tira o ganho da ingestão incremental.
