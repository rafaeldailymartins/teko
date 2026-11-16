# Tasks

## 1. Entrada

- [x] 1.1 Página em duas colunas (painel da marca e formulário), com topo e rodapé próprios
- [x] 1.2 Métodos conforme `GET /auth/providers`, com esqueleto e fallback; símbolos do GitHub e do Google
- [x] 1.3 Formulário de e-mail e senha em abas, com validação pelos schemas, medidor e mostrar a senha
- [x] 1.4 Mensagens de cada `failure`, aviso sem recuperação com link para os Termos e retorno saneado
- [x] 1.5 `account_not_linked` com o texto novo e o aviso de `region_restricted` redesenhado

## 2. Onboarding e configurações

- [x] 2.1 Onboarding em passos, caixas de seleção em cartão, país com busca e chunk sob demanda
- [x] 2.2 Configurações em cartões com navegação lateral, método de entrada, cota com o que resta e zona de perigo
- [x] 2.3 Preferências de tema e densidade em cartões de opção e o idioma pelo `LanguageMenu`

## 3. Testes e documentação

- [x] 3.1 Unitários: formulário, validação, mensagens, provedores condicionais, busca de país, método de entrada
- [x] 3.2 E2E: `auth.spec.ts`, `email-auth.spec.ts` (cadastro e entrada pela tela) e axe da entrada, do onboarding e das configurações
- [x] 3.3 Jornada local de ponta a ponta (cadastro, onboarding e chat) e screenshots nos dois temas
- [x] 3.4 `docs/architecture/frontend.md` (Conta) e `docs/status.md`
