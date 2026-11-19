# Tasks

## 1. Workflow

- [x] 1.1 Passo que lê a deployment no domínio antes do promote; rollback por `vercel promote` dela
  com conferência do `gitSha` (verificar: actionlint e `ci-config.test.sh`)
- [x] 1.2 Input `simulate_failure`, recusado fora do staging, e o passo da falha simulada depois do
  smoke canônico (verificar: `ci-config.test.sh`)

## 2. Documentos

- [x] 2.1 Runbooks de rollback e deploy e `ci-cd-e-ambientes.md` (verificar: revisão do diff)

## 3. Specs

- [x] 3.1 Delta de `deployment` (verificar: `pnpm spec:validate`)
