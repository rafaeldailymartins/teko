'use client'

import dynamic from 'next/dynamic'

/**
 * O diálogo do onboarding (passos, seletor de país com busca) num chunk carregado por `import()`:
 * só quem tem o cadastro pendente o baixa, fora do JS de primeiro acesso que o orçamento de bundle
 * soma. Enquanto o chunk chega, o app já está atrás da guarda e nada pisca.
 */
export const LazyOnboardingDialog = dynamic(
  () => import('./onboarding-dialog.tsx').then((module) => module.OnboardingDialog),
  { ssr: false },
)
