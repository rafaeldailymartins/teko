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
`pnpm-lock.yaml` e `tools/vercel-cli/pnpm-lock.yaml`; nenhum caminho vem da linha de comando. Com
o spike F1 (a), a lista ganhou `tools/netlify-cli/pnpm-lock.yaml`.

### Exceções

| Exceção                                                                    | Detalhe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Revisão                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `lefthook` fixado em **2.2.1** (plano: 2.2.2)                              | A 2.2.2 foi publicada **sem** proveniência SLSA, enquanto 2.2.0 e 2.2.1 têm; o `trustPolicy: no-downgrade` a recusa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Subir quando sair uma versão com proveniência                          |
| `@vercel/functions` fixado em **3.7.6**                                    | Última versão com proveniência SLSA; todas as seguintes saíram só com trusted publisher (ver "Vercel" abaixo). Nenhuma exceção no workspace da aplicação                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Subir quando a Vercel voltar a publicar com proveniência               |
| Projeto isolado `tools/vercel-cli`                                         | O Vercel CLI e seus `@vercel/*` exigem exceções de `trustPolicy`, confinadas a um projeto pnpm à parte (ver "Vercel" abaixo)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Remover as exceções quando a Vercel voltar a publicar com proveniência |
| Projeto isolado `tools/netlify-cli`                                        | O Netlify CLI 27.16.2 e a árvore dele (835 pacotes) ficam fora do workspace da aplicação, com duas exceções de versão exata (ver "Netlify" abaixo)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | A cada atualização do CLI                                              |
| `@netlify/plugin-nextjs` **5.16.6** no `@teko/web`                         | Sem a declaração, a Netlify instala o plugin sozinha, do npm e sem versão fixa (ver "Netlify" abaixo)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Dependabot, com o cooldown de 7 dias                                   |
| `pg` **8.23.1** (F2)                                                       | Nenhum driver Postgres do npm é publicado com proveniência (`pg`, `postgres` 3.4.9/4.0.0 e `@neondatabase/serverless` 1.2.0, conferidos em 2026-11-11). O `pg` é o único com `attachDatabasePool` e `drizzle-orm/node-postgres`; a árvore dele (`pg-pool`, `pg-protocol`, `pg-types`...) também não tem proveniência. O `no-downgrade` aceita pacote que nunca teve                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Quando algum driver passar a publicar com proveniência                 |
| `testcontainers` e `@testcontainers/postgresql` **12.2.1** (F2, só testes) | Sem proveniência. `allowBuilds` nega `ssh2`, `cpu-features` (aceleradores nativos opcionais, com fallback em JS) e `protobufjs` (o postinstall só confere o CLI dele)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | A cada atualização                                                     |
| `yaml` **2.9.1** (F2, só evals e testes)                                   | Sem proveniência, mas já vinha na árvore (promptfoo e outros); declarado para ler o `golden.yaml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | A cada atualização                                                     |
| `promptfoo` **0.125.1** (F2, só evals)                                     | Tem proveniência SLSA. Na árvore dele: `allowBuilds` nega o `esbuild` (o binário vem por `optionalDependencies`), e dois overrides escopados corrigem achados do `pnpm audit`: `glob` 14.0.3 em `promptfoo>glob` (GHSA de AbortSignal, moderate) e `basic-ftp` 6.2.5 em `get-uri>basic-ftp` (DoS no parser de listagem, high), e `@hono/node-server` 2.1.6 no lugar do 2.1.5 que o promptfoo fixa (GHSA-jpvv-r467-5p4w e GHSA-qv5m-9pm6-hqp3, moderate, desde 2026-11-12); o mesmo `glob` 14.0.3 em `archiver-utils>glob` (via Testcontainers). Opcionais sem uso nas evals e com licença fora da allowlist saem por override (`sharp`, `pdf-parse`, `@aws/bedrock-token-generator`, `@modelcontextprotocol/server-filesystem`); os obrigatórios com licença fora da lista (Artistic-2.0 da família `istextorbinary`, `json-schema`, `json-schema-typed`, `big-integer`) são exceções por pacote no `dependency-review`, cada uma justificada no `security.yml` | Remover os overrides quando o upstream subir as versões                |

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

### Netlify: `tools/netlify-cli` e o plugin do Next (adendo de 2026-11-11, spike F1 (a))

- **Netlify CLI 27.16.2 em `tools/netlify-cli`**, no mesmo modelo do `tools/vercel-cli`: projeto
  pnpm isolado, lockfile próprio, Dependabot à parte, `pnpm audit --audit-level low` no CI e
  instalado só nos jobs de deploy. A 27.17.0 citada no plano saiu em 2026-11-10 e ainda não tinha 7
  dias; a 27.16.2 (2026-11-02) tem proveniência SLSA. Exceções, todas revisadas no registro:

  | Exceção                                                                                            | Motivo                                                                                                                                                                                                                                                                                                                  |
  | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `trustPolicyExclude: "@netlify/serverless-functions-api@2.24.0"` e `@2.28.1`                       | O pacote teve proveniência só em 2023 (1.3.0 a 1.5.2) e nenhuma versão desde então tem proveniência nem trusted publisher; é um estado antigo, não uma troca recente de publicador. Uma varredura da árvore inteira do CLI (835 nomes) não achou outro rebaixamento                                                     |
  | `allowBuilds`: `esbuild`, `netlify-cli` e `unix-dgram` em `false`                                  | `esbuild` recebe o binário pelas `optionalDependencies`; o `postinstall` do CLI só instala autocomplete no shell e imprime um banner; `unix-dgram` é addon nativa opcional do `hot-shots` (statsd por socket Unix), que o deploy não usa                                                                                |
  | `overrides`: `glob` ^14.0.2 e `minimatch` ^11.0.1                                                  | GHSA-3g3m-2fjr-6pw4 e GHSA-g3hv-75wg-m249 (moderate); cruzam major, como no `tools/vercel-cli`                                                                                                                                                                                                                          |
  | `auditConfig.ignoreGhsas` e `allow-ghsas` do `dependency-review`: GHSA-gcqx-w48m-w2h4              | `deepmerge` 4.3.1 (low) não tem versão corrigida; só o `@netlify/config` o usa, para mesclar o `netlify.toml` do próprio repositório. O grafo de dependências do GitHub o marca como `runtime`, então o `fail-on-scopes: runtime` não basta                                                                             |
  | `overrides`: `sharp` e `@netlify/redirect-matcher` em `"-"`                                        | Licenças fora da allowlist do `dependency-review`: `sharp`/libvips (LGPL-3.0), via `ipx` ← `@netlify/images`, e `@netlify/redirect-matcher` (UNLICENSED), via `@netlify/redirects` ← `@netlify/dev`. Os dois só servem ao `netlify dev`; saem da árvore, como o `next>sharp` da raiz. Build e deploy validados sem eles |
  | `allow-dependencies-licenses` do `dependency-review`: `normalize-package-data` e `spdx-exceptions` | Do núcleo do CLI (`@netlify/build-info`, `@netlify/config`), sem como removê-los. O `normalize-package-data` declara BSD-2-Clause, e a detecção do GitHub acrescenta "BSD-3-Clause AND JSON"; o `spdx-exceptions` (CC-BY-3.0) só contém a lista de dados SPDX                                                           |

- **`@netlify/plugin-nextjs` 5.16.6** (proveniência SLSA, 0 dependências, MIT) no catálogo, como
  devDependency do `@teko/web` e em `[[plugins]]` do `apps/web/netlify.toml`. O spike mostrou que,
  ao detectar o Next, o `netlify build` baixa o plugin do npm sem versão fixa para
  `apps/web/.netlify/plugins` e roda o `onPreBuild` dele, mesmo com `NETLIFY_NEXT_PLUGIN_SKIP`
  (que só desliga a lógica do plugin). Declarado, ele é resolvido do `package.json`
  (`loadedFrom: package.json` no `@netlify/build`), sob esta política; o skip continua desligando
  a lógica. O workflow do spike falha se a pasta de instalação automática aparecer.

### Python (`tools/ingest`)

O uv não tem `trustPolicy`, mas tem cooldown: `exclude-newer` em `[tool.uv]` aceita uma duração
relativa ("friendly", como `1 week` ou `7 days`, ou ISO 8601, como `P7D`), conferida no Context7
`/astral-sh/uv/0.13.5`. A regra do projeto é a mesma do pnpm: **nenhuma versão com menos de 7
dias**. O `pyproject.toml` de `tools/ingest` declara `exclude-newer = "7 days"` (configurado pelo
stream de ingestão), o `uv.lock` é gerado sob essa regra e o CI usa `uv sync --frozen`. Exceções
usam `exclude-newer-package` com a versão exata e justificativa nesta ADR.

### Ferramentas da raiz ligadas à política

- **Hooks pelo `node_modules/.bin`.** O `lefthook.yml` chama `./node_modules/.bin/<binário>` (Biome,
  OpenSpec, turbo) em vez de `pnpm exec`, para funcionar mesmo sem `corepack enable`
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
- `pnpm audit signatures` no job `lint` do PR; `pnpm audit --prod --audit-level low` (e o dos CLIs
  isolados) no `audit.yml`, em push, todo dia e nos deploys (ADR 0032); osv-scanner e
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

## Adendo (2026-11-12): CI enxuto ([ADR 0032](0032-gates-e-ferramentas-enxutos.md))

- **Sem `trustPolicyExclude` no workspace da aplicação.** O Steiger saiu (o web deixa o
  Feature-Sliced Design), e com ele a única exceção, `chokidar@4.0.3`. A linha da tabela de
  versões seguradas em 2026-11-10 fica como registro histórico.
- **Sem commitlint.** O hook `commit-msg` saiu; tipos e escopos ficam em `.github/commit-types.json`,
  lido pelo check `pr-title`, e o DCO é conferido pelo check `dco`. Saem `@commitlint/cli` e
  `@commitlint/config-conventional` do catálogo.
- **`pnpm audit` fora do PR.** Os advisories são conferidos pelo `audit.yml` (push, todo dia e, na
  F7, antes de cada deploy); no PR ficam o `dependency-review` e o `pnpm audit signatures`.
- **Sem `pip-audit`.** O osv-scanner do `security.yml` já audita o `uv.lock` inteiro.
