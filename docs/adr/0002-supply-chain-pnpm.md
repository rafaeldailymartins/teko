---

status: accepted
date: 2026-11-10
decision-makers: Rafael Daily Santos Martins
---

# 0002 — Supply chain de dependências com pnpm 12

## Contexto e problema

O Tekó é público, roda em produção sem orçamento para incidentes e tem política de "nenhuma
dependência vulnerável em produção". Ataques recentes ao ecossistema npm vieram de versões
maliciosas publicadas e consumidas em poucas horas, de contas de mantenedores comprometidas
(versões sem a proveniência que as anteriores tinham) e de scripts `postinstall`. Como impedir que
uma dependência assim entre no lockfile ou execute código na instalação, sem travar a
manutenção de um mantenedor solo?

## Fatores de decisão

- Bloqueio no próprio gerenciador de pacotes, local e no CI, sem serviço externo.
- Lockfile legível pelo grafo de dependências do GitHub (Dependabot, dependency-review).
- Exceções raras, exatas (pacote@versão) e justificadas por escrito.

## Opções consideradas

- pnpm 12 com catálogo estrito e as settings de supply chain nativas.
- npm com `overrides` e auditoria no CI.
- Yarn Berry com plugins de política.

## Decisão

Opção escolhida: **pnpm 12.18.0** (`packageManager`), porque concentra num só arquivo
(`pnpm-workspace.yaml`) as políticas de maturidade, proveniência, fontes e scripts de build, todas
aplicadas na resolução.

### Configuração

| Setting              | Valor                 | Efeito                                                                                                                           |
| -------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `catalogMode`        | `strict`              | Só versões do catálogo; qualquer outra faz a instalação falhar                                                                   |
| `savePrefix`         | `''`                  | Versões exatas, sem `^`/`~`                                                                                                      |
| `minimumReleaseAge`  | `10080` (7 dias)      | Versões com menos de 7 dias são recusadas; coerente com o cooldown do Dependabot                                                 |
| `trustPolicy`        | `no-downgrade`        | Falha se a evidência de confiança (trusted publisher, provenance) de uma versão for mais fraca que a de versões publicadas antes |
| `blockExoticSubdeps` | `true`                | Dependências transitivas não podem vir de git nem de URL de tarball                                                              |
| `strictDepBuilds`    | `true`                | Pacote com script de build não revisado faz a instalação falhar                                                                  |
| `allowBuilds`        | allowlist item a item | Nenhum script de dependência roda sem aprovação explícita                                                                        |
| `engineStrict`       | `true`                | Respeita `engines` (Node `>=24.12.0 <25`)                                                                                        |
| `pmOnFail`           | `ignore`              | Não troca de versão do pnpm sozinho                                                                                              |

**Scripts de build negados (`allowBuilds: false`):**

| Pacote            | Motivo                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `lefthook`        | O `postinstall` só instala os hooks; o script `prepare` da raiz (`lefthook install`) já faz isso explicitamente |
| `@parcel/watcher` | O build só compila do fonte quando falta o binário pré-compilado, que chega como `optionalDependency`           |
| `@swc/core`       | Idem: fallback de compilação; os binários vêm como dependências opcionais por plataforma                        |

**Guarda do lockfile.** `devEngines.packageManager` e `configDependencies` são proibidos, porque
geram um `pnpm-lock.yaml` com dois documentos YAML que o grafo de dependências do GitHub não lê
(o Dependabot fica cego). `scripts/check-lockfile.ts` falha se o lockfile começar com `---`, tiver
qualquer separador de documento ou se o `package.json` declarar essas chaves; roda no pre-commit
(lefthook) e no CI (`pnpm check-lockfile`).

Adendo (2026-11-11): o script não aceita argumentos e verifica sempre a lista fixa
`pnpm-lock.yaml` e `tools/vercel-cli/pnpm-lock.yaml`; nenhum caminho vem da linha de comando.

### Exceções

| Exceção                                       | Detalhe                                                                                                                                                  | Revisão                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `lefthook` fixado em **2.2.1** (plano: 2.2.2) | A 2.2.2 foi publicada **sem** proveniência SLSA, enquanto 2.2.0 e 2.2.1 têm; o `trustPolicy: no-downgrade` a recusa                                      | Subir quando sair uma versão com proveniência                          |
| `trustPolicyExclude: chokidar@4.0.3`          | 4.0.2 e 4.0.3 foram publicadas em dez/2024 sem provenance; 4.0.0, 4.0.1 e 5.0.0 têm. O `steiger` exige `^4.0.3`                                          | Remover quando o steiger aceitar o chokidar 5                          |
| `@vercel/functions` fixado em **3.7.6**       | Última versão com proveniência SLSA; todas as seguintes saíram só com trusted publisher (ver "Vercel" abaixo). Nenhuma exceção no workspace da aplicação | Subir quando a Vercel voltar a publicar com proveniência               |
| Projeto isolado `tools/vercel-cli`            | O Vercel CLI e seus `@vercel/*` exigem exceções de `trustPolicy`, confinadas a um projeto pnpm à parte (ver "Vercel" abaixo)                             | Remover as exceções quando a Vercel voltar a publicar com proveniência |

### Versões seguradas pela regra de 7 dias (em 2026-11-10)

As versões do plano ainda não tinham 7 dias de publicação na data da instalação; o catálogo usa a
anterior. O Dependabot propõe a subida quando a maturidade for atingida.

| Pacote                                 | Plano   | Catálogo |
| -------------------------------------- | ------- | -------- |
| `@biomejs/biome`                       | 2.6.6   | 2.6.4    |
| `@fission-ai/openspec`                 | 1.17.0  | 1.16.0   |
| `jscpd`                                | 5.4.3   | 5.4.2    |
| `knip`                                 | 6.45.0  | 6.44.1   |
| `type-coverage`                        | 2.31.2  | 2.31.1   |
| `tsdown`                               | 0.23.7  | 0.23.5   |
| `@fastify/cors`                        | 11.4.1  | 11.4.0   |
| `@scalar/fastify-api-reference`        | 1.78.0  | 1.76.4   |
| `next`                                 | 16.4.6  | 16.4.5   |
| `tailwindcss` e `@tailwindcss/postcss` | 4.3.5   | 4.3.4    |
| `next-intl`                            | 4.14.10 | 4.14.9   |
| `steiger`                              | 0.10.0  | 0.9.0    |

O `catalog` do `pnpm-workspace.yaml` é a fonte da verdade das versões: quando o plano de
implementação divergir dele, vale o catálogo, e o plano é corrigido no mesmo PR.

### Vercel: proveniência e o projeto isolado `tools/vercel-cli`

Desde ago/2026, a Vercel publica o pacote `vercel` (CLI) e **todos** os `@vercel/*` por npm
trusted publishing (OIDC do GitHub Actions) **sem** a atestação de proveniência SLSA que as versões
até jul/2026 tinham. Para o `trustPolicy: no-downgrade`, isso é uma regressão de confiança, e ele
recusa as versões novas, como deve.

Evidências (`npm view`, 2026-11-10):

| Versão de `@vercel/functions` | Publicação | Evidência no registro                                                                                     |
| ----------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| 3.7.6                         | 2026-07-24 | `dist.attestations.provenance` com `predicateType` `https://slsa.dev/provenance/v1` + publicação por OIDC |
| 3.7.7                         | 2026-08-03 | publicação por OIDC (`_npmUser` GitHub Actions), **sem** `dist.attestations`                              |
| 3.8.x                         | 2026-08-05 | nenhuma evidência de proveniência                                                                         |
| 3.9.0 em diante (até 3.11.1)  | 2026-08-07 | só trusted publisher, sem proveniência                                                                    |

O stream de dependências também registrou que o id de configuração OIDC do trusted publisher da
Vercel mudou duas vezes nesse intervalo, o que reforça não abrir exceção ampla no código que roda
em produção.

**Decisões:**

- **`@vercel/functions` 3.7.6 no workspace da aplicação**, sem nenhuma exceção de política. A 3.7.6
  exporta `waitUntil`, `attachDatabasePool`, `ipAddress`, `geolocation` e `getContext`, mas **não**
  `getDeadline` (que a documentação atual da Vercel descreve). O prazo da invocação é calculado
  pela API a partir do `maxDuration` configurado ([ADR 0004](0004-vercel-hobby-api.md)). O Biome
  proíbe `@vercel/*` em `src/domain/**` e `src/application/**`: o pacote só aparece em adapters.
- **Vercel CLI 65.11.0 em `tools/vercel-cli`**, um projeto pnpm **isolado** (`packages: []`, lockfile
  próprio, fora do workspace da aplicação), com a mesma política endurecida e só estas exceções:

  | Exceção                                       | Motivo                                                                                                                                                |
  | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `trustPolicyExclude: vercel`, `"@vercel/*"`   | Toda a organização perdeu a proveniência desde ago/2026; o CLI depende de dezenas de `@vercel/*`, então a exceção é por organização, e não por versão |
  | `trustPolicyExclude: undici@5.29.0`           | Linha antiga mantida em paralelo, publicada depois de versões mais novas que têm proveniência; o `no-downgrade` compara por data e a recusa           |
  | `trustPolicyExclude: semver@6.3.1`            | Idem: linha 6.x publicada depois de versões 7.x com proveniência                                                                                      |
  | `allowBuilds: esbuild: false`, `koffi: false` | Os binários pré-compilados chegam como `optionalDependencies`; os scripts só validam ou recompilam                                                    |

  O CLI só roda nos jobs de deploy do GitHub Actions (a partir da F7, com
  `corepack pnpm --dir tools/vercel-cli install --frozen-lockfile` seguido de
  `corepack pnpm --dir tools/vercel-cli exec vercel ...`), nunca no runtime, e não entra no
  `.vercel/output`. Assim, o workspace da aplicação mantém a política estrita com **zero**
  exceções para a Vercel.

### Python (`tools/ingest`)

O uv não tem `trustPolicy`, mas tem cooldown: `exclude-newer` em `[tool.uv]` aceita uma duração
relativa ("friendly", como `1 week` ou `7 days`, ou ISO 8601, como `P7D`), conferida no Context7
`/astral-sh/uv/0.13.5`. A regra do projeto é a mesma do pnpm: **nenhuma versão com menos de 7
dias**. O `pyproject.toml` de `tools/ingest` declara `exclude-newer = "7 days"` (configurado pelo
stream de ingestão), o `uv.lock` é gerado sob essa regra e o CI usa `uv sync --frozen`. Exceções
usam `exclude-newer-package` com a versão exata e justificativa nesta ADR.

### Ferramentas da raiz ligadas à política

- **Hooks pelo `node_modules/.bin`.** O `lefthook.yml` chama `./node_modules/.bin/<binário>` (Biome,
  OpenSpec, commitlint, turbo) em vez de `pnpm exec`, para funcionar mesmo sem `corepack enable`
  (sem `pnpm` no PATH) e sem resolver nada fora do lockfile.
- **knip em dois modos.** `pnpm knip` roda `knip` (arquivos, exports e dependências não usados,
  incluindo testes) e depois `knip --production --include dependencies,unlisted,unresolved,binaries`,
  que confere só o grafo de produção: dependência de runtime usada apenas em teste, ou não listada,
  falha.
- **Bug do `.gitignore` corrigido.** Um padrão `out/` sem âncora ignorava qualquer diretório
  `out`, inclusive `apps/api/src/adapters/out` (os adapters de saída da arquitetura hexagonal), que
  sumiria do repositório sem aviso. O padrão passou a `/apps/web/out/`, ancorado no export
  estático do Next.

### Avisos conhecidos

- `tsconfck` declara peer `typescript ^5` e recebe a 6.0.2 (alias `typescript` →
  `@typescript/typescript6`). O aviso é inofensivo: o `tsconfck` só lê `tsconfig`, sem depender de
  API removida.

### Consequências

- Bom, porque versões maliciosas recém-publicadas ou sem proveniência não entram no lockfile.
- Bom, porque nenhum código de dependência roda na instalação sem revisão.
- Ruim, porque correções urgentes de segurança podem esbarrar nos 7 dias; nesse caso o
  `pnpm audit --fix` grava `minimumReleaseAgeExclude` com a versão exata, revisada no PR.
- Ruim, porque cada pacote novo com script de build exige uma decisão explícita em `allowBuilds`.

### Confirmação

- `pnpm install --frozen-lockfile` no CI falha diante de qualquer violação.
- `pnpm check-lockfile` no pre-commit e no CI.
- `corepack pnpm --dir tools/vercel-cli install --frozen-lockfile` nos jobs de deploy falha se o
  lockfile isolado do CLI sair da política.
- `uv sync --frozen` no job `python` do `ci.yml`.
- `pnpm audit --prod --audit-level low` e `pnpm audit signatures` no CI; osv-scanner e
  dependency-review no `security.yml`.

## Opções descartadas

- **npm com `overrides`**: não tem maturidade mínima, política de proveniência nem allowlist de
  scripts nativas; dependeria de ferramentas externas.
- **Yarn Berry**: políticas via plugins, com mais superfície e menos alinhamento com o Dependabot.

## Mais informações

- Documentação do pnpm 12 (via Context7 `/pnpm/pnpm/v12.15.0`): `trustPolicy`,
  `trustPolicyExclude`, `minimumReleaseAge`, `blockExoticSubdeps`, `allowBuilds`, `catalogMode`.
- Documentação do uv (via Context7 `/astral-sh/uv/0.13.5`): "Dependency cooldowns",
  `exclude-newer` com duração relativa e `exclude-newer-package`.
- Documentação da Vercel (via Context7 `/websites/vercel`): API do pacote `@vercel/functions`.
- Metadados do registro npm (`npm view <pacote>@<versão> --json`, 2026-11-10): `dist.attestations`
  e `_npmUser` de `@vercel/functions` 3.7.5 a 3.11.1 e de `vercel` 65.11.0.
- Mudança OpenSpec `scaffold-monorepo`, capability `dependency-supply-chain`.

## Adendo (2026-11-10): âncora do `out` nas ferramentas de qualidade

O mesmo padrão sem âncora sobrevivia em duas configurações depois da correção do `.gitignore`:
`sonar.exclusions` (`**/out/**`) e o `ignore` do `.jscpd.json`. Os dois tiravam
`apps/api/src/adapters/out` da análise do SonarQube Cloud (issues, cobertura, quality gate) e do
gate de duplicação. Ambos passaram a `apps/web/out/**`. Regra para qualquer ferramenta nova: o
export do Next se exclui pelo caminho completo, nunca por um glob de diretório `out`.

## Adendo (2026-11-11): licenças no dependency-review e remoção do `sharp`

O primeiro run real do PR #1 mostrou duas coisas que a análise local não pegava:

- **`sharp` removido** (`overrides: next>sharp: "-"`). É opcional do Next e só serve à otimização de
  imagens, que o export estático não usa (`images.unoptimized`). Trazia os binários `libvips` sob
  LGPL-3.0.
- **Allowlist de licenças ampliada** com licenças permissivas consolidadas que aparecem nos lockfiles do
  Python e do Vercel CLI: `MIT-CMU` (pillow), `BSL-1.0` (pyclipper) e `CNRI-Python` (regex).
- **Exceções por pacote** (`allow-dependencies-licenses`), em vez de liberar a licença inteira:
  `torch` e `@bytecodealliance/preview2-shim` ("Apache-2.0 WITH LLVM-exception", permissiva, mas sem
  avaliação documentada de `WITH` na action); `typing-extensions` (PSF-2.0 detectada com
  "GPL-1.0-or-later" pelo histórico de licença do Python no texto); `prexit` (WTFPL, permissiva, mas
  vaga). Uma licença nova continua exigindo revisão do CODEOWNER do `.github/`.
