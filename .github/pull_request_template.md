<!--
O título do PR vira a mensagem do squash: use Conventional Commits, por exemplo
`feat(api): resolve vigência por data de referência`. Tipos e escopos aceitos: a lista única em
.github/commit-types.json, conferida pelo check pr-title.
-->

## O que muda

<!-- Resumo do comportamento novo ou corrigido e do motivo. -->

## Mudança OpenSpec

<!-- Ex.: openspec/changes/add-validity-domain. Use "n/a" só para chore/ci/docs sem efeito em spec. -->

## Como foi verificado

<!-- Testes adicionados ou alterados, comandos rodados e o que foi conferido manualmente. -->

## Checklist

- [ ] Título no formato Conventional Commits, com escopo da lista
- [ ] Commits assinados (chave SSH) e com `Signed-off-by` (DCO: `git commit -s`)
- [ ] Mudança OpenSpec referenciada acima e `openspec validate --all --strict --no-interactive` passando
- [ ] Docs conferidas via Context7 (IDs listados no design.md)
- [ ] Testes cobrindo o comportamento novo (unit, integração ou e2e, conforme a matriz de testes)
- [ ] Sem segredos, dados pessoais ou chaves no diff
- [ ] Dependência nova justificada (licença na allowlist, release com mais de 7 dias, proveniência)
- [ ] Docs, ADR ou runbook atualizados quando o comportamento ou a operação mudou
