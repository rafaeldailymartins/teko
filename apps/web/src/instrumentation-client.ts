import { config } from 'zod'

/**
 * Roda no navegador antes de qualquer código da aplicação (convenção `instrumentation-client` do
 * Next). O Zod 4 testa `new Function('')` ao construir o primeiro `z.object` para decidir se compila
 * o parser; a CSP do documento não tem `'unsafe-eval'`, então o teste gera uma violação de
 * `script-src` mesmo capturado. Com `jitless`, o Zod nem tenta e usa só o parser interpretado. Precisa
 * vir antes dos schemas de `@teko/shared`, que são construídos na avaliação do módulo.
 */
config({ jitless: true })
