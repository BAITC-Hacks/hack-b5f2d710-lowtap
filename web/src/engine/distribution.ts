// Распределение Score по всем 694 395 валидным наборам (data/plan_distribution.json генерирует
// бэкенд перебором). В бандле — выжимка из vite.config.ts; нет файла — перцентиль не показывается.

import distribution from 'virtual:plan-distribution'
import type { ClientDistribution } from '../types/api'

export const DISTRIBUTION: ClientDistribution | null = distribution

/**
 * Доля валидных наборов со Score строго меньше данного, в процентах. Офлайн — по кумулятивной
 * таблице с шагом 0.001 и линейной интерполяцией (расхождение с точным серверным < 0.005 п.п.).
 */
export function percentileOf(score: number, dist: ClientDistribution | null = DISTRIBUTION): number | null {
  if (!dist) return null
  // У вершины распределения таблица грубая, зато top20 знает эти планы поимённо — считаем точно.
  const top = dist.top20
  if (top.length && score >= top[top.length - 1].score - 1e-9) {
    const atOrAbove = top.filter((p) => p.score >= score - 5e-11).length
    return (100 * (dist.count - atOrAbove)) / dist.count
  }
  const { start, step, cum } = dist.fine
  const x = (score - start) / step
  if (x <= 0) return 0
  if (x >= cum.length - 1) return (100 * cum[cum.length - 1]) / dist.count
  const i = Math.floor(x)
  return (100 * (cum[i] + (cum[i + 1] - cum[i]) * (x - i))) / dist.count
}
