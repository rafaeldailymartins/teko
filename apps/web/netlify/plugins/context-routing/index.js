/**
 * Plugin local da Netlify, só de configuração: injeta o proxy assinado `/api/*` → API do contexto.
 *
 * - O `signed` (JWS HS256 no header `x-nf-sign`) só é aceito em `netlify.toml`/`netlifyConfig`,
 *   nunca em `_redirects`; por isso a regra nasce aqui, antes das demais (`unshift`).
 * - `NETLIFY_PROXY_JWS_SECRET` tem escopo Runtime e valor distinto por contexto; a API rejeita
 *   assinatura de outro contexto (`deploy_context` no JWS).
 * - `TEKO_API_PROXY_TARGET` permite apontar para outra origem sem mudar código (ex.: plano B).
 */

const API_ORIGINS = {
  production: 'https://teko-api.vercel.app',
  staging: 'https://teko-api-staging.vercel.app',
}

/** Origem https sem caminho, ou `null` se o valor não serve como alvo do proxy. */
function toHttpsOrigin(value) {
  const url = URL.parse(value)
  return url && url.protocol === 'https:' && url.origin === value ? url.origin : null
}

export const onPreBuild = ({ netlifyConfig, utils }) => {
  const configured = process.env.TEKO_API_PROXY_TARGET
  const fallback =
    process.env.CONTEXT === 'production' ? API_ORIGINS.production : API_ORIGINS.staging
  const target = toHttpsOrigin(configured ?? fallback)
  if (!target) {
    utils.build.failBuild(
      `TEKO_API_PROXY_TARGET inválido: "${configured}" (esperado https://host).`,
    )
    return
  }
  netlifyConfig.redirects.unshift({
    from: '/api/*',
    to: `${target}/api/:splat`,
    status: 200,
    force: true,
    signed: 'NETLIFY_PROXY_JWS_SECRET',
  })
}
