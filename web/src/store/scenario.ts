// Набор решений акима + история для Ctrl+Z. Стор правила не проверяет: пресеты и
// пермалинки могут принести и невалидный набор — его показывает валидатор, а не стор.

import { create } from 'zustand'
import { MEASURE_BY_ID } from '../engine/catalog'
import type { Decision } from '../types/api'

const HISTORY_LIMIT = 50

interface ScenarioState {
  decisions: Decision[]
  /** Предыдущие наборы, последний — ближайший. */
  past: Decision[][]

  /** Поставить меру; уже стоящая мера переставляется в другой район, сохраняя своё гнездо. */
  place: (measureId: string, district: string | null) => void
  remove: (measureId: string) => void
  /** Пресет или пермалинк целиком. */
  load: (decisions: Decision[]) => void
  reset: () => void
  undo: () => void
}

function sameSet(a: readonly Decision[], b: readonly Decision[]): boolean {
  return a.length === b.length && a.every((d, i) => d.measure_id === b[i].measure_id && d.district === b[i].district)
}

export const useScenario = create<ScenarioState>()((set, get) => {
  function commit(next: Decision[]) {
    const { decisions, past } = get()
    if (sameSet(decisions, next)) return
    set({ decisions: next, past: [...past, decisions].slice(-HISTORY_LIMIT) })
  }

  return {
    decisions: [],
    past: [],

    place: (measureId, district) => {
      const measure = MEASURE_BY_ID.get(measureId)
      const decision: Decision = { measure_id: measureId, district: measure?.type === 'city' ? null : district }
      const { decisions } = get()
      const at = decisions.findIndex((d) => d.measure_id === measureId)
      commit(at === -1 ? [...decisions, decision] : decisions.map((d, i) => (i === at ? decision : d)))
    },
    remove: (measureId) => commit(get().decisions.filter((d) => d.measure_id !== measureId)),
    load: (decisions) => commit(decisions.map((d) => ({ measure_id: d.measure_id, district: d.district }))),
    reset: () => commit([]),
    undo: () => {
      const { past } = get()
      if (!past.length) return
      set({ decisions: past[past.length - 1], past: past.slice(0, -1) })
    },
  }
})
