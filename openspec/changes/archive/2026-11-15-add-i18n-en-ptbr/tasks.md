# Tasks

## 1. Versões e i18n transversal

- [x] 1.1 `TERMS_VERSION` e `PRIVACY_POLICY_VERSION` em `@teko/shared/legal`, com a API usando a mesma constante
- [x] 1.2 Paridade de chaves com diff (faltando e sobrando), argumentos ICU e tags de rich text em todos os namespaces
- [x] 1.3 Helper de datas, instantes e períodos de apuração por locale e teste do fuso `America/Sao_Paulo`
- [x] 1.4 Namespaces só de servidor fora das mensagens do cliente
- [x] 1.5 Revisão das strings em inglês

## 2. Páginas legais

- [x] 2.1 `/privacy` coerente com o `ropa.md`, em pt-BR e en
- [x] 2.2 `/terms` com a versão em vigor, em pt-BR e en
- [x] 2.3 `/about` em pt-BR e en
- [x] 2.4 Layout em Source Serif com sumário e âncoras, e `lang="pt-BR"` nos termos em português

## 3. Consentimento

- [x] 3.1 Armazenamento da escolha com a versão da política
- [x] 3.2 Banner com Aceitar, Recusar e Personalizar de mesmo peso, preferências por categoria e link nos rodapés
- [x] 3.3 Adapter de analytics com carregador no-op, chave pública em `src/lib/env.ts` e o Biome barrando o SDK fora dele

## 4. Testes e documentação

- [x] 4.1 Testes unitários do armazenamento, do adapter, do provider, do helper de datas e das seções
- [x] 4.2 E2E `consent.spec.ts` e `legal.spec.ts`, e o estado inicial com a escolha feita nas demais jornadas
- [x] 4.3 `frontend.md`, `ropa.md` e `status.md`
