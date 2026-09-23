import { useMemo } from 'react'
import { DISTRICT_BY_ID } from '../../engine/catalog'
import { useSize } from '../../hooks/useSize'
import { labelInk, mapColor } from '../../lib/colors'
import { fmt2 } from '../../lib/format'
import { districtShapes, fitMap } from '../../lib/geo'
import { DISTRICT_IDS, type DistrictId } from '../../types/data'

interface Props {
  /** Значение для заливки по району (по умолчанию D_d), шкала 40–80. */
  values: Record<DistrictId, number>
}

/** Хороплет настоящей Астаны: SVG, geoMercator + fitExtent, DOM целиком у React. */
export function MapAstana({ values }: Props) {
  const [ref, { width, height }] = useSize<HTMLDivElement>()
  const shapes = districtShapes()
  const layout = useMemo(() => (width && height ? fitMap(shapes, width, height, 40) : null), [shapes, width, height])

  return (
    <div ref={ref} className="absolute inset-0">
      {layout && (
        <svg width={width} height={height} role="img" aria-label="Карта районов Астаны">
          <g>
            {shapes.map((s) => (
              <g key={s.id}>
                {s.exclaves.map((ex, i) => (
                  <path
                    key={i}
                    d={layout.path(ex) ?? undefined}
                    opacity={0.35}
                    stroke="var(--line)"
                    style={{ fill: mapColor(values[s.id]), transition: 'fill 300ms var(--ease-data)' }}
                  />
                ))}
                <path
                  d={layout.path(s.main) ?? undefined}
                  stroke="var(--panel)"
                  strokeWidth={1}
                  style={{ fill: mapColor(values[s.id]), transition: 'fill 300ms var(--ease-data)' }}
                />
              </g>
            ))}
          </g>
          <g pointerEvents="none">
            {DISTRICT_IDS.map((id) => {
              const [x, y] = layout.anchors[id]
              const ink = labelInk(values[id])
              const compact = id === 'baikonur'
              return (
                <g key={id} transform={`translate(${x},${y})`} textAnchor="middle" style={{ fill: ink }}>
                  {!compact && (
                    <text y={-4} className="font-sans" fontSize={11} fontWeight={600} letterSpacing="0.10em">
                      {DISTRICT_BY_ID.get(id)!.name_ru.toUpperCase()}
                    </text>
                  )}
                  <text y={compact ? 4 : 11} className="num" fontSize={12}>
                    {fmt2(values[id])}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      )}
    </div>
  )
}
