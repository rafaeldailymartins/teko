import assert from 'node:assert/strict'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { applyGrafana, checkBody, GRAFANA_DIR, grafanaBase } from './grafana-apply.ts'
import {
  type AlertRuleSpec,
  expandContactPoint,
  expandDashboard,
  expandRuleGroup,
  type GrafanaAsCode,
  KNOWN_METRICS,
  knownRunbooks,
  loadGrafanaAsCode,
  metricsOf,
  monthlyExecutions,
  REQUIRED_ALERTS,
  rawFiles,
  SM_MONTHLY_EXECUTION_BUDGET,
  validate,
} from './lib/grafana-as-code.ts'

const REPO_ROOT = join(import.meta.dirname, '..')
const code = loadGrafanaAsCode(GRAFANA_DIR)
const runbooks = knownRunbooks(REPO_ROOT)

function withRule(patch: Partial<AlertRuleSpec>, uid = 'teko-api-5xx'): GrafanaAsCode {
  return {
    ...code,
    alerts: {
      ...code.alerts,
      rules: code.alerts.rules.map((rule) => (rule.uid === uid ? { ...rule, ...patch } : rule)),
    },
  }
}

describe('infra/grafana (validação offline, a mesma do --validate)', () => {
  it('os arquivos do repositório passam sem erro', () => {
    assert.deepEqual(validate(code, runbooks, rawFiles(GRAFANA_DIR)), [])
  })

  it('tem os cinco dashboards da arquitetura', () => {
    assert.deepEqual(code.dashboards.map((dashboard) => dashboard.uid).sort(), [
      'teko-api-red',
      'teko-llm',
      'teko-quotas',
      'teko-rag-signals',
      'teko-vercel-hobby',
    ])
  })

  it('tem exatamente os alertas da seção "Alertas por e-mail"', () => {
    assert.deepEqual(
      code.alerts.rules.map((rule) => rule.uid).sort(),
      Object.keys(REQUIRED_ALERTS).sort(),
    )
  })

  it('checks: /healthz dos dois projetos e a landing de produção, dentro da cota', () => {
    assert.deepEqual(
      code.checks.checks.map((check) => [check.target, check.enabled]),
      [
        ['https://tekoia.vercel.app/healthz', true],
        ['https://tekoia-staging.vercel.app/healthz', true],
        // Desligado até o primeiro deploy do web de produção (F7): até lá só responde 404.
        ['https://tekoia.vercel.app/pt-BR/', false],
      ],
    )
    const total = code.checks.checks.reduce((sum, check) => sum + monthlyExecutions(check), 0)
    // 2 x (1 sonda x 43.200 / 5 min) = 8.640 + 8.640; a landing desligada não roda e conta 0.
    assert.equal(total, 17_280)
    assert.ok(total <= SM_MONTHLY_EXECUTION_BUDGET)
  })

  it('check desligado conta 0 execuções; ligado, sondas x 43.200 / frequência em minutos', () => {
    const landing = code.checks.checks.find((check) => check.job === 'teko-landing-production')
    assert.ok(landing)
    assert.equal(monthlyExecutions(landing), 0)
    assert.equal(monthlyExecutions({ ...landing, enabled: true }), 2880)
  })

  it('alerta de check falho: todos os checks teko-* sem sucesso em 20 min', () => {
    const rule = code.alerts.rules.find((item) => item.uid === 'teko-synthetic-failed')
    assert.ok(rule)
    assert.equal(
      rule.expr,
      'max by (job, instance) (max_over_time(probe_success{job=~"teko-.+"}[20m]))',
    )
    assert.deepEqual(
      [rule.group, rule.source, rule.severity, rule.op, rule.threshold, rule.for],
      ['teko-synthetic', 'synthetic', 'critical', 'lt', 1, '0s'],
    )
    assert.equal(rule.rangeSeconds, 1200)
    // A janela de 20 min cobre 4 execuções dos checks de 5 min e ao menos 1 do de 15 min.
    const runsInWindow = code.checks.checks.map((check) =>
      Math.floor(20 / (check.frequency / 60_000)),
    )
    assert.deepEqual(runsInWindow, [4, 4, 1])
  })

  it('o painel de sinais de RAG cobre recusa por motivo, lexical_only e citações invalidadas', () => {
    const rag = code.dashboards.find((dashboard) => dashboard.uid === 'teko-rag-signals')
    const exprs = (rag?.panels ?? []).flatMap((panel) => (panel.targets ?? []).map((t) => t.expr))
    assert.ok(exprs.some((expr) => expr.includes('refusal_reason')))
    assert.ok(exprs.some((expr) => expr.includes('retrieval_mode="lexical_only"')))
    assert.ok(exprs.some((expr) => expr.includes('teko_rag_citations_invalidated_total')))
    assert.deepEqual(
      rag?.variables.map((variable) => variable.name),
      ['env', 'corpus_version'],
    )
  })
})

describe('validate (casos de erro)', () => {
  it('runbook ausente ou fora de docs/runbooks', () => {
    const errors = validate(withRule({ runbook: 'https://example.com/x' }), runbooks)
    assert.ok(errors.some((error) => error.includes('teko-api-5xx: runbook precisa ser')))
    const missing = validate(withRule({ runbook: 'nao-existe.md' }), runbooks)
    assert.ok(missing.some((error) => error.includes('nao-existe.md não existe')))
    const anchor = validate(withRule({ runbook: 'provider-outage.md#nao-existe' }), runbooks)
    assert.ok(anchor.some((error) => error.includes('sem a âncora <a id="nao-existe"></a>')))
    // Runbook previsto para a F7 (tabela da arquitetura) é aceito, com qualquer âncora.
    assert.equal(runbooks.get('vercel-paused.md'), null)
  })

  it('métrica fora do contrato e parênteses desbalanceados', () => {
    const errors = validate(withRule({ expr: 'sum(rate(teko_rag_answer_total[5m])' }), runbooks)
    assert.ok(
      errors.some((error) => error.includes('métrica fora do contrato: teko_rag_answer_total')),
    )
    assert.ok(errors.some((error) => error.includes('desbalanceados')))
  })

  it('alerta obrigatório ausente e alerta a mais', () => {
    const errors = validate(withRule({ uid: 'teko-api-extra' }), runbooks)
    assert.ok(errors.some((error) => error.includes('alerta obrigatório ausente: teko-api-5xx')))
    assert.ok(errors.some((error) => error.includes('fora da seção "Alertas por e-mail"')))
  })

  it('variável não declarada no dashboard', () => {
    const [first, ...rest] = code.dashboards
    assert.ok(first)
    const broken: GrafanaAsCode = {
      ...code,
      dashboards: [{ ...first, variables: [] }, ...rest],
    }
    assert.ok(
      validate(broken, runbooks).some((error) => error.includes('variável $env não declarada')),
    )
  })

  it('checks acima de 50% da cota do Free', () => {
    const [check] = code.checks.checks
    assert.ok(check)
    const heavy: GrafanaAsCode = {
      ...code,
      checks: { checks: [{ ...check, frequency: 60_000, probes: ['SaoPaulo', 'Paris'] }] },
    }
    assert.ok(validate(heavy, runbooks).some((error) => error.includes('86400 execuções/mês')))
    // O mesmo check desligado não roda e não conta na cota.
    const [disabled] = heavy.checks.checks
    assert.ok(disabled)
    const off: GrafanaAsCode = { ...code, checks: { checks: [{ ...disabled, enabled: false }] } }
    assert.deepEqual(validate(off, runbooks), [])
  })

  it('e-mail em qualquer JSON de infra/grafana', () => {
    const errors = validate(code, runbooks, [
      { file: 'stack.json', text: '{"a": "fulano@exemplo.com"}' },
    ])
    assert.deepEqual(errors, ['stack.json: e-mail no repositório (use GRAFANA_ALERT_EMAILS)'])
  })

  it('metricsOf ignora valores de label entre aspas', () => {
    assert.deepEqual(metricsOf('probe_success{job=~"teko_fake_metric"}'), ['probe_success'])
    assert.ok(KNOWN_METRICS.has('teko_vercel_usage_ratio'))
  })
})

describe('expansão', () => {
  it('dashboard: grade de 24 colunas em ordem e datasource pela variável', () => {
    const api = code.dashboards.find((dashboard) => dashboard.uid === 'teko-api-red')
    assert.ok(api)
    const model = expandDashboard(api) as {
      panels: { gridPos: { x: number; y: number; w: number }; datasource: { uid: string } }[]
      templating: { list: { name: string }[] }
    }
    assert.deepEqual(
      model.panels.slice(0, 6).map((panel) => [panel.gridPos.x, panel.gridPos.y, panel.gridPos.w]),
      [
        [0, 0, 6],
        [6, 0, 6],
        [12, 0, 6],
        [18, 0, 6],
        [0, 4, 12],
        [12, 4, 12],
      ],
    )
    assert.equal(model.panels[0]?.datasource.uid, '$datasource')
    assert.deepEqual(
      model.templating.list.map((variable) => variable.name),
      ['datasource', 'env'],
    )
  })

  it('grupo de regras: consulta A, threshold B, runbook e receiver', () => {
    const group = expandRuleGroup(code, 'teko-api', 'grafanacloud-prom') as {
      folderUid: string
      interval: number
      rules: {
        uid: string
        noDataState: string
        annotations: { runbook_url: string }
        notification_settings: { receiver: string }
        data: { refId: string; datasourceUid: string; model: Record<string, unknown> }[]
      }[]
    }
    assert.equal(group.folderUid, 'teko-ops')
    assert.equal(group.interval, 60)
    const rule = group.rules.find((item) => item.uid === 'teko-api-5xx')
    assert.ok(rule)
    assert.equal(rule.noDataState, 'OK')
    assert.equal(
      rule.annotations.runbook_url,
      'https://github.com/rafaeldailymartins/teko/blob/main/docs/runbooks/provider-outage.md#5xx-na-api',
    )
    assert.equal(rule.notification_settings.receiver, 'teko-email')
    assert.deepEqual(
      rule.data.map((query) => [query.refId, query.datasourceUid]),
      [
        ['A', 'grafanacloud-prom'],
        ['B', '__expr__'],
      ],
    )
    assert.deepEqual(rule.data[1]?.model['conditions'], [
      { evaluator: { type: 'gt', params: [0.02] } },
    ])
  })

  it('contact point: e-mails do segredo, separados por ; ou vírgula', () => {
    const body = expandContactPoint(code.stack, ' a@x.dev, b@y.dev ') as {
      settings: { addresses: string }
    }
    assert.equal(body.settings.addresses, 'a@x.dev;b@y.dev')
    assert.throws(() => expandContactPoint(code.stack, 'nao-e-email'), /GRAFANA_ALERT_EMAILS/u)
  })

  it('check: sondas por ID, erro claro para sonda inexistente', () => {
    const [check] = code.checks.checks
    assert.ok(check)
    assert.deepEqual(checkBody(check, new Map([['SaoPaulo', 7]]))['probes'], [7])
    assert.throws(() => checkBody(check, new Map()), /sonda pública SaoPaulo não existe/u)
  })
})

describe('grafanaBase', () => {
  it('aceita só https://*.grafana.net', () => {
    assert.equal(grafanaBase('https://teko.grafana.net/', 'X'), 'https://teko.grafana.net')
    const rejected = { name: 'RangeError', message: 'X precisa ser https://<algo>.grafana.net' }
    assert.throws(() => grafanaBase('http://teko.grafana.net', 'X'), rejected)
    assert.throws(() => grafanaBase('https://grafana.net.evil.com', 'X'), rejected)
    assert.throws(() => grafanaBase('nope', 'X'), /não é uma URL/u)
  })
})

describe('applyGrafana', () => {
  interface Call {
    readonly method: string
    readonly url: string
    readonly body: unknown
  }

  /**
   * Grafana e SM falsos: tudo vazio (404) exceto o datasource, o contact point, as pastas e as
   * sondas. Como no Grafana Cloud com papel Editor, `GET /api/folders/:uid` responde 403 para
   * qualquer uid; só a listagem diz se a pasta existe.
   */
  function fakeFetch(
    existing: {
      contactPoint?: boolean
      checks?: unknown[]
      folders?: { uid: string; title: string }[]
    } = {},
  ) {
    const calls: Call[] = []
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
    const doFetch = (async (input: URL | string, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      calls.push({
        method,
        url: `${url.host}${url.pathname}${url.search}`,
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      })
      if (method !== 'GET') return json({})
      if (url.pathname === '/api/datasources/uid/grafanacloud-prom')
        return json({ type: 'prometheus' })
      if (url.pathname === '/api/v1/provisioning/contact-points') {
        return json(existing.contactPoint ? [{ uid: 'teko-email' }] : [])
      }
      if (url.pathname === '/api/folders') return json(existing.folders ?? [])
      if (url.pathname.startsWith('/api/folders/')) {
        return json({ message: 'Permissions needed: folders:read' }, 403)
      }
      if (url.pathname === '/api/v1/check') return json(existing.checks ?? [])
      if (url.pathname === '/api/v1/probe') return json([{ id: 7, name: 'SaoPaulo' }])
      return json({ message: 'not found' }, 404)
    }) as typeof fetch
    return { calls, doFetch }
  }

  const env = {
    grafanaUrl: 'https://teko.grafana.net',
    saToken: 'sa',
    smUrl: 'https://synthetic-monitoring-api-sa-east-1.grafana.net',
    smToken: 'sm',
    alertEmails: 'alertas@teko.dev',
  }

  it('dry-run só lê e devolve o plano completo', async () => {
    const { calls, doFetch } = fakeFetch()
    const plan = await applyGrafana(code, env, {
      mode: 'dry-run',
      fetch: doFetch,
      log: () => {},
      sha: 'abc1234',
    })
    assert.deepEqual(
      calls.filter((call) => call.method !== 'GET'),
      [],
    )
    assert.deepEqual(
      plan.map((item) => `${item.kind}:${item.action}`),
      [
        'folder:create',
        'contact-point:create',
        ...code.dashboards.map(() => 'dashboard:create'),
        ...code.alerts.groups.map(() => 'rule-group:create'),
        ...code.checks.checks.map(() => 'check:create'),
      ],
    )
    assert.deepEqual(
      plan.filter((item) => item.kind === 'check').map((item) => item.note),
      ['8640 execuções/mês', '8640 execuções/mês', 'desligado, 0 execuções/mês'],
    )
  })

  it('apply cria tudo na ordem, atualiza o check existente e apaga o teko-* que saiu', async () => {
    const { calls, doFetch } = fakeFetch({
      checks: [
        { id: 11, tenantId: 3, job: 'teko-healthz-production' },
        { id: 12, tenantId: 3, job: 'teko-antigo' },
        { id: 13, tenantId: 3, job: 'outro-projeto' },
      ],
    })
    await applyGrafana(code, env, { mode: 'apply', fetch: doFetch, log: () => {}, sha: 'abc1234' })
    const writes = calls.filter((call) => call.method !== 'GET')
    assert.deepEqual(
      writes.map((call) => `${call.method} ${call.url}`),
      [
        'POST teko.grafana.net/api/folders',
        'POST teko.grafana.net/api/v1/provisioning/contact-points',
        ...code.dashboards.map(() => 'POST teko.grafana.net/api/dashboards/db'),
        ...code.alerts.groups.map(
          (group) =>
            `PUT teko.grafana.net/api/v1/provisioning/folder/teko-ops/rule-groups/${group.name}`,
        ),
        'POST synthetic-monitoring-api-sa-east-1.grafana.net/api/v1/check/11',
        'POST synthetic-monitoring-api-sa-east-1.grafana.net/api/v1/check',
        'POST synthetic-monitoring-api-sa-east-1.grafana.net/api/v1/check',
        'DELETE synthetic-monitoring-api-sa-east-1.grafana.net/api/v1/check/12',
      ],
    )
    const update = writes.find((call) => call.url.endsWith('/api/v1/check/11'))?.body as
      | { id: number; tenantId: number; probes: number[] }
      | undefined
    assert.deepEqual([update?.id, update?.tenantId, update?.probes], [11, 3, [7]])
    // O check desligado é criado assim mesmo, com enabled false: ligar na F7 é só trocar o valor.
    const landing = writes
      .map((call) => call.body as { job?: string; enabled?: boolean } | undefined)
      .find((body) => body?.job === 'teko-landing-production')
    assert.equal(landing?.enabled, false)
    const dashboard = writes.find((call) => call.url.endsWith('/api/dashboards/db'))?.body as
      | { folderUid: string; overwrite: boolean }
      | undefined
    assert.deepEqual([dashboard?.folderUid, dashboard?.overwrite], ['teko-ops', true])
  })

  it('acha a pasta pela listagem (o GET por uid dá 403 com Editor): mantém ou renomeia', async () => {
    const { title } = code.stack.folder
    for (const [existingTitle, action] of [
      [title, 'keep'],
      ['Título antigo', 'update'],
    ] as const) {
      const { calls, doFetch } = fakeFetch({ folders: [{ uid: 'teko-ops', title: existingTitle }] })
      const plan = await applyGrafana(code, env, {
        mode: 'apply',
        fetch: doFetch,
        log: () => {},
        sha: 'abc1234',
      })
      assert.equal(plan.find((item) => item.kind === 'folder')?.action, action)
      const folderWrites = calls.filter(
        (call) => call.method !== 'GET' && call.url.includes('/api/folders'),
      )
      assert.deepEqual(
        folderWrites.map((call) => `${call.method} ${call.url}`),
        action === 'keep' ? [] : ['PUT teko.grafana.net/api/folders/teko-ops'],
      )
    }
  })

  it('sem e-mails nem contact point existente, pula os alertas; sem token do SM, pula os checks', async () => {
    const { calls, doFetch } = fakeFetch()
    const lines: string[] = []
    const plan = await applyGrafana(
      code,
      { grafanaUrl: env.grafanaUrl, saToken: 'sa' },
      { mode: 'apply', fetch: doFetch, log: (line) => lines.push(line), sha: 'abc1234' },
    )
    assert.ok(
      plan.filter((item) => item.kind === 'rule-group').every((item) => item.action === 'skip'),
    )
    assert.ok(plan.filter((item) => item.kind === 'check').every((item) => item.action === 'skip'))
    assert.ok(!calls.some((call) => call.url.includes('rule-groups') && call.method === 'PUT'))
    assert.equal(lines.filter((line) => line.startsWith('::warning')).length, 2)
  })

  it('contact point existente sem e-mails no environment: mantém e aplica os alertas', async () => {
    const { calls, doFetch } = fakeFetch({ contactPoint: true })
    await applyGrafana(
      code,
      { grafanaUrl: env.grafanaUrl, saToken: 'sa' },
      { mode: 'apply', fetch: doFetch, log: () => {}, sha: 'abc1234' },
    )
    assert.ok(!calls.some((call) => call.url.includes('contact-points') && call.method !== 'GET'))
    assert.equal(
      calls.filter((call) => call.method === 'PUT' && call.url.includes('rule-groups')).length,
      3,
    )
  })

  it('falha com mensagem clara quando o datasource não existe', async () => {
    const { doFetch } = fakeFetch()
    await assert.rejects(
      applyGrafana(
        code,
        { ...env, promDatasourceUid: 'outro' },
        {
          mode: 'dry-run',
          fetch: doFetch,
          log: () => {},
          sha: 'abc1234',
        },
      ),
      /datasource Prometheus outro não encontrado/u,
    )
  })
})
