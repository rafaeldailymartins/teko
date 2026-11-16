import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Textarea do shadcn (estilo base-nova), com altura que acompanha o conteúdo. */
function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'field-sizing-content flex min-h-16 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none transition-[color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
