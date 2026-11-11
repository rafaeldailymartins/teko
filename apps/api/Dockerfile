# Imagem da API do Tekó SÓ para a stack efêmera de CI (infra/ci: e2e, k6, ZAP, evals) e para
# rodar localmente em Docker. Nunca é publicada: produção e staging rodam na Vercel (Build Output
# API com o mesmo bundle do tsdown, scripts/build-vercel-output.ts) e o Plano B no Render (build nativo do Render). O runner do
# Actions é amd64, a arquitetura-alvo; a imagem não depende de arm64.
#
# Build a partir da RAIZ do monorepo (o contexto precisa de pnpm-lock.yaml e packages/shared):
#
#   docker build -f apps/api/Dockerfile \
#     --build-arg APP_VERSION=0.1.0 --build-arg GIT_SHA=$(git rev-parse HEAD) \
#     -t teko-api:ci .
#
# O processo roda com RUNTIME_TARGET=node (padrão, só com APP_ENV development ou ci; staging e
# produção recusam node no boot): trustProxy na rede do Caddy da stack de CI, encerramento gracioso
# no SIGTERM e /healthz em 503 durante a drenagem.
#
# O BuildKit usa apps/api/Dockerfile.dockerignore (arquivo de ignore específico deste Dockerfile).
#
# - builder: node:24-trixie-slim, pnpm via corepack (versão do `packageManager` da raiz),
#   bundle com tsdown e `pnpm deploy --prod` (só dependências de produção);
# - runtime: distroless nodejs24-debian13:nonroot (sem shell, sem gerenciador de pacotes, UID
#   65532). O ENTRYPOINT da imagem já é /nodejs/bin/node, então o CMD é só o script.
#
# Bases fixadas por digest do índice de manifestos (o mesmo digest resolve a variante amd64 do
# runner); o Dependabot atualiza.

ARG BUILDER_IMAGE=node:24-trixie-slim@sha256:0820eaa85e07d0490446dd01d14707e17e6108a36988cf374899cd057eb3812d
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian13:nonroot@sha256:088a01637f22908632ba09018be2e0b516f2fa6f7869c191d29491139db43c78

FROM ${BUILDER_IMAGE} AS build

ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_STORE_DIR=/pnpm/store

WORKDIR /repo
RUN corepack enable

# 1) Manifestos e lockfile: a camada de instalação só é refeita quando eles mudam.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# --ignore-scripts: nenhum script de dependência roda no build (o `prepare` da raiz instala hooks
# do lefthook, inútil aqui). --frozen-lockfile: o lockfile é a única fonte de versões.
RUN --mount=type=cache,id=teko-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --store-dir /pnpm/store --filter "@teko/api..."

# 2) Fontes e build (o tsdown embute @teko/shared no bundle).
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/
RUN pnpm --filter @teko/api build

# 3) Só as dependências de produção da API, num diretório isolado.
RUN --mount=type=cache,id=teko-pnpm-store,target=/pnpm/store \
    pnpm --filter @teko/api --prod deploy --ignore-scripts --store-dir /pnpm/store /out

FROM ${RUNTIME_IMAGE} AS runtime

ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown

LABEL org.opencontainers.image.title="teko-api" \
      org.opencontainers.image.description="API do Tekó (Fastify, arquitetura hexagonal)" \
      org.opencontainers.image.source="https://github.com/rafaeldailymartins/teko" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA}

WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist

USER 65532:65532
EXPOSE 4000

# Exec-form: a distroless não tem shell nem curl. Nunca toca o banco (só /healthz).
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["dist/server.mjs"]
