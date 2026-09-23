// Границы районов Астаны (data/astana_districts.geojson, © OpenStreetMap contributors, ODbL):
// у каждого района — крупнейший полигон (подписи, пины, клики) и эксклавы (рисуются бледно).

import geojsonRaw from '@data/astana_districts.geojson?raw'
import { geoArea, geoMercator, geoPath, type GeoPath, type GeoProjection } from 'd3-geo'
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
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
  /** Точка подписи и пинов — центроид крупнейшего полигона, в пикселях. */
  anchors: Record<DistrictId, [number, number]>
}

/** Меркатор, вписанный в прямоугольник с отступом (по крупнейшим полигонам — эксклавы не раздувают кадр). */
export function fitMap(shapes: DistrictShape[], width: number, height: number, padding = 40): MapLayout {
  const frame: FeatureCollection<Polygon> = { type: 'FeatureCollection', features: shapes.map((s) => s.main) }
  const projection = geoMercator().fitExtent(
    [
      [padding, padding],
      [Math.max(padding + 1, width - padding), Math.max(padding + 1, height - padding)],
    ],
    frame,
  )
  const path = geoPath(projection)
  const anchors = Object.fromEntries(shapes.map((s) => [s.id, path.centroid(s.main)])) as Record<DistrictId, [number, number]>
  return { projection, path, anchors }
}

/** Смещения пинов у одного центроида: 0 / +26 / −26 px по x, дальше — следующий ряд. */
export function pinOffset(index: number): [number, number] {
  const column = [0, 26, -26][index % 3]
  return [column, Math.floor(index / 3) * 26]
}
