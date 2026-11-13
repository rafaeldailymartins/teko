# Design

## Contexto

Decisões 1 e 2 da revisão de 2026-11-12, registradas nas ADRs 0029 (web e API na mesma origem) e
0030 (artefatos no GitHub Releases). Os detalhes de rotas, releases e shards estão nas ADRs; aqui
ficam as escolhas que tocam os requisitos.

## Decisões

- **Rotas do estático escritas à mão.** O `@vercel/routing-utils` não tem proveniência
  (ADR 0002). A política (headers, redirect por `Accept-Language`, locales) vive em
  `apps/api/src/adapters/in/http/static-site/policy.ts`, sem imports, e é usada pelo
  `build-vercel-output` (Vercel) e pelo plugin do Plano B (Render), para os dois servirem o export
  do mesmo jeito.
- **`BLOB_STORE` explícito nos workflows.** O padrão do código é `github-releases`, mas o
  `ingest.yml` e o `source-watch.yml` declaram `netlify` até a migração (etapa C1), porque o cache
  do Docling e os snapshots referenciados pelo lock ainda estão no Netlify Blobs. O
  `ci-config.test.sh` cobra as credenciais e as permissões das duas formas, então a etapa C2 é
  trocar o valor e as permissões.
- **Releases por shard.** `sha256(chave) mod shards`, com o nome do asset igual à chave (`/` →
  `__`): reversível sem índice e longe do limite de 1.000 assets por release.
- **Integridade pelo `digest` do GitHub** no download e no upload; a migração confere o sha256 da
  origem contra o do destino depois de gravar.

## Riscos

- O GitHub não documenta o tamanho máximo do nome de asset; o adapter recusa nome acima de 255
  caracteres (as chaves atuais ficam abaixo de ~210).
- "Immutable releases", se ligado no repositório, impediria acrescentar assets a releases
  publicados (desligado em 2026-11-12).

## Fontes Context7

- `/websites/vercel`: Build Output API v3 (`config.json`, `routes`, `handle: filesystem`, `has`
  com `host` e `header`, `MatchableValue`, `continue`, `status` com `Location`, `caseSensitive`,
  diretório `static/`).
- `/websites/github_en_rest`: Releases e release assets (criar com `prerelease` e `make_latest`,
  release por tag, upload em `uploads.github.com`, 422 de nome repetido, `digest`, download com
  `Accept: application/octet-stream`).
- `/websites/render`: Blueprint (`render.yaml`) e rewrites de static site (avaliados para o Plano
  B; adotado o serviço único com o `@fastify/static`).
