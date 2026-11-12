# Design

## Context

O `IngestDocumentVersion` é incremental: um sha256 já publicado volta `unchanged` sem tocar o banco
nem a porta de embeddings, e um arquivo novo é reconciliado com as redações abertas do documento
(ADR 0025). A identidade de uma redação é o hash do texto, a modalidade e a classe de revisão; o
`knowledge` (tempo de transação) é o que permite fechar uma redação sem apagar o que se sabia.

## Decisions

- **Revisão por parser, não por versão da aplicação.** Só o parser muda a saída para o mesmo
  arquivo; uma revisão por `ParserName` reprocessa só os documentos daquele parser. Uma versão
  global reprocessaria o corpus inteiro a cada release.
- **Incremento manual, revisado no PR.** A revisão sobe quando a mudança altera a saída de um
  arquivo já ingerido (correção de extração, chave, vigência ou texto). Refatoração sem efeito na
  saída não sobe. O teste do registro (`PARSER_REVISIONS` cobre todos os `ParserName`, inteiros
  positivos) impede esquecer um parser novo.
- **Padrão 1 na migração.** Tudo o que já está gravado foi produzido pela primeira revisão de cada
  parser, exceto o Guia EFD ICMS/IPI, cuja correção é a razão desta mudança: com o `docling-guia`
  em 2, só os seis Guias são reprocessados no próximo run.
- **Reprocessar pela reconciliação de sempre, na mesma versão de documento.** O `insertDocumentVersion`
  já é um upsert por sha256 (volta a `ingesting` e depois a `published`). A janela de substituição
  é a do próprio documento, então só as redações dele são comparadas; as iguais ficam, as
  diferentes têm o `knowledge` fechado em `publishedOn` (o `closeKnowledge` garante intervalo não
  vazio) e as novas entram. O `pv_no_overlap` só vale para `knowledge` aberto.
- **`unchanged` com revisão igual ou maior.** Um run com um parser mais antigo (por exemplo, um
  ramo desatualizado) não desfaz o trabalho de uma revisão mais nova.

## Risks / Trade-offs

- **Esquecer de subir a revisão.** A correção fica só para arquivos novos, como hoje. O template do
  PR não muda; o `design.md` de cada mudança de parser registra se a revisão subiu.
- **Linhas a mais no staging.** Cada reprocessamento fecha e reinsere só as redações que mudaram;
  no Guia 3.1.9, cerca de 50. A guarda de 800 MB continua valendo.

## Context7

| Biblioteca  | ID                               | Consulta                                                     |
| ----------- | -------------------------------- | ------------------------------------------------------------ |
| Drizzle ORM | `/drizzle-team/drizzle-orm-docs` | coluna `integer().notNull().default()` e geração da migração |
