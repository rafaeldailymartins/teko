# Spec Delta

## ADDED Requirements

### Requirement: Título na identidade da redação

Na reconciliação, a identidade de uma redação MUST incluir o título gravado nos chunks (que vai
para o texto do embedding): mesmo texto e mesma vigência com título diferente SHALL fechar a
redação antiga e inserir a nova.

#### Scenario: Título corrigido pelo parser

- **WHEN** a revisão nova do parser muda só o `headingPath` de um artigo, com o mesmo texto e a mesma vigência
- **THEN** a redação antiga tem o conhecimento fechado, a nova entra com os chunks no título novo e só o texto dela é embutido
