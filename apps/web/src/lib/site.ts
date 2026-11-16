/** Nome exibido do produto (com acento). Identificadores técnicos usam `teko`. */
export const PRODUCT_NAME = 'Tekó'

/** Origem pública de produção (web e API, ADR 0029): base de URLs absolutas (canonical, Open Graph). */
export const SITE_ORIGIN = 'https://tekoia.vercel.app'

/** Repositório público (licença MIT). */
export const REPOSITORY_URL = 'https://github.com/rafaeldailymartins/teko'

/**
 * Ícones do site (`metadata.icons`), gerados da logo por `scripts/brand-assets.ts` em `public/`:
 * o favicon em SVG e o ícone da Apple em 180 × 180.
 */
export const SITE_ICONS = {
  icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
  apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
}

/** Issues do repositório (reportar um problema). */
export const ISSUES_URL = `${REPOSITORY_URL}/issues`

/** Texto da licença MIT no repositório. */
export const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`

/** Âncora do conteúdo principal, alvo do skip link de todas as páginas. */
export const MAIN_CONTENT_ID = 'conteudo'
