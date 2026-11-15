/**
 * Densidade da interface (`data-density` no `<html>`), guardada em `localStorage` como o tema.
 *
 * - `comfortable` (padrão) não escreve nada no DOM;
 * - `compact` grava `data-density="compact"`, e o `globals.css` reduz o espaçamento base.
 *
 * O script de bootstrap do tema (`THEME_BOOTSTRAP_SCRIPT`, em `theme.ts`) aplica a densidade salva
 * antes da primeira pintura, sem salto de layout.
 */

export const DENSITY_STORAGE_KEY = 'teko-density'

export const DENSITY_ATTRIBUTE = 'data-density'

export const Density = {
  Comfortable: 'comfortable',
  Compact: 'compact',
} as const

export type Density = (typeof Density)[keyof typeof Density]

export const DENSITY_OPTIONS: readonly Density[] = [Density.Comfortable, Density.Compact]

/** Lê um valor não confiável (storage) e cai em `comfortable` quando não reconhece. */
export function parseDensity(value: unknown): Density {
  return value === Density.Compact ? Density.Compact : Density.Comfortable
}

/** Evento disparado na `window` quando a densidade muda nesta aba (o `storage` cobre as outras). */
export const DENSITY_CHANGE_EVENT = 'teko-density-change'

/** Densidade salva; storage ausente ou bloqueado vale `comfortable`. */
export function readDensity(storage: Pick<Storage, 'getItem'> | null): Density {
  try {
    return parseDensity(storage?.getItem(DENSITY_STORAGE_KEY))
  } catch {
    return Density.Comfortable
  }
}

interface DensityTarget {
  readonly storage: Pick<Storage, 'setItem' | 'removeItem'> | null
  readonly root: Pick<Element, 'setAttribute' | 'removeAttribute'>
}

/** Aplica e grava a densidade; falha de storage não impede a troca na página atual. */
export function applyDensity(density: Density, { storage, root }: DensityTarget): void {
  const compact = density === Density.Compact
  if (compact) {
    root.setAttribute(DENSITY_ATTRIBUTE, density)
  } else {
    root.removeAttribute(DENSITY_ATTRIBUTE)
  }
  try {
    if (compact) {
      storage?.setItem(DENSITY_STORAGE_KEY, density)
    } else {
      storage?.removeItem(DENSITY_STORAGE_KEY)
    }
  } catch {
    // Modo privado ou cookies bloqueados: a densidade vale só até a página recarregar.
  }
}

/** Assina as mudanças de densidade (desta aba e das outras); devolve o cancelamento. */
export function subscribeDensity(target: EventTarget, onChange: () => void): () => void {
  const onStorage = (event: Event) => {
    const { key } = event as StorageEvent
    if (key === null || key === DENSITY_STORAGE_KEY) {
      onChange()
    }
  }
  target.addEventListener(DENSITY_CHANGE_EVENT, onChange)
  target.addEventListener('storage', onStorage)
  return () => {
    target.removeEventListener(DENSITY_CHANGE_EVENT, onChange)
    target.removeEventListener('storage', onStorage)
  }
}
