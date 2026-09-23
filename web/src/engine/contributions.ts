// Вклады решений: значение Шепли по всем подмножествам набора (2^n, для 5 решений — 32).
// На подмножествах правило «ровно 5» не действует, синергия срабатывает только при обеих мерах пары;
// функция — полный Score с N_crit. Σ Шепли = Score − база. Плюс leave-one-out и вклад на 1 у.е.

import type { Contribution, Decision, WaterfallItem } from '../types/api'
import { MEASURE_BY_ID, districtName } from './catalog'
import { computeState } from './score'

/** Номер меры для канонического порядка M1..M14 (числовой, не строковый). */
export function measureOrder(id: string): number {
  const n = Number(id.replace(/^M/, ''))
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
}

function factorial(n: number): number {
  let out = 1
  for (let i = 2; i <= n; i++) out *= i
  return out
}

export interface Contributions {
  contributions: Record<string, Contribution>
  waterfall: WaterfallItem[]
}

export function contributions(decisions: readonly Decision[]): Contributions {
  const n = decisions.length
  const value = new Float64Array(1 << n)
  for (let mask = 0; mask < 1 << n; mask++) {
    value[mask] = computeState(decisions.filter((_, i) => mask & (1 << i))).score
  }
  const full = (1 << n) - 1
  const nFact = factorial(n)

  const out: Record<string, Contribution> = {}
  decisions.forEach((dec, i) => {
    const bit = 1 << i
    let shapley = 0
    for (let mask = 0; mask <= full; mask++) {
      if (mask & bit) continue
      let size = 0
      for (let m = mask; m; m &= m - 1) size++
      shapley += ((factorial(size) * factorial(n - size - 1)) / nFact) * (value[mask | bit] - value[mask])
    }
    const cost = MEASURE_BY_ID.get(dec.measure_id)?.cost ?? 0
    out[dec.measure_id] = {
      shapley,
      loo: value[full] - value[full & ~bit],
      per_unit: cost ? shapley / cost : 0,
    }
  })

  const waterfall = [...decisions]
    .sort((a, b) => measureOrder(a.measure_id) - measureOrder(b.measure_id))
    .map((dec) => ({
      label: `${dec.measure_id} · ${districtName(dec.district)}`,
      measure_id: dec.measure_id,
      delta: out[dec.measure_id].shapley,
    }))

  return { contributions: out, waterfall }
}
