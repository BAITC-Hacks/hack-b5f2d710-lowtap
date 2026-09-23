import { describe, expect, it } from 'vitest'
import type { Decision } from '../types/api'
import { RULES } from './catalog'
import { contributions } from './contributions'
import { evaluateLocal } from './evaluate'
import { scenarioId, sha256Hex } from './hash'
import { neighbors } from './neighbors'
import { BASE_STATE, clip, computeState, formulaComponents, summarize } from './score'
import { firstEffectQuarter, timeline } from './timeline'
import { whatIf } from './whatif'
import { blockReason, checklist, decisionsCost, districtConflict, validateDecisions, validateScenario } from './validate'

interface ScenarioFile {
  name_ru: string
  decisions: Decision[]
  expected:
    | { valid: true; score: number; cost: number; n_crit: number }
    | { valid: false; violations: string[] }
}

const files = import.meta.glob<ScenarioFile>('@data/scenarios/*.json', { eager: true, import: 'default' })
const scenarios = Object.entries(files).map(([path, s]) => ({ name: path.split('/').pop()!.replace('.json', ''), ...s }))
const byName = (name: string) => scenarios.find((s) => s.name === name)!

const TOL = 5e-4

describe('score: эталоны ТЗ', () => {
  it('база без решений = 52.558, N_crit 2 (S1 и S2 в Нуре)', () => {
    expect(BASE_STATE.score).toBeCloseTo(52.558, 3)
    expect(Math.abs(BASE_STATE.score - RULES.score.baseline)).toBeLessThan(TOL)
    expect(BASE_STATE.nCrit).toBe(2)
    expect(BASE_STATE.critical.map((c) => `${c.district_id}.${c.indicator}`)).toEqual(['nura.S1', 'nura.S2'])
    expect(BASE_STATE.dAvg).toBeCloseTo(56.862, 3)
    expect(BASE_STATE.minD).toBeCloseTo(49.18, 6)
  })

  it.each(['example_tz', 'cheapest', 'naive_esil', 'worst_of_all', 'optimum'])('%s: score, стоимость и N_crit', (name) => {
    const s = byName(name)
    if (!s.expected.valid) throw new Error('ожидался валидный сценарий')
    const state = computeState(s.decisions)
    expect(Math.abs(state.score - s.expected.score)).toBeLessThan(TOL)
    expect(state.nCrit).toBe(s.expected.n_crit)
    expect(decisionsCost(s.decisions)).toBe(s.expected.cost)
    expect(validateDecisions(s.decisions)).toEqual([])
  })

  it('три карточки формулы в сумме дают Score', () => {
    const state = computeState(byName('example_tz').decisions)
    const c = formulaComponents(state)
    expect(c.d_avg_term + c.min_term + c.crit_term).toBeCloseTo(state.score, 10)
    expect(c.d_avg_term_base + c.min_term_base + c.crit_term_base).toBeCloseTo(BASE_STATE.score, 10)
    expect(c.crit_term_base).toBe(-2)
  })

  it('порядок решений не влияет на Score', () => {
    const decisions = byName('example_tz').decisions
    expect(computeState([...decisions].reverse()).score).toBe(computeState(decisions).score)
  })

  it('частичные наборы: ловушка M11 (Алматы 51.687, Нура 52.875)', () => {
    const almaty = computeState([{ measure_id: 'M11', district: 'almaty' }])
    expect(almaty.score).toBeCloseTo(51.687, 3)
    expect(almaty.nCrit).toBe(3)
    expect(computeState([{ measure_id: 'M11', district: 'nura' }]).score).toBeCloseTo(52.875, 3)
  })
})

describe('validate: невалидные наборы дают ровно свой код', () => {
  const invalid = scenarios.filter((s) => !s.expected.valid)

  it('в data/scenarios 12 невалидных наборов', () => {
    expect(invalid).toHaveLength(12)
  })

  it.each(invalid.map((s) => [s.name, s] as const))('%s', (_, s) => {
    if (s.expected.valid) throw new Error('ожидался невалидный сценарий')
    expect(validateScenario({ decisions: s.decisions }).map((v) => v.code)).toEqual(s.expected.violations)
  })

  it('структурно сломанный JSON → BAD_REQUEST', () => {
    expect(validateScenario({ decisions: 'x' }).map((v) => v.code)).toEqual(['BAD_REQUEST'])
    expect(validateScenario(null).map((v) => v.code)).toEqual(['BAD_REQUEST'])
    expect(validateScenario({ decisions: [{ measure_id: 7 }] }).map((v) => v.code)).toEqual(['BAD_REQUEST'])
  })

  it('все нарушения сразу, а не первое', () => {
    const codes = validateDecisions([
      { measure_id: 'M3', district: 'nura' },
      { measure_id: 'M1', district: 'esil' },
      { measure_id: 'M13', district: 'almaty' },
      { measure_id: 'M5', district: 'saryarka' },
      { measure_id: 'M7', district: 'nura' },
      { measure_id: 'M2', district: null },
    ]).map((v) => v.code)
    expect(codes).toEqual(['NOT_FIVE', 'DIRECTION_LIMIT', 'INCOMPATIBLE_M1_M3', 'BUDGET_EXCEEDED'])
  })

  it('городская мера с неизвестным районом: DISTRICT_FORBIDDEN и UNKNOWN_DISTRICT, как на сервере', () => {
    const codes = validateDecisions([
      { measure_id: 'M7', district: 'nura' },
      { measure_id: 'M8', district: 'nura' },
      { measure_id: 'M10', district: 'nura' },
      { measure_id: 'M12', district: 'xx' },
      { measure_id: 'M5', district: 'saryarka' },
    ]).map((v) => v.code)
    expect(codes).toEqual(['DISTRICT_FORBIDDEN', 'UNKNOWN_DISTRICT'])
  })

  it('несовместимости «в одном районе» не срабатывают в разных районах', () => {
    const base: Decision[] = [
      { measure_id: 'M12', district: null },
      { measure_id: 'M10', district: 'nura' },
      { measure_id: 'M9', district: 'nura' },
    ]
    expect(validateDecisions([...base, { measure_id: 'M4', district: 'nura' }, { measure_id: 'M7', district: 'esil' }])).toEqual([])
    expect(
      validateDecisions([...base, { measure_id: 'M5', district: 'saryarka' }, { measure_id: 'M13', district: 'esil' }]),
    ).toEqual([])
  })
})

describe('validate: UI-подсказки', () => {
  const example = byName('example_tz').decisions

  it('полоса валидатора: 6/6 на примере ТЗ, серая на пустом наборе', () => {
    expect(Object.values(checklist(example))).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok'])
    expect(Object.values(checklist([]))).toEqual(Array(6).fill('pending'))
    expect(checklist(example.slice(0, 3)).count).toBe('pending')
    expect(checklist(byName('invalid_budget').decisions).budget).toBe('fail')
  })

  it('одна причина блокировки, самая ранняя по приоритету', () => {
    expect(blockReason(example, 'M1')?.text).toBe('5/5 — снимите меру')
    const four = example.filter((d) => d.measure_id !== 'M12')
    expect(blockReason(four, 'M9')?.text).toBe('лимит: Соцсфера 2/2')
    expect(blockReason([{ measure_id: 'M3', district: 'esil' }], 'M1')?.text).toBe('несовместимо с M3')
    expect(blockReason(four, 'M13')?.text).toBe('+28 → 109/100')
    expect(blockReason(four, 'M14')).toBeNull()
    expect(blockReason(example, 'M7')).toBeNull()
  })

  it('конфликт «в одном районе» блокирует только этот район', () => {
    const set: Decision[] = [{ measure_id: 'M7', district: 'nura' }]
    expect(districtConflict(set, 'M4', 'nura')).toBe('M4 несовместим с M7 здесь')
    expect(districtConflict(set, 'M4', 'esil')).toBeNull()
  })
})

describe('score: граничные правила формулы', () => {
  it('clip до 0..100 по каждому значению', () => {
    expect(clip(95 + 16)).toBe(100)
    expect(clip(-3)).toBe(0)
    expect(clip(39.9)).toBe(39.9)
  })

  it('N_crit — строго меньше 40', () => {
    const withNura = (v: number) => [...BASE_STATE.values.slice(0, 4), BASE_STATE.values[4].map((x) => (x < 40 ? v : x))]
    expect(summarize(withNura(40)).nCrit).toBe(0)
    expect(summarize(withNura(39.9)).nCrit).toBe(2)
  })

  it('синергия M1+M2: T1 +2 в районе M1, без лага, независимо от порядка', () => {
    const a = computeState([
      { measure_id: 'M1', district: 'esil' },
      { measure_id: 'M2', district: null },
    ])
    const b = computeState([
      { measure_id: 'M2', district: null },
      { measure_id: 'M1', district: 'esil' },
    ])
    // Есиль T1 45 + M1 6·6/8 + M2 4·6/8 + 2 (синергия целиком)
    expect(a.values[0][0]).toBeCloseTo(45 + 4.5 + 3 + 2, 10)
    expect(b.values[0][0]).toBe(a.values[0][0])
    expect(a.synergies).toEqual([{ pair: ['M1', 'M2'], district_id: 'esil', indicator: 'T1', bonus: 2 }])
    expect(computeState([{ measure_id: 'M1', district: 'esil' }]).synergies).toEqual([])
  })

  it('без мер в Нуре N_crit остаётся 2; M11 в Алматы добавляет третью пару', () => {
    expect(computeState(byName('naive_esil').decisions).nCrit).toBe(2)
    expect(computeState(byName('worst_of_all').decisions).nCrit).toBe(3)
  })
})

describe('timeline: 8 кварталов из формулы лага', () => {
  const decisions = byName('example_tz').decisions
  const points = timeline(decisions)

  it('Q0 = база, Q8 = Score по ТЗ', () => {
    expect(points).toHaveLength(9)
    expect(points[0].score).toBeCloseTo(BASE_STATE.score, 12)
    expect(points[8].score).toBeCloseTo(computeState(decisions).score, 12)
  })

  it('S1 Нуры 38 → 40.0 в Q4 (M7, лаг 3), S2 → 40.25 в Q6', () => {
    expect(points.map((p) => p.n_crit)).toEqual([2, 2, 2, 2, 1, 1, 0, 0, 0])
    expect(computeState(decisions, { quarter: 4 }).values[4][4]).toBeCloseTo(40, 10)
    expect(computeState(decisions, { quarter: 6 }).values[4][5]).toBeCloseTo(40.25, 10)
    expect(firstEffectQuarter('M7')).toBe(4)
  })

  it('синергия входит целиком с квартала max(L)+1', () => {
    const pair = [
      { measure_id: 'M1', district: 'esil' },
      { measure_id: 'M2', district: null },
    ]
    expect(computeState(pair, { quarter: 2 }).synergies).toEqual([])
    expect(computeState(pair, { quarter: 3 }).synergies).toHaveLength(1)
  })
})

describe('contributions: Шепли по 32 подмножествам', () => {
  it.each(['example_tz', 'optimum', 'worst_of_all'])('%s: Σ Шепли = Score − база, waterfall сходится', (name) => {
    const decisions = byName(name).decisions
    const delta = computeState(decisions).score - BASE_STATE.score
    const { contributions: c, waterfall } = contributions(decisions)
    expect(Object.values(c).reduce((s, x) => s + x.shapley, 0)).toBeCloseTo(delta, 10)
    expect(waterfall.reduce((s, w) => s + w.delta, 0)).toBeCloseTo(delta, 10)
  })

  it('канонический порядок waterfall M1..M14 (числовой), вклад на 1 у.е.', () => {
    const { contributions: c, waterfall } = contributions(byName('example_tz').decisions)
    expect(waterfall.map((w) => w.measure_id)).toEqual(['M5', 'M7', 'M8', 'M10', 'M12'])
    expect(c.M7.per_unit).toBeCloseTo(c.M7.shapley / 24, 12)
    expect(waterfall[1].label).toBe('M7 · Нура')
  })
})

describe('evaluate: полный EvalResult локально', () => {
  it('пример ТЗ', () => {
    const out = evaluateLocal(byName('example_tz').decisions)
    if (!out.ok) throw new Error('ожидался валидный набор')
    const r = out.data
    expect(r.score).toBeCloseTo(56.543, 3)
    expect([r.cost, r.remaining, r.n_crit]).toEqual([95, 5, 0])
    expect(r.critical_pairs.closed.map((p) => p.indicator)).toEqual(['S1', 'S2'])
    expect(r.critical_pairs.new).toEqual([])
    expect(r.min_district.id).toBe('nura')
    expect(r.districts.nura.d_after).toBeCloseTo(52.96, 2)
    expect(r.synergies_triggered).toEqual([{ pair: ['M10', 'M12'], district_id: 'nura', indicator: 'B1', bonus: 2 }])
    expect(r.components.d_avg_term + r.components.min_term + r.components.crit_term).toBeCloseTo(r.score, 10)
    expect(r.scenario_id).toMatch(/^[0-9a-f]{12}$/)
    expect(r.data_hash).toMatch(/^[0-9a-f]{12}$/)
  })

  it('невалидный набор → причины, а не число', () => {
    expect(evaluateLocal(byName('invalid_budget').decisions)).toMatchObject({ ok: false, violations: [{ code: 'BUDGET_EXCEEDED' }] })
    expect(evaluateLocal(byName('example_tz').decisions.slice(0, 3)).ok).toBe(false)
    expect(evaluateLocal(byName('example_tz').decisions.slice(0, 3), { allowPartial: true }).ok).toBe(true)
  })

  it('scenario_id не зависит от порядка решений; sha256 по эталонным векторам', () => {
    const d = byName('example_tz').decisions
    expect(scenarioId([...d].reverse())).toBe(scenarioId(d))
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('whatif и neighbors', () => {
  it('ловушка M11: Алматы −0.87 (новая критическая пара), Нура +0.32', () => {
    const options = whatIf([], 'M11')
    const at = (id: string) => options.find((o) => o.district === id)!
    expect(at('almaty').delta).toBeCloseTo(51.687 - 52.558, 2)
    expect(at('almaty').nCrit).toBe(3)
    expect(at('nura').delta).toBeCloseTo(52.875 - 52.558, 2)
    expect(options.filter((o) => o.best)).toHaveLength(1)
  })

  it('район с конфликтом «в одном районе» заблокирован', () => {
    const nura = whatIf([{ measure_id: 'M7', district: 'nura' }], 'M4').find((o) => o.district === 'nura')!
    expect(nura.blocked).toBe('M4 несовместим с M7 здесь')
    expect(nura.best).toBe(false)
  })

  it('городская мера — один вариант', () => {
    expect(whatIf([], 'M12').map((o) => o.district)).toEqual([null])
  })

  it('соседи на один шаг: только валидные, по убыванию Score', () => {
    const list = neighbors(byName('example_tz').decisions)
    expect(list.length).toBeGreaterThan(50)
    for (const n of list) expect(validateDecisions(n.decisions)).toEqual([])
    expect(list[0].score).toBeGreaterThanOrEqual(list[list.length - 1].score)
    expect(neighbors(byName('optimum').decisions)[0].delta).toBeLessThanOrEqual(0)
  })
})
