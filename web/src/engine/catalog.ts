// Каталог: датасет ТЗ из data/*.json (общий с бэкендом) в удобных для движка индексах.

import districtsJson from '@data/districts.json'
import measuresJson from '@data/measures.json'
import rulesJson from '@data/rules.json'
import {
  DISTRICT_IDS,
  INDICATOR_CODES,
  type District,
  type DistrictId,
  type IndicatorCode,
  type Measure,
  type Rules,
} from '../types/data'

export const RULES = rulesJson as unknown as Rules
export const DISTRICTS = (districtsJson as unknown as { districts: District[] }).districts
export const MEASURES = (measuresJson as unknown as { measures: Measure[] }).measures

export const DISTRICT_BY_ID = new Map<string, District>(DISTRICTS.map((d) => [d.id, d]))
export const MEASURE_BY_ID = new Map<string, Measure>(MEASURES.map((m) => [m.id, m]))

/** Индекс района в матрицах движка (порядок DISTRICT_IDS). */
export const DISTRICT_INDEX: Record<DistrictId, number> = Object.fromEntries(
  DISTRICT_IDS.map((id, i) => [id, i]),
) as Record<DistrictId, number>

export const INDICATOR_INDEX: Record<IndicatorCode, number> = Object.fromEntries(
  INDICATOR_CODES.map((code, i) => [code, i]),
) as Record<IndicatorCode, number>

/** Веса показателей в порядке INDICATOR_CODES. */
export const WEIGHTS: number[] = INDICATOR_CODES.map(
  (code) => RULES.indicators.find((ind) => ind.code === code)!.weight,
)

/** Доли населения в порядке DISTRICT_IDS. */
export const POP: number[] = DISTRICT_IDS.map((id) => DISTRICT_BY_ID.get(id)!.pop_share)

/** Базовая матрица 5×10: BASE_MATRIX[районИндекс][показательИндекс]. */
export const BASE_MATRIX: number[][] = DISTRICT_IDS.map((id) =>
  INDICATOR_CODES.map((code) => DISTRICT_BY_ID.get(id)!.indicators[code]),
)

export function isDistrictId(value: unknown): value is DistrictId {
  return typeof value === 'string' && (DISTRICT_IDS as readonly string[]).includes(value)
}

export function districtName(id: string | null): string {
  if (id === null) return 'город'
  return DISTRICT_BY_ID.get(id)?.name_ru ?? id
}

export function directionName(code: string): string {
  return RULES.directions.find((d) => d.code === code)?.name_ru ?? code
}

// Консистентность данных проверяется один раз при загрузке: движок не должен
// молча считать по неполному датасету.
if (DISTRICTS.length !== DISTRICT_IDS.length || DISTRICT_IDS.some((id) => !DISTRICT_BY_ID.has(id))) {
  throw new Error('data/districts.json: ожидались районы ' + DISTRICT_IDS.join(', '))
}
