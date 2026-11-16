'use client'

import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { type CountryOption, searchCountries } from '@/lib/countries'
import { cn } from '@/lib/utils'

interface CountryPickerProps {
  /** `id` do rótulo visível, que dá o nome acessível ao gatilho. */
  readonly labelId: string
  /** `id` da dica sob o campo. */
  readonly hintId: string
  readonly options: readonly CountryOption[]
  readonly value: string
  readonly onChange: (code: string) => void
  readonly disabled?: boolean
}

/**
 * Seletor de país com busca: o gatilho (`role="combobox"`) mostra o país e o código; o popover tem
 * o campo de busca (sem acento nem caixa, por nome ou código) e a lista, com setas e `Enter`.
 */
export function CountryPicker({
  labelId,
  hintId,
  options,
  value,
  onChange,
  disabled = false,
}: CountryPickerProps) {
  const t = useTranslations('onboarding')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = options.find((option) => option.code === value)
  const matches = searchCountries(options, query)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={labelId}
        aria-describedby={hintId}
        className="flex h-11 w-full items-center gap-2.5 rounded-lg border border-input bg-popover px-3.5 text-left text-sm shadow-soft outline-none transition-[border-color,box-shadow] duration-150 ease-out-soft hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-50 data-popup-open:border-ring"
      >
        <span className="min-w-0 flex-1 truncate">{selected?.name ?? value}</span>
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs tabular-nums">
          {value}
        </span>
        <ChevronsUpDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
        <Command shouldFilter={false} loop className="rounded-xl">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('countrySearch')}
            aria-label={t('countrySearch')}
          />
          <CommandList className="max-h-64 p-1">
            <CommandEmpty>{t('countryEmpty')}</CommandEmpty>
            {matches.map((option) => (
              <CommandItem
                key={option.code}
                value={option.code}
                onSelect={() => {
                  onChange(option.code)
                  setOpen(false)
                  setQuery('')
                }}
              >
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                <span className="font-mono text-muted-foreground text-xs tabular-nums">
                  {option.code}
                </span>
                <CheckIcon
                  aria-hidden="true"
                  className={cn('size-4', option.code === value ? 'opacity-100' : 'opacity-0')}
                />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
