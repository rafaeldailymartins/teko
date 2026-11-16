import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * O tailwind-merge com os tokens próprios do tema (`globals.css`): sem isto, `shadow-soft` e
 * `shadow-raised` seriam lidos como cor de sombra, e `shadow-none` não os anularia.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ['soft', 'raised', 'overlay'],
      ease: ['out-soft'],
      animate: ['timeline'],
    },
  },
})

/**
 * Junta classes condicionais (clsx) e resolve conflitos de utilitários do Tailwind (tailwind-merge):
 * `cn('px-2', isWide && 'px-4')` fica `px-4`. É o utilitário que os componentes do shadcn esperam.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
