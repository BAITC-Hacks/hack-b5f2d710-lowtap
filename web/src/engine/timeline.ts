// Таймлайн 8 кварталов — наша визуализация лага, выведенная из формулы ТЗ:
//   Score(q): эффект × max(0, q − L)/8; синергия целиком с q = max(L_a, L_b) + 1; N_crit(q) по clip'нутым I'(q).
//   Q0 = база, Q8 = Score по ТЗ.

import type { Decision, TimelinePoint } from '../types/api'
import { DISTRICT_IDS, type DistrictId } from '../types/data'
import { MEASURE_BY_ID, RULES } from './catalog'
import { computeState, type EngineState } from './score'

export function quarterStates(decisions: readonly Decision[]): EngineState[] {
  return Array.from({ length: RULES.horizon_quarters + 1 }, (_, q) => computeState(decisions, { quarter: q }))
}

export function timeline(decisions: readonly Decision[]): TimelinePoint[] {
  return quarterStates(decisions).map((state, q) => ({
    q,
    score: state.score,
    n_crit: state.nCrit,
    d: Object.fromEntries(DISTRICT_IDS.map((id, i) => [id, state.d[i]])) as Record<DistrictId, number>,
  }))
}

/** Квартал, в котором мера даёт первый ненулевой эффект (пин «загорается»): L + 1. */
export function firstEffectQuarter(measureId: string): number | null {
  const measure = MEASURE_BY_ID.get(measureId)
  return measure ? measure.lag + 1 : null
}
