// Соседние сценарии на один шаг: замена любой меры на свободную (во всех районах) и перенос
// районной меры в другой район. Только валидные наборы; число соседей — длина реального массива.

import type { Decision } from '../types/api'
import { DISTRICT_IDS } from '../types/data'
import { MEASURES, MEASURE_BY_ID, districtName } from './catalog'
import { canonicalScenario } from './hash'
import { computeState } from './score'
import { decisionsCost, validateDecisions } from './validate'

export interface Neighbor {
  kind: 'replace' | 'move'
  /** «Заменить M12 → M14» / «Перенести M3 Есиль → Нура». */
  change: string
  decisions: Decision[]
  score: number
  delta: number
  cost: number
  nCrit: number
}

function label(d: Decision): string {
  return d.district === null ? `${d.measure_id} (город)` : `${d.measure_id} ${districtName(d.district)}`
}

export function neighbors(decisions: readonly Decision[]): Neighbor[] {
  const current = computeState(decisions).score
  const used = new Set(decisions.map((d) => d.measure_id))
  const seen = new Set<string>([canonicalScenario(decisions)])
  const out: Neighbor[] = []

  function consider(kind: Neighbor['kind'], change: string, next: Decision[]) {
    const key = canonicalScenario(next)
    if (seen.has(key)) return
    seen.add(key)
    if (validateDecisions(next).length) return
    const state = computeState(next)
    out.push({ kind, change, decisions: next, score: state.score, delta: state.score - current, cost: decisionsCost(next), nCrit: state.nCrit })
  }

  decisions.forEach((dec, i) => {
    for (const m of MEASURES) {
      if (used.has(m.id)) continue
      const targets = m.type === 'city' ? [null] : DISTRICT_IDS
      for (const district of targets) {
        const replacement = { measure_id: m.id, district }
        consider('replace', `Заменить ${label(dec)} → ${label(replacement)}`, decisions.map((d, j) => (j === i ? replacement : d)))
      }
    }
    if (MEASURE_BY_ID.get(dec.measure_id)?.type !== 'district') return
    for (const district of DISTRICT_IDS) {
      if (district === dec.district) continue
      consider(
        'move',
        `Перенести ${dec.measure_id} ${districtName(dec.district)} → ${districtName(district)}`,
        decisions.map((d, j) => (j === i ? { measure_id: d.measure_id, district } : d)),
      )
    }
  })

  return out.sort((a, b) => b.score - a.score)
}
