import { motion } from 'motion/react'
import type { WhatIfOption } from '../../engine/whatif'
import { fmtSigned } from '../../lib/format'
import type { DistrictShape, MapLayout } from '../../lib/geo'

/** Предсказанная ΔScore постановки меры в каждый район; лучший — обводка --accent и подпись. */
export function WhatIfLabels({ layout, shapes, options }: { layout: MapLayout; shapes: DistrictShape[]; options: WhatIfOption[] }) {
  return (
    <g pointerEvents="none">
      {options.map((o) => {
        if (!o.district || o.blocked) return null
        const [x, y] = layout.anchors[o.district]
        const text = fmtSigned(o.delta)
        const color = Math.abs(o.delta) < 0.005 ? 'var(--ink-2)' : o.delta > 0 ? 'var(--up)' : 'var(--down)'
        const w = text.length * 7.3 + 12
        const shape = shapes.find((s) => s.id === o.district)!
        return (
          <motion.g key={o.district} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
            {o.best && <path d={layout.path(shape.main) ?? undefined} style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 2.5 }} />}
            <g transform={`translate(${x},${y + 24})`}>
              <rect x={-w / 2} y={0} width={w} height={17} rx={3} style={{ fill: 'var(--panel)', stroke: o.best ? 'var(--accent)' : color, strokeWidth: 1 }} />
              <text y={12.5} textAnchor="middle" fontSize={12} style={{ fill: color, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                {text}
              </text>
              {o.best && (
                <text y={30} textAnchor="middle" fontSize={10} fontWeight={600} letterSpacing="0.08em" style={{ fill: 'var(--accent)', fontFamily: 'var(--font-sans)' }}>
                  ЛУЧШИЙ
                </text>
              )}
            </g>
          </motion.g>
        )
      })}
    </g>
  )
}
