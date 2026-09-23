import { describe, expect, it } from 'vitest'
import type { Decision } from '../types/api'
import { RULES } from './catalog'
import { BASE_STATE, computeState, formulaComponents } from './score'
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
