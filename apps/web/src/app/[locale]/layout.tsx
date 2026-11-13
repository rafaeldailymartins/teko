export {
  generateMetadata,
  generateStaticParams,
  LocaleLayout as default,
  viewport,
} from '@/components/locale-layout'

/** Só os locales de `generateStaticParams` existem (export estático). */
export const dynamicParams = false
