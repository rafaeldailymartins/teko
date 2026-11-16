import { CheckIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * Caixa de seleção nativa (`<input type="checkbox">`, com `required`, formulário e teclado do
 * navegador) no acabamento do Tekó: borda de campo (≥ 3:1), marcada na primária com o visto por
 * cima, e o anel de foco do design system.
 */
export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <span className="relative inline-flex size-5 shrink-0">
      <input
        type="checkbox"
        data-slot="checkbox"
        className={cn(
          'peer size-5 cursor-pointer appearance-none rounded-[0.3125rem] border border-input bg-popover shadow-soft outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-out-soft checked:border-primary checked:bg-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
      <CheckIcon
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute inset-0.5 size-4 scale-75 text-primary-foreground opacity-0 transition-[opacity,transform] duration-150 ease-out-soft peer-checked:scale-100 peer-checked:opacity-100"
      />
    </span>
  )
}
