export {
  generateNotFoundMetadata as generateMetadata,
  NotFoundPage as default,
} from '@/pages/not-found'

/**
 * Gera só `/<locale>/404/`: o `_redirects` da Netlify serve esse arquivo, com status 404, para
 * qualquer caminho inexistente dentro do locale. Outros valores de `rest` não existem no export.
 */
export const dynamicParams = false

export function generateStaticParams(): { rest: string[] }[] {
  return [{ rest: ['404'] }]
}
