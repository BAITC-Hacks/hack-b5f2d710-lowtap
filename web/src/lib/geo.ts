// Границы районов Астаны (data/astana_districts.geojson, © OpenStreetMap contributors, ODbL):
// у каждого района — крупнейший полигон (подписи, пины, клики) и эксклавы (рисуются бледно).

import geojsonRaw from '@data/astana_districts.geojson?raw'
import { geoArea, geoMercator, geoPath, type GeoPath, type GeoProjection } from 'd3-geo'
import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson'
import { isDistrictId } from '../engine/catalog'
import { DISTRICT_IDS, type DistrictId } from '../types/data'

export type PolygonFeature = Feature<Polygon, { id: DistrictId }>

export interface DistrictShape {
  id: DistrictId
  /** Крупнейший полигон района. */
  main: PolygonFeature
  /** Остальные полигоны (эксклавы), рисуются с opacity 0.35 и без подписей. */
  exclaves: PolygonFeature[]
}

/**
 * d3-geo считает внешним кольцо по часовой стрелке (сферическая площадь ≤ 2π),
 * RFC 7946 — наоборот. Полигон с «вывернутой» площадью переворачиваем.
 */
function normalizeWinding(rings: Position[][]): Position[][] {
  const polygon: Polygon = { type: 'Polygon', coordinates: rings }
  return geoArea(polygon) > 2 * Math.PI ? rings.map((ring) => [...ring].reverse()) : rings
}

export function buildDistrictShapes(collection: FeatureCollection<Polygon | MultiPolygon>): DistrictShape[] {
  const shapes = collection.features.map((feature) => {
    const id = feature.properties?.id
    if (!isDistrictId(id)) throw new Error(`astana_districts.geojson: неизвестный район ${String(id)}`)
    const polygons = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates]
    const features = polygons
      .map(normalizeWinding)
      .map((coordinates): PolygonFeature => ({ type: 'Feature', properties: { id }, geometry: { type: 'Polygon', coordinates } }))
      .sort((a, b) => geoArea(b) - geoArea(a))
    return { id, main: features[0], exclaves: features.slice(1) }
  })
  return DISTRICT_IDS.map((id) => {
    const shape = shapes.find((s) => s.id === id)
    if (!shape) throw new Error(`astana_districts.geojson: нет района ${id}`)
    return shape
  })
}

let cached: DistrictShape[] | null = null

/** Районы в порядке DISTRICT_IDS; GeoJSON разбирается один раз. */
export function districtShapes(): DistrictShape[] {
  cached ??= buildDistrictShapes(JSON.parse(geojsonRaw) as FeatureCollection<Polygon | MultiPolygon>)
  return cached
}

export interface MapLayout {
  projection: GeoProjection
  path: GeoPath
  /** Точка подписи и пинов — центроид крупнейшего полигона (или LABEL_POINTS), в пикселях. */
  anchors: Record<DistrictId, [number, number]>
}

/**
 * Точки подписи там, где центроид неудачен: у Есиля он лежит у самой границы с Нурой,
 * и плашки двух районов налезают друг на друга. Координаты — lon/lat внутри района.
 */
const LABEL_POINTS: Partial<Record<DistrictId, [number, number]>> = {
  esil: [71.5054, 51.0017],
  nura: [71.308, 51.0549],
}

/** Отступ: одно число или [сверху, справа, снизу, слева]. */
export type Padding = number | [number, number, number, number]

/** Меркатор, вписанный в прямоугольник с отступом (по крупнейшим полигонам — эксклавы не уменьшают карту). */
export function fitMap(shapes: DistrictShape[], width: number, height: number, padding: Padding = 40): MapLayout {
  const [top, right, bottom, left] = typeof padding === 'number' ? [padding, padding, padding, padding] : padding
  const frame: FeatureCollection<Polygon> = { type: 'FeatureCollection', features: shapes.map((s) => s.main) }
  const projection = geoMercator().fitExtent(
    [
      [left, top],
      [Math.max(left + 1, width - right), Math.max(top + 1, height - bottom)],
    ],
    frame,
  )
  const path = geoPath(projection)
  const anchors = Object.fromEntries(
    shapes.map((s) => {
      const point = LABEL_POINTS[s.id]
      return [s.id, (point && projection(point)) ?? path.centroid(s.main)]
    }),
  ) as Record<DistrictId, [number, number]>
  return { projection, path, anchors }
}

const LEFT_BANK: DistrictId[] = ['esil', 'nura']
const RIGHT_BANK: DistrictId[] = ['almaty', 'baikonur', 'saryarka']

/**
 * Линия Ишима (Есиль): районные границы Астаны идут по реке, поэтому река — это общие
 * рёбра левобережных районов (Есиль, Нура) с правобережными (Алматы, Байконур, Сарыарка).
 */
export function riverLine(shapes: DistrictShape[]): Feature<MultiLineString> {
  const key = (p: Position) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`
  const right = new Set<string>()
  for (const s of shapes.filter((s) => RIGHT_BANK.includes(s.id))) {
    for (const f of [s.main, ...s.exclaves]) for (const ring of f.geometry.coordinates) for (const p of ring) right.add(key(p))
  }
  const lines: Position[][] = []
  for (const s of shapes.filter((s) => LEFT_BANK.includes(s.id))) {
    for (const ring of s.main.geometry.coordinates) {
      let current: Position[] = []
      for (const p of ring) {
        if (right.has(key(p))) {
          current.push(p)
        } else {
          if (current.length > 1) lines.push(current)
          current = []
        }
      }
      if (current.length > 1) lines.push(current)
    }
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } }
}

/** Смещения пинов у одного центроида: 0 / +26 / −26 px по x, дальше — следующий ряд. */
export function pinOffset(index: number): [number, number] {
  const column = [0, 26, -26][index % 3]
  return [column, Math.floor(index / 3) * 26]
}
