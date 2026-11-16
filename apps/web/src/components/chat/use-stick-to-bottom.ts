'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

/** Distância do fim (px) em que a conversa ainda conta como "no fim". */
const NEAR_END = 96

/** Contêiner de rolagem da conversa (o painel central da área de trabalho) ou a página. */
function scrollerOf(element: HTMLElement | null): HTMLElement | null {
  return element?.closest<HTMLElement>('[data-workspace-thread]') ?? null
}

interface StickToBottom {
  /** A conversa está no fim (ou perto dele). */
  readonly atEnd: boolean
  /** Vai até o fim e volta a acompanhar o stream. */
  readonly scrollToEnd: (behavior?: ScrollBehavior) => void
}

/**
 * Rolagem automática da conversa só enquanto o usuário está no fim: a cada pedaço do stream
 * (`contentKey`), a conversa desce até o fim; se ele subir para reler, ela fica onde ele parou e
 * `atEnd` vira `false` (a UI mostra "Ir para o fim"). Rola até o `scrollHeight`, não até um marcador,
 * para o composer fixo embaixo não cobrir o fim da resposta.
 */
export function useStickToBottom(
  anchorRef: RefObject<HTMLElement | null>,
  contentKey: string,
): StickToBottom {
  const stuck = useRef(true)
  const [atEnd, setAtEnd] = useState(true)

  useEffect(() => {
    const scroller = scrollerOf(anchorRef.current)
    if (scroller === null) return
    function onScroll(): void {
      if (scroller === null) return
      const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      stuck.current = distance <= NEAR_END
      setAtEnd(stuck.current)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [anchorRef])

  const scrollToEnd = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      stuck.current = true
      setAtEnd(true)
      const scroller = scrollerOf(anchorRef.current)
      scroller?.scrollTo?.({ top: scroller.scrollHeight, behavior })
    },
    [anchorRef],
  )

  useEffect(() => {
    if (contentKey === '' || !stuck.current) return
    const scroller = scrollerOf(anchorRef.current)
    scroller?.scrollTo?.({ top: scroller.scrollHeight })
  }, [anchorRef, contentKey])

  return { atEnd, scrollToEnd }
}
