// Пресеты из data/scenarios: 5 валидных наборов + «Невалидный: бюджет».
// Числа в меню считает движок при загрузке — в интерфейсе нет захардкоженных Score.

import type { Decision } from '../types/api'
import { computeState } from './score'
import { decisionsCost, validateDecisions } from './validate'

interface ScenarioFile {
  name_ru: string
  decisions: Decision[]
}

const files = import.meta.glob<ScenarioFile>('@data/scenarios/*.json', { eager: true, import: 'default' })
const byName = (name: string) => Object.entries(files).find(([path]) => path.endsWith(`/${name}.json`))?.[1]

export interface Preset {
  id: string
  label: string
  decisions: Decision[]
  cost: number
  /** null — набор невалиден, Score не считается. */
  score: number | null
}

const PRESETS_ORDER: [string, string][] = [
  ['example_tz', 'Пример ТЗ'],
  ['cheapest', 'Дешёвый'],
  ['naive_esil', 'Наивный аким'],
  ['worst_of_all', 'Худший'],
  ['optimum', 'Оптимум'],
  ['invalid_budget', 'Невалидный: бюджет'],
]

export const PRESETS: Preset[] = PRESETS_ORDER.flatMap(([id, label]) => {
  const file = byName(id)
  if (!file) return []
  const valid = validateDecisions(file.decisions).length === 0
  return [{ id, label, decisions: file.decisions, cost: decisionsCost(file.decisions), score: valid ? computeState(file.decisions).score : null }]
})

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}
