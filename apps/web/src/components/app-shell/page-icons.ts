import {
  FileTextIcon,
  HistoryIcon,
  InfoIcon,
  type LucideIcon,
  MessageSquareTextIcon,
  ScaleIcon,
  SettingsIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import type { NAVIGATION_PAGES } from '@/lib/navigation'

/** Ícone de cada destino da navegação (cabeçalho e paleta). */
export const PAGE_ICONS: Readonly<Record<(typeof NAVIGATION_PAGES)[number], LucideIcon>> = {
  chat: MessageSquareTextIcon,
  history: HistoryIcon,
  coverage: ScaleIcon,
  settings: SettingsIcon,
  about: InfoIcon,
  privacy: ShieldCheckIcon,
  terms: FileTextIcon,
}
