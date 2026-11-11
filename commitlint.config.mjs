// Escopos permitidos: lista única, replicada no CONTRIBUTING.md.
export const scopes = [
  'web',
  'api',
  'shared',
  'ingest',
  'retrieval',
  'eval',
  'obs',
  'i18n',
  'auth',
  'db',
  'ci',
  'deps',
  'deps-dev',
  'release',
  'specs',
  'docs',
  'infra',
]

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [2, 'always', scopes],
    'subject-case': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    // DCO: todo commit humano traz Signed-off-by (git commit -s). O CI (pr-hygiene.yml) reforça.
    'signed-off-by': [2, 'always', 'Signed-off-by:'],
  },
  ignores: [(message) => /^Merge (branch|pull request)/.test(message)],
}
