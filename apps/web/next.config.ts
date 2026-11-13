import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

/**
 * Next.js em export estático puro (`output: 'export'`): o build gera só HTML, CSS, JS e fontes em
 * `out/`, sem functions nem edge. Proxy, route handlers, Server Actions, `rewrites()` em produção e
 * `next/image` otimizado ficam de fora por construção. Em produção o `out/` vai para o `static/`
 * do mesmo projeto Vercel da API (`scripts/build-vercel-output.ts`, ADR 0029): a web chama a API
 * na mesma origem (`/api/*`), sem proxy nem CORS.
 *
 * Em `next dev` não há export: o `rewrites()` leva `/api/*` à API local (`pnpm --filter @teko/api
 * dev`, :4000), e o navegador continua vendo uma origem só (:3000), como em produção.
 */

const isDev = process.env.NODE_ENV === 'development'

/** API local do `pnpm dev` (mesma porta padrão de `PORT` em `apps/api/src/config/env.ts`). */
const DEV_API_ORIGIN = 'http://localhost:4000'

/** Variáveis que nunca podem vazar para o bundle, nem por valor nem por nome em `NEXT_PUBLIC_*`. */
const SERVER_ONLY_SECRETS = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY'] as const

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

assertPublicEnvIsSafe(process.env)

const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts')

const nextConfig: NextConfig = {
  ...(isDev
    ? {
        rewrites: async () => [
          { source: '/api/:path*', destination: `${DEV_API_ORIGIN}/api/:path*` },
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
