## ADDED Requirements

### Requirement: Vetor sem sair do banco na ingestão

A ingestão MUST NOT ler vetores do banco para a aplicação: a conferência do `embedding_cache` SHALL
ler só as chaves (`content_hash`), o vetor de cada chunk novo MUST ser copiado do cache para
`corpus.chunks` por SQL dentro do banco, e a poda MUST apagar no banco com a lista do que fica como
parâmetro. Chunk novo que ficaria sem vetor MUST desfazer a transação da versão.

#### Scenario: Versão nova com o vetor no cache

- **WHEN** uma versão de documento é publicada com chunks cujos vetores já estão no `embedding_cache`
- **THEN** todo chunk aberto tem o mesmo vetor do cache, e nenhuma consulta da ingestão devolveu a coluna `embedding`

#### Scenario: Vetor sumiu do cache durante o run

- **WHEN** o vetor de um chunk novo não está mais no `embedding_cache` na hora de gravar
- **THEN** a transação da versão volta com erro de invariante e nenhum chunk aberto fica sem vetor

## MODIFIED Requirements

### Requirement: Vetor só no conhecimento aberto

O vetor de um chunk MUST ser apagado quando o conhecimento dele fecha (na ingestão, depois de os
recortes o copiarem, e na promoção), o HNSW e o GIN de `corpus.chunks` SHALL ser parciais
(`WHERE upper_inf(knowledge)`), e um run verde que cobriu todas as famílias e publicou alguma
versão SHALL apagar do `embedding_cache` os vetores que nenhum chunk aberto usa.

#### Scenario: Consolidado que fecha redações

- **WHEN** um consolidado novo fecha o conhecimento de redações publicadas
- **THEN** nenhum chunk fechado tem vetor e todo chunk aberto tem

#### Scenario: Run completo sem nada novo

- **WHEN** um run verde cobre todas as famílias e todas as versões voltam `unchanged`
- **THEN** a poda do `embedding_cache` não roda e o texto dos chunks não é lido
