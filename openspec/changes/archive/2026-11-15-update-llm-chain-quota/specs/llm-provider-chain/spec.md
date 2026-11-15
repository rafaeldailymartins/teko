# Spec Delta

## MODIFIED Requirements

### Requirement: Cadeia com fallback e breakers

A API MUST chamar o Gemini primário, o Gemini de fallback e o Groq, nesta ordem, caindo para o
seguinte só antes do primeiro token. Um 429 da cota diária SHALL abrir o breaker do modelo até a
meia-noite do Pacífico; outro 429 SHALL abrir pelo prazo que o provedor informar (`retry-after` ou
`retryDelay`) ou, sem prazo, por 60 s; 3 falhas seguidas de 5xx, rede ou outro 4xx SHALL abrir por
60 s. Depois do primeiro token, uma falha SHALL encerrar o stream com `upstream_unavailable`.

#### Scenario: Primário com 503

- **WHEN** o Gemini primário responde 503 e o de fallback, 429
- **THEN** a resposta sai do Groq, com `fallbackFrom` igual ao modelo primário

#### Scenario: Limite por minuto do Gemini

- **WHEN** o Gemini primário responde 429 com `retryDelay` de 37 s e um `quotaId` por minuto
- **THEN** o breaker dele abre por 37 s, e não até a meia-noite do Pacífico

#### Scenario: Cota diária do Gemini

- **WHEN** o Gemini primário responde 429 com um `quotaId` de cota diária
- **THEN** o breaker dele abre até a meia-noite do Pacífico, qualquer que seja o `retryDelay`
