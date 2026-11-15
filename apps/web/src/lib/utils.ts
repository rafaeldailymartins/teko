import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Junta classes condicionais (clsx) e resolve conflitos de utilitários do Tailwind (tailwind-merge):
 * `cn('px-2', isWide && 'px-4')` fica `px-4`. É o utilitário que os componentes do shadcn esperam.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
