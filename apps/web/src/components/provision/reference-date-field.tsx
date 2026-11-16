'use client'

import { type IsoDate, isoDateSchema } from '@teko/shared/vigencia'
import { CalendarIcon } from 'lucide-react'
import { useId } from 'react'
import { cn } from '@/lib/utils'

interface ReferenceDateFieldProps {
  readonly label: string
  readonly value: IsoDate
  readonly onChange: (date: IsoDate) => void
  readonly className?: string
}

/**
 * Campo da data de referência das páginas de dispositivo: o chip âmbar da data (a cor reservada a
 * ela), com o ícone do calendário e o campo nativo de data em mono. Só repassa datas válidas.
 */
export function ReferenceDateField({ label, value, onChange, className }: ReferenceDateFieldProps) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="font-medium text-muted-foreground text-xs">
        {label}
      </label>
      <div className="inline-flex h-10 items-center gap-2 rounded-full border border-accent-border/70 bg-accent pr-2 pl-3.5 text-accent-foreground shadow-soft transition-shadow duration-150 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
        <CalendarIcon aria-hidden="true" className="size-4 shrink-0" />
        <input
          id={id}
          type="date"
          value={value}
          onChange={(event) => {
            const parsed = isoDateSchema.safeParse(event.target.value)
            if (parsed.success) {
              onChange(parsed.data)
            }
          }}
          className="h-full min-w-0 bg-transparent font-medium font-mono text-sm tabular-nums outline-none"
        />
      </div>
    </div>
  )
}
