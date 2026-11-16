import { useId } from 'react'
import { PRODUCT_NAME } from '@/lib/site'
import { cn } from '@/lib/utils'

/**
 * Cores da logo (`docs/assets/logo.svg`). O selo é uma peça da marca com as próprias cores, igual nos
 * dois temas (como o favicon); a UI em volta usa os tokens de `globals.css`.
 */
const LOGO = {
  petrolFrom: '#005766',
  petrolTo: '#003540',
  leafFrom: '#38a37a',
  leafTo: '#7fd8c8',
  amber: '#e0a53b',
  white: '#ffffff',
} as const

/**
 * - `seal`: o selo completo da logo (fundo petróleo, anel, duas folhas, a linha do tempo e a data).
 * - `mark`: o ícone compacto para tamanhos pequenos (cabeçalho, botões): sem o anel e com uma folha
 *   só, traços mais grossos para continuar legível em 20–32 px.
 */
type TekoLogoVariant = 'seal' | 'mark'

interface TekoLogoProps {
  readonly variant?: TekoLogoVariant
  /** Nome acessível. Sem ele, a logo é decorativa (`aria-hidden`), ao lado de um texto que a nomeia. */
  readonly title?: string
  readonly className?: string
}

/**
 * A logo do Tekó em SVG inline: um T cuja barra é uma linha do tempo, com a data de referência em
 * âmbar no centro e folhas brotando da haste. Sem `<style>` (a CSP barra estilo injetado); os
 * gradientes ficam em `<defs>`, com ids únicos por instância (`useId`), para várias logos na mesma
 * página não se cruzarem.
 */
export function TekoLogo({ variant = 'mark', title, className }: TekoLogoProps) {
  const id = useId()
  const petrol = `${id}-petrol`
  const leaf = `${id}-leaf`
  const glow = `${id}-glow`

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      className={cn('shrink-0', className)}
      data-variant={variant}
      role="img"
      aria-label={title}
      aria-hidden={title === undefined ? true : undefined}
      focusable="false"
    >
      {/* Também a dica do mouse; sem `title`, o SVG inteiro fica fora da árvore acessível. */}
      <title>{title ?? PRODUCT_NAME}</title>
      <defs>
        <linearGradient id={petrol} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={LOGO.petrolFrom} />
          <stop offset="1" stopColor={LOGO.petrolTo} />
        </linearGradient>
        <linearGradient id={leaf} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={LOGO.leafFrom} />
          <stop offset="1" stopColor={LOGO.leafTo} />
        </linearGradient>
        <radialGradient id={glow} cx="0.3" cy="0.2" r="0.9">
          <stop offset="0" stopColor={LOGO.white} stopOpacity="0.16" />
          <stop offset="1" stopColor={LOGO.white} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="256" height="256" rx="60" fill={`url(#${petrol})`} />
      <rect width="256" height="256" rx="60" fill={`url(#${glow})`} />
      {variant === 'seal' ? (
        <>
          <circle
            cx="128"
            cy="132"
            r="92"
            fill="none"
            stroke={LOGO.white}
            strokeOpacity="0.07"
            strokeWidth="2"
          />
          <path
            d="M132 170 C132 136 154 114 192 110 C192 148 170 168 132 170 Z"
            fill={`url(#${leaf})`}
          />
          <path
            d="M136 164 C150 144 164 130 184 118"
            fill="none"
            stroke={LOGO.petrolTo}
            strokeOpacity="0.35"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M124 196 C124 172 108 156 80 153 C80 180 96 195 124 196 Z"
            fill={`url(#${leaf})`}
            opacity="0.85"
          />
          <path
            d="M120 191 C110 177 100 167 87 160"
            fill="none"
            stroke={LOGO.petrolTo}
            strokeOpacity="0.35"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path d="M128 92 V206" stroke={LOGO.white} strokeWidth="16" strokeLinecap="round" />
          <path d="M54 82 H202" stroke={LOGO.white} strokeWidth="16" strokeLinecap="round" />
          <circle cx="74" cy="82" r="7" fill={LOGO.petrolFrom} />
          <circle cx="182" cy="82" r="7" fill={LOGO.petrolFrom} />
          <circle cx="128" cy="82" r="21" fill={LOGO.amber} stroke={LOGO.white} strokeWidth="7" />
          <circle cx="128" cy="82" r="6" fill={LOGO.white} />
        </>
      ) : (
        <>
          <path
            d="M136 178 C136 140 160 116 202 112 C202 154 178 176 136 178 Z"
            fill={`url(#${leaf})`}
          />
          <path d="M128 96 V210" stroke={LOGO.white} strokeWidth="24" strokeLinecap="round" />
          <path d="M46 86 H210" stroke={LOGO.white} strokeWidth="24" strokeLinecap="round" />
          <circle cx="128" cy="86" r="27" fill={LOGO.amber} stroke={LOGO.white} strokeWidth="10" />
        </>
      )}
    </svg>
  )
}

interface TekoWordmarkProps {
  readonly className?: string
  /** Classe do ícone (tamanho). */
  readonly logoClassName?: string
}

/**
 * Wordmark: o ícone compacto e "Tekó" em serif. O texto já nomeia a marca, então o ícone é
 * decorativo; quem usa o wordmark num link dá o nome acessível do destino.
 */
export function TekoWordmark({ className, logoClassName }: TekoWordmarkProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <TekoLogo className={cn('size-7 drop-shadow-sm', logoClassName)} />
      <span className="font-semibold font-serif text-[1.375rem] leading-none tracking-tight">
        {PRODUCT_NAME}
      </span>
    </span>
  )
}
