import type { Metadata } from 'next'
import { TekoWordmark } from '@/components/brand/teko-logo'
import { routing } from '@/lib/i18n/routing'
import { MAIN_CONTENT_ID, SITE_ICONS } from '@/lib/site'
import { BareDocument } from './bare-document.tsx'
import { loadAllCatalogs, pickFromCatalogs } from './catalogs.ts'

/**
 * Título nos dois idiomas (WCAG 2.4.2) e `noindex`: a página só faz sentido durante o lockdown. Os
 * ícones de `SITE_ICONS` ficam fora da lista que o lockdown deixa passar; durante ele, o navegador
 * só não mostra o ícone.
 */
export async function generateLockdownNoticeMetadata(): Promise<Metadata> {
  const catalogs = await loadAllCatalogs()
  const titles = pickFromCatalogs(catalogs, (messages) => messages.lockdown.title)
  return {
    title: `${titles['pt-BR']} / ${titles.en}`,
    icons: SITE_ICONS,
    robots: { index: false, follow: false },
  }
}

/**
 * Página de aviso do lockdown (`out/aviso/index.html`), fora de qualquer locale e nos dois idiomas.
 * No lockdown, o WAF redireciona para cá tudo que não é `/healthz`, `/api/healthz`, esta página,
 * `/_next/static/*` e `/favicon.ico`: por isso ela não tem sessão, não chama a API e não leva a
 * nenhum outro caminho do site. O CSS e as fontes vêm de `/_next/static/`; o texto fica legível
 * mesmo se eles faltarem.
 */
export async function LockdownNoticePage() {
  const catalogs = await loadAllCatalogs()
  const titles = pickFromCatalogs(catalogs, (messages) => messages.lockdown.title)

  return (
    <BareDocument>
      <main
        id={MAIN_CONTENT_ID}
        className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 px-5 py-16"
      >
        <TekoWordmark />
        <h1 className="text-balance font-semibold font-serif text-3xl tracking-tight">
          <span lang="pt-BR">{titles['pt-BR']}</span> / <span lang="en">{titles.en}</span>
        </h1>
        <div className="grid gap-6 sm:grid-cols-2">
          {routing.locales.map((locale) => (
            <div key={locale} lang={locale} className="flex flex-col gap-3 text-pretty">
              <p>{catalogs[locale].lockdown.reason}</p>
              <p className="text-muted-foreground">{catalogs[locale].lockdown.comeback}</p>
            </div>
          ))}
        </div>
      </main>
    </BareDocument>
  )
}
