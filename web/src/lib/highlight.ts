// Число в записке → что подсветить на графиках (одно направление: чип → график).

import type { EvalResult } from '../types/api'
import { DISTRICT_IDS, type DistrictId } from '../types/data'

export interface Highlight {
  measure: string | null
  district: DistrictId | null
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.005 + 1e-9

export function resolveHighlight(value: number | null, result: EvalResult | null): Highlight {
  const none = { measure: null, district: null }
  if (value === null || !result) return none
  for (const [id, c] of Object.entries(result.contributions)) {
    if (near(c.shapley, value) || near(c.loo, Math.abs(value))) return { measure: id, district: null }
  }
  for (const id of DISTRICT_IDS) {
    const d = result.districts[id]
    if ([d.d_after, d.d_before, d.delta].some((v) => near(v, value))) return { measure: null, district: id }
    if (Object.values(d.indicators_after).some((v) => near(v, value)) || Object.values(d.indicators_before).some((v) => near(v, value))) {
      return { measure: null, district: id }
    }
  }
  if (near(result.min_district.d, value)) return { measure: null, district: result.min_district.id }
  return none
}
