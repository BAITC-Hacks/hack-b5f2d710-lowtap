// «Что если»: мера на каждом из 5 районов (или сразу на городе) → предсказанный Score и дельта
// к текущему набору; районы с конфликтом «в одном районе» заблокированы.

import type { Decision } from '../types/api'
import { DISTRICT_IDS, type DistrictId } from '../types/data'
import { MEASURE_BY_ID } from './catalog'
import { computeState } from './score'
import { districtConflict } from './validate'

/** Набор после постановки меры: уже стоящая мера переставляется, новая — добавляется. */
export function withDecision(decisions: readonly Decision[], measureId: string, district: string | null): Decision[] {
  const measure = MEASURE_BY_ID.get(measureId)
  const next: Decision = { measure_id: measureId, district: measure?.type === 'city' ? null : district }
  const at = decisions.findIndex((d) => d.measure_id === measureId)
  return at === -1 ? [...decisions, next] : decisions.map((d, i) => (i === at ? next : d))
}

export interface WhatIfOption {
  district: DistrictId | null
  score: number
  delta: number
  nCrit: number
  /** Причина, по которой сюда ставить нельзя (клик заблокирован). */
  blocked: string | null
  best: boolean
}

export function whatIf(decisions: readonly Decision[], measureId: string): WhatIfOption[] {
  const measure = MEASURE_BY_ID.get(measureId)
  if (!measure) return []
  const current = computeState(decisions).score
  const others = decisions.filter((d) => d.measure_id !== measureId)
  const targets: (DistrictId | null)[] = measure.type === 'city' ? [null] : [...DISTRICT_IDS]

  const options = targets.map((district): WhatIfOption => {
    const state = computeState(withDecision(decisions, measureId, district))
    return {
      district,
      score: state.score,
      delta: state.score - current,
      nCrit: state.nCrit,
      blocked: district === null ? null : districtConflict(others, measureId, district),
      best: false,
    }
  })
  const open = options.filter((o) => !o.blocked)
  if (open.length > 1) {
    const top = open.reduce((a, b) => (b.score > a.score ? b : a))
    top.best = true
  }
  return options
}
