// Типы датасета ТЗ (data/districts.json, data/measures.json, data/rules.json).
// Данные заморожены и общие с бэкендом; здесь только их форма.

export const DISTRICT_IDS = ['esil', 'almaty', 'saryarka', 'baikonur', 'nura'] as const
export type DistrictId = (typeof DISTRICT_IDS)[number]

export const INDICATOR_CODES = ['T1', 'T2', 'E1', 'E2', 'S1', 'S2', 'B1', 'B2', 'C1', 'C2'] as const
export type IndicatorCode = (typeof INDICATOR_CODES)[number]

export const DIRECTION_CODES = ['T', 'E', 'S', 'B', 'C'] as const
export type DirectionCode = (typeof DIRECTION_CODES)[number]

export type MeasureType = 'district' | 'city'

export interface District {
  id: DistrictId
  name_ru: string
  name_kk: string
  osm_relation: number
  pop_share: number
  profile_ru: string
  indicators: Record<IndicatorCode, number>
  d_base: number
}

export interface Measure {
  id: string
  direction: DirectionCode
  direction_ru: string
  direction_tz_ru: string
  name_ru: string
  type: MeasureType
  cost: number
  lag: number
  effects: Partial<Record<IndicatorCode, number>>
}

export interface Direction {
  code: DirectionCode
  name_ru: string
  name_tz_ru: string
  weight: number
}

export interface Indicator {
  code: IndicatorCode
  direction: DirectionCode
  name_ru: string
  meaning_100: string
  meaning_0: string
  weight: number
}

export interface Synergy {
  pair: [string, string]
  bonus_indicator: IndicatorCode
  bonus: number
  district_from: string
}

export interface Incompatibility {
  pair: [string, string]
  scope: 'any' | 'same_district'
  code: 'INCOMPATIBLE_M1_M3' | 'CONFLICT_M4_M7' | 'CONFLICT_M5_M13'
  reason_ru: string
}

export interface Rules {
  version: string
  budget: number
  decisions_required: number
  max_per_direction: number
  horizon_quarters: number
  critical_threshold: number
  score: {
    formula: string
    d_avg_weight: number
    min_weight: number
    crit_penalty: number
    baseline: number
  }
  directions: Direction[]
  indicators: Indicator[]
  synergies: Synergy[]
  synergy_note: string
  incompatibilities: Incompatibility[]
  validation_codes: string[]
}
