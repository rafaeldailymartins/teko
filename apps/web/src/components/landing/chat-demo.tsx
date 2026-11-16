'use client'

import { PauseIcon, PlayIcon } from 'lucide-react'
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { useMediaQuery } from '@/components/app-shell/use-media-query'
import { DemoPlayer, PauseReason } from '@/lib/landing/demo-player'
import {
  buildDemoSteps,
  type DemoStep,
  demoScript,
  finalStepIndex,
} from '@/lib/landing/demo-timeline'
import { REDUCED_MOTION_QUERY } from '@/lib/landing/motion'
import { DemoFigure, type HeroDemoProps } from './demo-view.tsx'

/** Quanto o quadro final (o do HTML estático) fica na tela antes da primeira volta. */
const FIRST_HOLD = 2200

/**
 * Toca o roteiro: começa no quadro final (o mesmo do HTML estático) e só anda na tela, com a aba
 * visível, sem pausa do usuário e sem movimento reduzido. Devolve o quadro atual e o controle da
 * pausa.
 */
function useDemoPlayback(steps: readonly DemoStep[], target: RefObject<Element | null>) {
  const finalIndex = finalStepIndex(steps)
  const [index, setIndex] = useState(finalIndex)
  const [userPaused, setUserPaused] = useState(false)
  // No HTML estático vale "reduzido": o quadro final, sem o botão de pausa.
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY, true)
  const player = useRef<DemoPlayer | null>(null)

  useEffect(() => {
    const instance = new DemoPlayer({
      steps,
      finalIndex,
      onStep: setIndex,
      paused: [PauseReason.Offscreen, ...(document.hidden ? [PauseReason.Hidden] : [])],
      firstHold: FIRST_HOLD,
    })
    player.current = instance
    const onVisibility = () => instance.setPaused(PauseReason.Hidden, document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    let observer: IntersectionObserver | null = null
    const element = target.current
    if (element !== null && typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        const entry = entries.at(-1)
        if (entry !== undefined) instance.setPaused(PauseReason.Offscreen, !entry.isIntersecting)
      })
      observer.observe(element)
    } else {
      instance.setPaused(PauseReason.Offscreen, false)
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
      instance.dispose()
      player.current = null
    }
  }, [steps, finalIndex, target])

  useEffect(() => {
    player.current?.setReducedMotion(reduced)
  }, [reduced])

  useEffect(() => {
    player.current?.setPaused(PauseReason.User, userPaused)
  }, [userPaused])

  const step = steps[reduced ? finalIndex : index] ?? steps[finalIndex]
  return {
    frame: step?.frame ?? null,
    reduced,
    userPaused,
    toggle: () => setUserPaused((paused) => !paused),
  }
}

/**
 * O animador da demonstração (chunk sob demanda, fora do primeiro acesso): a janela de chat que se
 * anima sozinha (um usuário digita a pergunta, a data de referência aparece e a resposta chega em
 * stream com citação e vigência; depois a mesma pergunta em outra data), a linha do tempo cujo ponto
 * âmbar acompanha a data da cena e o botão de pausa. Tudo estático, sem API.
 */
export function HeroStage(props: HeroDemoProps) {
  const { copy } = props
  const steps = useMemo(
    () =>
      buildDemoSteps(
        demoScript(
          copy.question,
          copy.scenes.map((scene) => scene.answer),
        ),
      ),
    [copy],
  )
  const figure = useRef<HTMLElement | null>(null)
  const { frame, reduced, userPaused, toggle } = useDemoPlayback(steps, figure)
  if (frame === null) return null
  const label = userPaused ? copy.play : copy.pause

  return (
    <DemoFigure
      {...props}
      frame={frame}
      figureRef={figure}
      controls={
        reduced ? null : (
          <button
            type="button"
            onClick={toggle}
            aria-label={label}
            title={label}
            data-testid="hero-demo-toggle"
            className="absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {userPaused ? (
              <PlayIcon aria-hidden="true" className="size-4" />
            ) : (
              <PauseIcon aria-hidden="true" className="size-4" />
            )}
          </button>
        )
      }
    />
  )
}
