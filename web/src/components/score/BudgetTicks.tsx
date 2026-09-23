import { useState } from 'react'
import { MEASURE_BY_ID, RULES } from '../../engine/catalog'
import { DIRECTION_COLOR } from '../../lib/colors'
import type { Decision } from '../../types/api'

const TICK = 2
const STEP = 3
const GROUP_GAP = 2

/**
 * 100 тиков бюджета: потраченные — цветом направления меры (группами), остаток — золотом.
 * Перерасход: шкала растягивается до стоимости набора, тики сверх лимита — красные «призраки»,
 * черта отмечает 100 у.е., полоса вспыхивает.
 */
export function BudgetTicks({ decisions, cost }: { decisions: readonly Decision[]; cost: number }) {
  const budget = RULES.budget
  const over = Math.max(0, cost - budget)
  const total = Math.max(budget, cost)
  // Предыдущая стоимость — чтобы тики гасли/загорались по одному, начиная с места изменения.
  const [prevCost, setPrevCost] = useState(cost)
  const [changedFrom, setChangedFrom] = useState(cost)
  const [flash, setFlash] = useState(0)
  if (cost !== prevCost) {
    setChangedFrom(Math.min(prevCost, cost))
    if (cost > budget && prevCost <= budget) setFlash((n) => n + 1)
    setPrevCost(cost)
  }

  const ticks: { x: number; color: string }[] = []
  let x = 0
  let spent = 0
  decisions.forEach((d, g) => {
    const measure = MEASURE_BY_ID.get(d.measure_id)
    if (!measure) return
    if (g > 0) x += GROUP_GAP
    for (let i = 0; i < measure.cost; i++) {
      ticks.push({ x, color: spent >= budget ? 'var(--down)' : DIRECTION_COLOR[measure.direction] })
      x += STEP
      spent++
    }
  })
  for (let i = spent; i < total; i++) {
    ticks.push({ x, color: 'var(--gold)' })
    x += STEP
  }
  const width = x
  const limitX = budget * STEP + Math.max(0, decisions.length - 1) * GROUP_GAP

  return (
    <svg
      key={flash}
      viewBox={`0 -2 ${width} 14`}
      preserveAspectRatio="none"
      className={flash ? 'budget-flash' : undefined}
      style={{ width: '100%', height: 14, display: 'block' }}
      role="img"
      aria-label={`Потрачено ${cost} из ${budget} у.е.`}
    >
      {ticks.map((t, i) => (
        <rect
          key={i}
          x={t.x}
          y={0}
          width={TICK}
          height={10}
          style={{
            fill: t.color,
            opacity: t.color === 'var(--down)' ? 0.7 : 1,
            transition: 'fill 150ms var(--ease-data)',
            transitionDelay: i >= changedFrom ? `${(i - changedFrom) * 12}ms` : '0ms',
          }}
        />
      ))}
      {over > 0 && <line x1={limitX - 0.5} x2={limitX - 0.5} y1={-2} y2={12} style={{ stroke: 'var(--ink)', strokeWidth: 1 }} />}
    </svg>
  )
}
