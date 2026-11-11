// biome-ignore-all lint: fixture do `semgrep test` (código propositalmente proibido; não é compilado nem executado)
// Fixture JSX das regras de .semgrep/teko.yml (ver teko.ts).

declare const answerHtml: string
declare const THEME_BOOTSTRAP_SCRIPT: string
declare const createElement: (tag: string, props: Record<string, unknown>) => unknown

// ruleid: teko-no-dangerously-set-inner-html
const unsafe = <div dangerouslySetInnerHTML={{ __html: answerHtml }} />

// ruleid: teko-no-dangerously-set-inner-html
const withChildren = <section dangerouslySetInnerHTML={{ __html: answerHtml }}></section>

// ruleid: teko-no-dangerously-set-inner-html
const unsafeProps = createElement('div', { dangerouslySetInnerHTML: { __html: answerHtml } })

// ruleid: teko-no-dangerously-set-inner-html
const unsafeScript = <script dangerouslySetInnerHTML={{ __html: answerHtml }} />

// ok: teko-no-dangerously-set-inner-html
const theme = <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />

// ok: teko-no-dangerously-set-inner-html
const safe = <p className="answer">{answerHtml}</p>

void [unsafe, withChildren, unsafeProps, unsafeScript, theme, safe]
