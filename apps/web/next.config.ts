import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

/**
 * Next.js em export estático puro (`output: 'export'`): o build gera só HTML, CSS, JS e fontes em
 * `out/`, sem functions nem edge. Proxy, route handlers, Server Actions, `rewrites()` em produção e
 * `next/image` otimizado ficam de fora por construção.
 *
 * Em `next dev` não há export: o `rewrites()` leva `/api/*` ao Caddy de dev (:8787), que injeta o
 * `x-nf-sign` como o proxy assinado da Netlify (ver infra/local/Caddyfile).
 */

const isDev = process.env.NODE_ENV === 'development'

/** Variáveis que nunca podem vazar para o bundle, nem por valor nem por nome em `NEXT_PUBLIC_*`. */
const SERVER_ONLY_SECRETS = ['GEMINI_API_KEY', 'OPENAI_API_KEY'] as const

/** Contextos de deploy da Netlify em que o stream precisa de origem própria (ver netlify.toml). */
const DEPLOY_CONTEXTS_REQUIRING_STREAM_ORIGIN = new Set(['production', 'develop'])

function assertPublicEnvIsSafe(env: NodeJS.ProcessEnv): void {
  const publicEntries = Object.entries(env).filter(([name]) => name.startsWith('NEXT_PUBLIC_'))
  for (const secretName of SERVER_ONLY_SECRETS) {
    const secretValue = env[secretName]
    for (const [name, value] of publicEntries) {
      if (name.includes(secretName) || (secretValue && value?.includes(secretValue))) {
        throw new Error(`${name} expõe ${secretName} no bundle do cliente; build abortado.`)
      }
    }
  }
}

function assertStreamOrigin(env: NodeJS.ProcessEnv): void {
  const { NEXT_PUBLIC_STREAM_ORIGIN: origin, CONTEXT: context } = env
  if (!origin) {
    if (context && DEPLOY_CONTEXTS_REQUIRING_STREAM_ORIGIN.has(context)) {
      throw new Error(`NEXT_PUBLIC_STREAM_ORIGIN vazio no contexto "${context}"; build abortado.`)
    }
    return
  }
  const url = URL.parse(origin)
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.origin !== origin) {
    throw new Error(`NEXT_PUBLIC_STREAM_ORIGIN deve ser uma origem (sem caminho): "${origin}".`)
  }
}

assertPublicEnvIsSafe(process.env)
assertStreamOrigin(process.env)

const withNextIntl = createNextIntlPlugin('./src/shared/i18n/request.ts')

const nextConfig: NextConfig = {
  ...(isDev
    ? {
        rewrites: async () => [
          { source: '/api/:path*', destination: 'http://localhost:8787/api/:path*' },
        ],
      }
    : { output: 'export' }),
  trailingSlash: true,
  images: { unoptimized: true },
  // React Compiler 1.0 (babel-plugin-react-compiler): memoização automática em todo componente e
  // hook. Estável e de nível superior desde o Next 16 (antes era `experimental.reactCompiler`).
  reactCompiler: true,
  typedRoutes: true,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@teko/shared'],
}

export default withNextIntl(nextConfig)
