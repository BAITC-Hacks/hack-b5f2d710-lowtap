// Паритет TS-движка с Python-движком бэкенда: data/golden.json (python -m app.cli golden) —
// все пресеты, невалидные наборы, частичные наборы и 50 случайных валидных (seed 42).

import { describe, expect, it } from 'vitest'
import type { Decision, EvalResult } from '../types/api'
import { DISTRICT_IDS, INDICATOR_CODES } from '../types/data'
import { evaluateLocal } from './evaluate'
import { DATA_HASH } from './hash'
import { validateDecisions } from './validate'

interface GoldenCase {
  name: string
  decisions: Decision[]
  valid: boolean
  allow_partial?: boolean
  violations?: { code: string }[]
  eval?: EvalResult
}

interface Golden {
  data_hash: string
  engine_version: string
  cases: GoldenCase[]
}

const files = import.meta.glob<Golden>('@data/golden.json', { eager: true, import: 'default' })
const golden = Object.values(files)[0]

const EPS = 1e-6
/** Офлайн-перцентиль считается по сжатой таблице (vite.config.ts), сервер — точно. */
const PERCENTILE_EPS = 0.01

function close(actual: number, expected: number, path: string, eps = EPS) {
  if (Math.abs(actual - expected) > eps) throw new Error(`${path}: ${actual} ≠ ${expected}`)
}

describe.skipIf(!golden)('parity: TS-движок = Python-движок (data/golden.json)', () => {
  it('тот же датасет (data_hash)', () => {
    expect(DATA_HASH).toBe(golden!.data_hash)
  })

  it.each((golden?.cases ?? []).map((c) => [c.name, c] as const))('%s', (_, c) => {
    if (!c.valid) {
      expect(validateDecisions(c.decisions).map((v) => v.code)).toEqual(c.violations!.map((v) => v.code))
      expect(evaluateLocal(c.decisions).ok).toBe(false)
      return
    }
    const out = evaluateLocal(c.decisions, { allowPartial: c.allow_partial })
    if (!out.ok) throw new Error(`ожидался валидный набор: ${out.violations.map((v) => v.code).join(', ')}`)
    const a = out.data
    const e = c.eval!

    expect(a.scenario_id).toBe(e.scenario_id)
    expect([a.cost, a.remaining, a.n_crit]).toEqual([e.cost, e.remaining, e.n_crit])
    for (const key of ['score', 'baseline', 'delta', 'd_avg'] as const) close(a[key], e[key], key)
    expect(a.min_district.id).toBe(e.min_district.id)
    close(a.min_district.d, e.min_district.d, 'min_district.d')
    for (const key of Object.keys(e.components) as (keyof EvalResult['components'])[]) close(a.components[key], e.components[key], `components.${key}`)
    if (e.percentile === null) expect(a.percentile).toBeNull()
    else close(a.percentile!, e.percentile, 'percentile', PERCENTILE_EPS)

    for (const kind of ['before', 'after', 'closed', 'new'] as const) {
      const key = (p: { district_id: string; indicator: string }) => `${p.district_id}.${p.indicator}`
      expect(a.critical_pairs[kind].map(key).sort()).toEqual(e.critical_pairs[kind].map(key).sort())
    }

    for (const id of DISTRICT_IDS) {
      const [da, de] = [a.districts[id], e.districts[id]]
      close(da.d_before, de.d_before, `${id}.d_before`)
      close(da.d_after, de.d_after, `${id}.d_after`)
      close(da.delta, de.delta, `${id}.delta`)
      for (const code of INDICATOR_CODES) {
        close(da.indicators_before[code], de.indicators_before[code], `${id}.${code}.before`)
        close(da.indicators_after[code], de.indicators_after[code], `${id}.${code}.after`)
        close(da.deltas[code], de.deltas[code], `${id}.${code}.delta`)
      }
    }

    expect(Object.keys(a.contributions).sort()).toEqual(Object.keys(e.contributions).sort())
    for (const [id, x] of Object.entries(e.contributions)) {
      close(a.contributions[id].shapley, x.shapley, `${id}.shapley`)
      close(a.contributions[id].loo, x.loo, `${id}.loo`)
      close(a.contributions[id].per_unit, x.per_unit, `${id}.per_unit`)
    }

    expect(a.waterfall.map((w) => w.measure_id)).toEqual(e.waterfall.map((w) => w.measure_id))
    a.waterfall.forEach((w, i) => close(w.delta, e.waterfall[i].delta, `waterfall.${w.measure_id}`))

    expect(a.synergies_triggered).toEqual(e.synergies_triggered)

    expect(a.timeline).toHaveLength(e.timeline.length)
    a.timeline.forEach((t, q) => {
      close(t.score, e.timeline[q].score, `timeline.Q${q}.score`)
      expect(t.n_crit).toBe(e.timeline[q].n_crit)
      for (const id of DISTRICT_IDS) close(t.d[id], e.timeline[q].d[id], `timeline.Q${q}.${id}`)
    })
  })
})
