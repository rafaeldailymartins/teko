import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Botão do shadcn (registry Base UI, estilo base-nova) com o acabamento do Tekó: foco em anel
 * sólido com recuo (`--ring`, ≥ 3:1 nos dois temas), sombra suave nas variantes cheias e
 * transições curtas. `buttonVariants` também estiliza links que parecem botão
 * (`<a className={buttonVariants()}>`), sem aninhar elementos interativos.
 *
 * - `default`: ação principal, na primária;
 * - `brand`: chamada da marca ("Abrir o Tekó"), no gradiente petróleo da logo;
 * - `outline`, `secondary`, `ghost`, `destructive` e `link`: como no shadcn.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg border border-transparent bg-clip-padding font-medium text-sm outline-none transition-[color,background-color,border-color,box-shadow,filter,transform] duration-150 ease-out-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-soft hover:bg-primary/88',
        brand:
          'bg-brand-gradient text-brand-foreground shadow-raised hover:brightness-115 hover:saturate-125',
        outline:
          'border-border-strong/45 bg-popover shadow-soft hover:border-border-strong/70 hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/18 focus-visible:ring-destructive',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5',
        sm: "h-8 gap-1.5 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8125rem] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-11 gap-2 px-5 text-[0.9375rem] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4',
        icon: 'size-9',
        'icon-sm': 'size-8 rounded-[min(var(--radius-md),12px)]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
