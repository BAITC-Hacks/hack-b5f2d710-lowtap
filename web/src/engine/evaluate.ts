// Полный EvalResult локальным движком — зеркало POST /api/evaluate (контракт §7).
// Невалидный набор → причины (как 422 сервера), Score не считается.

import type { CriticalPair, Decision, DistrictResult, EvalResult, Violation } from '../types/api'
import { DISTRICT_IDS, INDICATOR_CODES, type DistrictId, type IndicatorCode } from '../types/data'
import { DISTRICT_BY_ID, MEASURE_BY_ID, RULES } from './catalog'
import { contributions } from './contributions'
import { percentileOf } from './distribution'
import { DATA_HASH, scenarioId } from './hash'
import { BASE_STATE, computeState, formulaComponents } from './score'
import { timeline } from './timeline'
import { decisionsCost, validateDecisions } from './validate'

export const ENGINE_VERSION = 'ts-1.0'

export type LocalOutcome = { ok: true; data: EvalResult } | { ok: false; violations: Violation[] }

const pairKey = (p: CriticalPair) => `${p.district_id}.${p.indicator}`
const byCode = (row: number[]) => Object.fromEntries(INDICATOR_CODES.map((code, k) => [code, row[k]])) as Record<IndicatorCode, number>

/**
 * allowPartial — для таймлайна и превью на неполном наборе (как golden-фикстуры бэкенда
 * с allow_partial): «ровно 5» не проверяется, остальные правила действуют.
 */
export function evaluateLocal(decisions: readonly Decision[], opts: { allowPartial?: boolean } = {}): LocalOutcome {
  const violations = validateDecisions(decisions).filter((v) => !(opts.allowPartial && v.code === 'NOT_FIVE'))
  if (violations.length) return { ok: false, violations }
  return { ok: true, data: buildEvalResult(decisions) }
}

function buildEvalResult(decisions: readonly Decision[]): EvalResult {
  const state = computeState(decisions)
  const base = BASE_STATE
  const cost = decisionsCost(decisions)
  const beforeKeys = new Set(base.critical.map(pairKey))
  const afterKeys = new Set(state.critical.map(pairKey))
  const { contributions: contrib, waterfall } = contributions(decisions)

  const districts = Object.fromEntries(
    DISTRICT_IDS.map((id, i): [DistrictId, DistrictResult] => [
      id,
      {
        d_before: base.d[i],
        d_after: state.d[i],
        delta: state.d[i] - base.d[i],
        indicators_before: byCode(base.values[i]),
        indicators_after: byCode(state.values[i]),
        deltas: byCode(state.values[i].map((v, k) => v - base.values[i][k])),
      },
    ]),
  ) as Record<DistrictId, DistrictResult>

  const minId = DISTRICT_IDS[state.minIdx]
  return {
    ok: true,
    scenario_id: scenarioId(decisions),
    score: state.score,
    baseline: base.score,
    delta: state.score - base.score,
    percentile: percentileOf(state.score),
    cost,
    remaining: RULES.budget - cost,
    d_avg: state.dAvg,
    min_district: { id: minId, name_ru: DISTRICT_BY_ID.get(minId)!.name_ru, d: state.minD },
    n_crit: state.nCrit,
    components: formulaComponents(state, base),
    critical_pairs: {
      before: base.critical,
      after: state.critical,
      closed: base.critical.filter((p) => !afterKeys.has(pairKey(p))),
      new: state.critical.filter((p) => !beforeKeys.has(pairKey(p))),
    },
    districts,
    contributions: contrib,
    waterfall: waterfall.map((w) => ({ ...w, label: MEASURE_BY_ID.get(w.measure_id)?.name_ru ?? w.measure_id })),
    synergies_triggered: state.synergies,
    timeline: timeline(decisions),
    data_hash: DATA_HASH,
    engine_version: ENGINE_VERSION,
  }
}
