/**
 * Substituto de `next/font/google` nos testes: a transformação real só existe no build do Next
 * (SWC). Cada fonte devolve uma variável CSS previsível, que os testes conferem no `<html>`.
 * Uso: `vi.mock('next/font/google', () => import('<caminho>/test/next-font-google.ts'))`.
 */
const font = (name: string) => () => ({
  variable: `font-var-${name}`,
  className: `font-${name}-class`,
  style: {},
})

export const Geist = font('sans')
export const Geist_Mono = font('mono')
export const Source_Serif_4 = font('serif')
