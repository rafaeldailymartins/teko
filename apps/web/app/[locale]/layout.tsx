export {
  generateMetadata,
  generateStaticParams,
  LocaleLayout as default,
  viewport,
} from '@/app/entrypoint'

/** Só os locales de `generateStaticParams` existem (export estático). */
export const dynamicParams = false
