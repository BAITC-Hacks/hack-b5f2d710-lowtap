// Цвета из токенов (tokens.css) для SVG и inline-стилей.

import { interpolateRgb } from 'd3-interpolate'
import { scaleDiverging, scaleQuantize } from 'd3-scale'
import type { DirectionCode, DistrictId } from '../types/data'

export const DIRECTION_COLOR: Record<DirectionCode, string> = {
  T: 'var(--dir-t)',
  E: 'var(--dir-e)',
  S: 'var(--dir-s)',
  B: 'var(--dir-b)',
  C: 'var(--dir-c)',
}

/** Свой цвет каждого района (заливка карты Пульта в режиме D) и тон обводки. */
export const DISTRICT_COLOR: Record<DistrictId, { fill: string; line: string }> = {
  esil: { fill: 'var(--district-esil)', line: 'var(--district-esil-line)' },
  almaty: { fill: 'var(--district-almaty)', line: 'var(--district-almaty-line)' },
  saryarka: { fill: 'var(--district-saryarka)', line: 'var(--district-saryarka-line)' },
  baikonur: { fill: 'var(--district-baikonur)', line: 'var(--district-baikonur-line)' },
  nura: { fill: 'var(--district-nura)', line: 'var(--district-nura-line)' },
}

/** Последовательная шкала карты, домен 40–80 фиксирован для всех экранов и сценариев. */
export const MAP_DOMAIN: [number, number] = [40, 80]
export const MAP_STEPS = ['var(--map-1)', 'var(--map-2)', 'var(--map-3)', 'var(--map-4)', 'var(--map-5)']
export const mapColor = scaleQuantize<string>().domain(MAP_DOMAIN).range(MAP_STEPS)

/** На тёмных ступенях шкалы подписи района светлые. */
export function labelInk(value: number): string {
  return value >= 56 ? 'var(--panel)' : 'var(--ink)'
}

// Дивергентная шкала «Δ» интерполируется в JS, поэтому берёт hex светлой темы (демо — светлая).
const DOWN = '#C2452F'
const NEUTRAL = '#FFFFFF'
const UP = '#1F8A64'

/** ΔD района: домен ±3 фиксирован. */
export const deltaColor = scaleDiverging<string>()
  .domain([-3, 0, 3])
  .interpolator((t) => (t < 0.5 ? interpolateRgb(DOWN, NEUTRAL)(t * 2) : interpolateRgb(NEUTRAL, UP)((t - 0.5) * 2)))
  .clamp(true)

export function signColor(x: number): string {
  if (Math.abs(x) < 0.005) return 'var(--ink-2)'
  return x > 0 ? 'var(--up)' : 'var(--down)'
}
