# Design

## Context

O lockdown é a segunda etapa da guarda de uso (`scripts/vercel-usage.ts`, mudança
`add-usage-guard`): a 95% de uma cota, `scripts/vercel-firewall.ts --lockdown on` troca a regra 1 do
WAF (`deny-unknown-api`) pelo payload `lockdown` do `firewall-rules.json`. O objetivo é parar o
consumo de Function e de CDN até o ciclo virar. Hoje a regra nega com 403, e a página de aviso que
ela deixa passar não existe no export do web.

## Goals / Non-Goals

**Goals:** quem chega ao Tekó durante o lockdown vê uma página que explica a pausa, nos dois idiomas,
sem depender de nada que o lockdown bloqueia; o build não sai sem a página; o script do WAF não
aceita um lockdown que leve a outro lugar ou que o navegador guarde.

**Non-Goals:** mudar quando o lockdown liga ou desliga (guarda de uso), o kill switch de geração, o
sync do deploy ou as regras 2 e 3.

## Decisions

- **Redirect temporário na borda (307, `permanent: false`).** A ação `redirect` do WAF responde na
  borda, sem invocar a Function, como o `deny`. Um redirect permanente (308) ficaria no cache do
  navegador e continuaria levando ao aviso depois do `--lockdown off`; por isso o
  `vercel-firewall.ts` recusa `permanent: true`. O `fetch` do app para `/api/*` também recebe o 307;
  quem já estava com o app aberto vê erro de rede/parse, e a próxima navegação cai no aviso.
- **Página só na raiz (`/aviso/`).** Os dois idiomas ficam lado a lado, como no 404 global, então
  não há `/<locale>/aviso/`; a exceção do lockdown passa a `aviso(?:/.*)?`, que cobre `/aviso` (o
  308 de barra final das rotas leva a `/aviso/`), `/aviso/` e o `index.txt` do Next. O destino do
  redirect fica fora da condição da regra, então não há laço; o teste do JSON confere.
- **Nada além do que o lockdown deixa passar.** A página usa o `BareDocument` (fontes e CSS em
  `/_next/static/`, bootstrap de tema inline com hash na CSP) e não tem link, imagem externa nem
  script próprio. Os ícones de `SITE_ICONS` (`/icon.svg`, `/apple-icon.png`) caem no redirect durante
  o lockdown: o navegador só fica sem ícone, sem efeito no layout. A lista de exceções segue a que o
  mantenedor fixou (`/healthz`, `/api/healthz`, `/aviso/*`, `/_next/static/*`, `/favicon.ico`).
- **Namespace `lockdown` nos catálogos**, fora de `SERVER_ONLY_NAMESPACES` (como `gateway` e
  `notFound`): são três frases curtas.
- **Validação no `parseProjectRules`:** o payload de lockdown MUST ter `action: redirect`,
  `redirect.location = /aviso/` e `permanent: false`. A comparação "só escreve o que difere" já é
  recursiva (forma canônica sem nulos), então enxerga o objeto `redirect`; um lockdown antigo com
  `deny` ainda é reconhecido pela descrição `LOCKDOWN` e é regravado com o redirect no próximo
  `--lockdown on`.
- **Specs:** o requisito "WAF aplicado por código, com lockdown versionado" muda (o cenário do guarda
  de uso passa a esperar o 307), e a página entra como requisito novo em `web-build`, ao lado da
  entrada estática de `/`, que também é página fora de locale.

Alternativas consideradas:

- Manter o `deny` e só criar a página: descartado, o visitante nunca chegaria a ela.
- Páginas por locale (`/pt-BR/aviso/`, `/en/aviso/`) com redirect por `Accept-Language`: o WAF não
  escolhe destino por header, e a página bilíngue resolve com um destino só.
- Deixar `/icon.svg` passar no lockdown: fora da lista decidida; o ícone não afeta a leitura.

## Fontes Context7

- `/openapi/openapi_vercel_sh`: schema da regra custom do firewall (`PUT` e `PATCH
  /v1/security/firewall/config`, `rules.insert`/`rules.update`): `action.mitigate.action` aceita
  `redirect`, com `redirect: { location, permanent }` (os dois obrigatórios), e a config ativa
  devolve o mesmo objeto. Consultado em 2026-11-18.
- `/vercel/next.js/v16.4.5`: `metadata.robots` (`index: false, follow: false`) num `page.tsx` do App
  Router, que vale no export estático. Consultado em 2026-11-18.

## Risks / Trade-offs

- O schema resumido do `PATCH` no OpenAPI lista só `deny|challenge|log` no exemplo da ação
  `firewallEnabled`; o da regra completa (`PUT` e a config ativa) traz `redirect`. Se a API recusar o
  `rules.update` com redirect, o `--lockdown on` falha com o erro da API e o guarda fica vermelho;
  o exercício no staging (runbook `budget-kill-switch.md`) confere antes de depender disso.
- Requisições `POST` para `/api/*` também recebem 307, e o navegador repete o `POST` em `/aviso/`; a
  regra 2 (`deny-unsafe-static`) nega com 403. É o comportamento esperado para chamadas de API durante
  o lockdown.
