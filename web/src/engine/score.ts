// Формула ТЗ, зеркало Python-движка (docs/ARCHITECTURE.md, «Детерминированный движок»):
//   I'_dk = clip(I_dk + Σ эффект × (8 − L)/8 + синергии, 0, 100)
//   D_d   = Σ w_k · I'_dk;   D_avg = Σ pop_d · D_d
//   Score = 0.7 · D_avg + 0.3 · min D_d − 1.0 · N_crit,  N_crit — число I' строго < 40 по всем 5×10.
// Синергия — фиксированный бонус без лага в районе меры district_from.
// Таймлайн (quarter = q): эффект × max(0, q − L)/8, синергия целиком с q = max(L_a, L_b) + 1.

import type { Components, CriticalPair, Decision, SynergyTriggered } from '../types/api'
import { DISTRICT_IDS, INDICATOR_CODES, type Measure } from '../types/data'
import { BASE_MATRIX, DISTRICT_INDEX, INDICATOR_INDEX, MEASURE_BY_ID, POP, RULES, WEIGHTS, isDistrictId } from './catalog'

export interface EngineOptions {
  /** Квартал 0..8 для таймлайна; не задан — итог по формуле ТЗ (доля (8 − L)/8). */
  quarter?: number
}

export interface EngineState {
  /** I' после clip: values[район][показатель] в порядке DISTRICT_IDS × INDICATOR_CODES. */
  values: number[][]
  /** D_d в порядке DISTRICT_IDS. */
  d: number[]
  dAvg: number
  minD: number
  minIdx: number
  nCrit: number
  score: number
  critical: CriticalPair[]
  synergies: SynergyTriggered[]
}

interface Active {
  measure: Measure
  /** null — мера «Город», эффект во всех районах. */
  districtIdx: number | null
}

const ALL_DISTRICTS = DISTRICT_IDS.map((_, i) => i)

/**
 * Решения, которые движок может применить: известная мера, для «Район» — известный район.
 * Повтор меры учитывается один раз (набор с повтором всё равно невалиден).
 */
function resolve(decisions: readonly Decision[]): Active[] {
  const seen = new Set<string>()
  const active: Active[] = []
  for (const dec of decisions) {
    const measure = MEASURE_BY_ID.get(dec.measure_id)
    if (!measure || seen.has(measure.id)) continue
    if (measure.type === 'city') {
      active.push({ measure, districtIdx: null })
    } else if (isDistrictId(dec.district)) {
      active.push({ measure, districtIdx: DISTRICT_INDEX[dec.district] })
    } else {
      continue
    }
    seen.add(measure.id)
  }
  return active
}

/** Реализованная доля эффекта меры с лагом L: итог (8 − L)/8 или к кварталу q — max(0, q − L)/8. */
export function effectShare(lag: number, quarter?: number): number {
  const h = RULES.horizon_quarters
  if (quarter === undefined) return (h - lag) / h
  return Math.max(0, quarter - lag) / h
}

/** Первый квартал, в котором синергия пары входит целиком. */
export function synergyStartQuarter(lagA: number, lagB: number): number {
  return Math.max(lagA, lagB) + 1
}

export function computeState(decisions: readonly Decision[], opts: EngineOptions = {}): EngineState {
  const { quarter } = opts
  const raw = BASE_MATRIX.map((row) => row.slice())
  const active = resolve(decisions)
  const byId = new Map(active.map((a) => [a.measure.id, a]))

  for (const { measure, districtIdx } of active) {
    const share = effectShare(measure.lag, quarter)
    if (share === 0) continue
    const targets = districtIdx === null ? ALL_DISTRICTS : [districtIdx]
    for (const [code, effect] of Object.entries(measure.effects)) {
      const k = INDICATOR_INDEX[code as keyof typeof INDICATOR_INDEX]
      for (const i of targets) raw[i][k] += effect! * share
    }
  }

  const synergies: SynergyTriggered[] = []
  for (const syn of RULES.synergies) {
    const a = byId.get(syn.pair[0])
    const b = byId.get(syn.pair[1])
    const from = byId.get(syn.district_from)
    if (!a || !b || !from) continue
    if (quarter !== undefined && quarter < synergyStartQuarter(a.measure.lag, b.measure.lag)) continue
    const k = INDICATOR_INDEX[syn.bonus_indicator]
    const targets = from.districtIdx === null ? ALL_DISTRICTS : [from.districtIdx]
    for (const i of targets) {
      raw[i][k] += syn.bonus
      synergies.push({ pair: syn.pair, district_id: DISTRICT_IDS[i], indicator: syn.bonus_indicator, bonus: syn.bonus })
    }
  }

  return summarize(raw.map((row) => row.map(clip)), synergies)
}

export function clip(value: number): number {
  return Math.min(100, Math.max(0, value))
}

/** D_d, D_avg, min D, N_crit и Score по готовой (уже clip'нутой) матрице I'. */
export function summarize(values: number[][], synergies: SynergyTriggered[] = []): EngineState {
  const threshold = RULES.critical_threshold
  const d = values.map((row) => row.reduce((sum, v, k) => sum + WEIGHTS[k] * v, 0))
  const dAvg = d.reduce((sum, v, i) => sum + POP[i] * v, 0)
  let minIdx = 0
  for (let i = 1; i < d.length; i++) if (d[i] < d[minIdx]) minIdx = i
  const critical: CriticalPair[] = []
  values.forEach((row, i) =>
    row.forEach((v, k) => {
      if (v < threshold) critical.push({ district_id: DISTRICT_IDS[i], indicator: INDICATOR_CODES[k], value: v })
    }),
  )
  const { d_avg_weight, min_weight, crit_penalty } = RULES.score
  const minD = d[minIdx]
  const nCrit = critical.length
  const score = d_avg_weight * dAvg + min_weight * minD - crit_penalty * nCrit
  return { values, d, dAvg, minD, minIdx, nCrit, score, critical, synergies }
}

/** Состояние города без решений: база ТЗ 52.558. */
export const BASE_STATE: EngineState = computeState([])

/** Три слагаемых формулы для карточек: текущие и базовые. */
export function formulaComponents(state: EngineState, base: EngineState = BASE_STATE): Components {
  const { d_avg_weight, min_weight, crit_penalty } = RULES.score
  return {
    d_avg_term: d_avg_weight * state.dAvg,
    min_term: min_weight * state.minD,
    crit_term: -crit_penalty * state.nCrit,
    d_avg_term_base: d_avg_weight * base.dAvg,
    min_term_base: min_weight * base.minD,
    crit_term_base: -crit_penalty * base.nCrit,
  }
}
