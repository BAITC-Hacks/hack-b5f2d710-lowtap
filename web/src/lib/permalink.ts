// Экран и набор решений живут в location.hash — без роутера:
//   #/pult?d=M7:nura,M8:nura,M10:nura,M12,M5:saryarka

import type { Decision } from '../types/api'

export const SCREENS = ['pult', 'verdict', 'compare'] as const
export type Screen = (typeof SCREENS)[number]

/** [{M7, nura}, {M12, null}] → «M7:nura,M12». */
export function encodeDecisions(decisions: readonly Decision[]): string {
  return decisions.map((d) => (d.district === null ? d.measure_id : `${d.measure_id}:${d.district}`)).join(',')
}

/** Обратное к encodeDecisions. Неизвестные id сохраняются как есть — их отметит валидатор. */
export function decodeDecisions(value: string): Decision[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [measureId, district] = part.split(':')
      return { measure_id: measureId, district: district ? district : null }
    })
}

export interface HashState {
  screen: Screen
  /** null — в hash нет параметра d (набор не задан ссылкой). */
  decisions: Decision[] | null
}

export function parseHash(hash: string): HashState {
  const body = hash.replace(/^#\/?/, '')
  const [path, query = ''] = body.split('?')
  const screen = (SCREENS as readonly string[]).includes(path) ? (path as Screen) : 'pult'
  const d = new URLSearchParams(query).get('d')
  return { screen, decisions: d === null ? null : decodeDecisions(d) }
}

export function buildHash(screen: Screen, decisions: readonly Decision[]): string {
  // URLSearchParams кодировал бы «:» и «,» — ссылка перестала бы читаться глазами.
  return decisions.length ? `#/${screen}?d=${encodeDecisions(decisions)}` : `#/${screen}`
}
