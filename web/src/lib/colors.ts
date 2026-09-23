// Цвета из токенов (tokens.css) для SVG и inline-стилей.

import { scaleQuantize } from 'd3-scale'
import type { DirectionCode } from '../types/data'

export const DIRECTION_COLOR: Record<DirectionCode, string> = {
  T: 'var(--dir-t)',
  E: 'var(--dir-e)',
  S: 'var(--dir-s)',
  B: 'var(--dir-b)',
  C: 'var(--dir-c)',
}

/** Последовательная шкала карты, домен 40–80 фиксирован для всех экранов и сценариев. */
export const MAP_DOMAIN: [number, number] = [40, 80]
export const mapColor = scaleQuantize<string>()
  .domain(MAP_DOMAIN)
  .range(['var(--map-1)', 'var(--map-2)', 'var(--map-3)', 'var(--map-4)', 'var(--map-5)'])

/** На тёмных ступенях шкалы подписи района светлые. */
export function labelInk(value: number): string {
  return value >= 56 ? 'var(--panel)' : 'var(--ink)'
}
