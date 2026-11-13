export {
  generateNotFoundMetadata as generateMetadata,
  NotFoundPage as default,
} from '@/components/not-found-page'

/**
 * Gera só `/<locale>/404/`: a rota de 404 do `config.json` da Vercel
 * (`scripts/build-vercel-output.ts`) serve esse arquivo, com status 404, para qualquer caminho
 * inexistente dentro do locale. Outros valores de `rest` não existem no export.
 */
export const dynamicParams = false

export function generateStaticParams(): { rest: string[] }[] {
  return [{ rest: ['404'] }]
}
