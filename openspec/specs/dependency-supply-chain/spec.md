# dependency-supply-chain Specification

## Purpose

Garante que só versões maduras, de origem confiável e revisadas entrem no lockfile do Tekó, e que
nenhum script de instalação de dependência rode sem aprovação explícita.

## Requirements

### Requirement: Versões só pelo catálogo

Toda dependência dos pacotes do workspace MUST usar uma versão exata declarada no catálogo do
`pnpm-workspace.yaml`.

#### Scenario: Dependência fora do catálogo

- **WHEN** alguém adiciona a um `package.json` uma versão que não está no catálogo
- **THEN** o pnpm recusa a instalação por causa do `catalogMode: strict`

### Requirement: Maturidade mínima de 7 dias

O gerenciador de pacotes MUST recusar versões publicadas há menos de 7 dias (10080 minutos).

#### Scenario: Versão recém-publicada

- **WHEN** o catálogo aponta para uma versão publicada há 2 dias
- **THEN** a instalação falha até a versão completar 7 dias ou ganhar uma exceção documentada na ADR 0002

### Requirement: Proveniência sem regressão

O gerenciador de pacotes MUST recusar uma versão cuja evidência de confiança (provenance ou
trusted publisher) seja mais fraca que a de versões publicadas antes dela.

#### Scenario: Versão sem proveniência depois de versões com proveniência

- **WHEN** uma versão nova de um pacote sai sem provenance e versões anteriores tinham
- **THEN** a instalação falha, salvo exceção exata em `trustPolicyExclude` justificada na ADR 0002

### Requirement: Scripts de build de dependências bloqueados por padrão

Scripts de instalação de dependências MUST rodar apenas quando o pacote estiver aprovado em
`allowBuilds`; qualquer pacote não revisado SHALL fazer a instalação falhar.

#### Scenario: Pacote novo com postinstall

- **WHEN** uma dependência nova traz um script `postinstall` e não está em `allowBuilds`
- **THEN** a instalação falha com erro de build ignorado até a revisão do pacote

### Requirement: Lockfile de documento único

O `pnpm-lock.yaml` MUST ser um único documento YAML e o `package.json` da raiz MUST NOT declarar
`devEngines` nem `configDependencies`.

#### Scenario: Lockfile com dois documentos

- **WHEN** o `pnpm-lock.yaml` contém um separador `---`
- **THEN** `node scripts/check-lockfile.ts` termina com código 1, no hook de pre-commit e no CI

### Requirement: Dependências transitivas só de fontes confiáveis

Dependências transitivas MUST NOT vir de fontes exóticas (repositórios git ou URLs de tarball).

#### Scenario: Subdependência de repositório git

- **WHEN** uma dependência transitiva declara uma versão `git+ssh://…`
- **THEN** a instalação falha por causa de `blockExoticSubdeps`

### Requirement: Exceções da Vercel confinadas ao projeto do CLI

O `pnpm-workspace.yaml` da raiz MUST NOT declarar exceção de `trustPolicy` para `vercel` nem para
`@vercel/*`; as exceções exigidas pelo Vercel CLI SHALL ficar no projeto pnpm isolado
`tools/vercel-cli`, com lockfile próprio, usado só nos jobs de deploy.

#### Scenario: Versão da Vercel sem proveniência no workspace da aplicação

- **WHEN** alguém sobe `@vercel/functions` no catálogo da raiz para uma versão publicada só com trusted publisher, sem proveniência
- **THEN** a instalação falha por causa do `trustPolicy: no-downgrade`, e nenhuma exceção da raiz a libera

#### Scenario: Instalação do CLI no job de deploy

- **WHEN** o job de deploy roda `corepack pnpm --dir tools/vercel-cli install --frozen-lockfile`
- **THEN** o CLI é instalado com as exceções de `tools/vercel-cli/pnpm-workspace.yaml`, sem tocar o `node_modules` da aplicação

### Requirement: Maturidade mínima também no Python

As dependências de `tools/ingest` MUST ser resolvidas pelo uv com `exclude-newer` de 7 dias, e o
CI MUST usar o `uv.lock` sem re-resolução (`--frozen`).

#### Scenario: Pacote Python recém-publicado

- **WHEN** uma dependência de `tools/ingest` tem uma versão publicada há 2 dias e alguém roda `uv lock`
- **THEN** o uv ignora essa versão e resolve a mais nova com pelo menos 7 dias, salvo exceção exata em `exclude-newer-package` justificada na ADR 0002
