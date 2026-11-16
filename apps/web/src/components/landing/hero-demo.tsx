'use client'

import { type ComponentType, type ReactNode, useEffect, useState } from 'react'
import { REDUCED_MOTION_QUERY } from '@/lib/landing/motion'
import type { HeroDemoProps } from './demo-view.tsx'

type Animator = ComponentType<HeroDemoProps>

/** Carrega o animador (chunk à parte). Injetável nos testes. */
type AnimatorLoader = () => Promise<{ default: Animator }>

const loadAnimator: AnimatorLoader = () =>
  import('./chat-demo.tsx').then((module) => ({ default: module.HeroStage }))

interface HeroDemoMountProps extends HeroDemoProps {
  /** O quadro final, renderizado no servidor: o HTML estático e o que fica com movimento reduzido. */
  readonly children: ReactNode
  readonly load?: AnimatorLoader
}

/**
 * Ponto de montagem da demonstração no hero. Mostra o quadro final que veio do servidor e, depois da
 * hidratação e só sem movimento reduzido, carrega o animador num `import()` (fora do JavaScript do
 * primeiro acesso), que assume a partir do mesmo quadro.
 */
export function HeroDemoMount({ children, load = loadAnimator, ...props }: HeroDemoMountProps) {
  const [Animated, setAnimated] = useState<Animator | null>(null)

  useEffect(() => {
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) return
    let live = true
    void load().then((module) => {
      if (live) setAnimated(() => module.default)
    })
    return () => {
      live = false
    }
  }, [load])

  return Animated === null ? children : <Animated {...props} />
}
