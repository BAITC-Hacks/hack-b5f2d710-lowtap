import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'

export interface MapView {
  x: number
  y: number
  scale: number
}

const MIN_SCALE = 0.75
const MAX_SCALE = 4
const INITIAL = { x: 0, y: 0, scale: 1 }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function bounded(view: MapView): MapView {
  return {
    x: clamp(view.x, 1 - view.scale - 0.45, 0.45),
    y: clamp(view.y, 1 - view.scale - 0.45, 0.45),
    scale: view.scale,
  }
}

/**
 * Transform the composited HTML layer. --map-inv lets labels, pins and strokes keep their
 * screen size (see anchored/screenStroke in lib/geo), so zooming enlarges the city, not the text.
 */
export function useMapNavigation(width: number, height: number, enabled: boolean, onNavigate?: () => void) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  // Normalized coordinates preserve the view when the viewport is resized.
  const current = useRef<MapView>(INITIAL)
  const target = useRef<MapView>(INITIAL)
  const size = useRef({ width, height })
  const frame = useRef<number | null>(null)
  const lastTime = useRef(0)
  const reducedMotion = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [limits, setLimits] = useState({ canZoomIn: true, canZoomOut: true })
  const gesture = useRef<{ id: number; x: number; y: number; start: MapView; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const onNavigateRef = useRef(onNavigate)
  useLayoutEffect(() => { onNavigateRef.current = onNavigate }, [onNavigate])

  function getView(): MapView {
    return { x: current.current.x * size.current.width, y: current.current.y * size.current.height, scale: current.current.scale }
  }

  function paint() {
    const view = getView()
    if (worldRef.current) {
      worldRef.current.style.transform = `translate3d(${view.x}px,${view.y}px,0) scale(${view.scale})`
      worldRef.current.style.setProperty('--map-inv', String(1 / view.scale))
    }
  }

  function updateLimits() {
    const canZoomIn = target.current.scale < MAX_SCALE
    const canZoomOut = target.current.scale > MIN_SCALE
    setLimits((previous) => previous.canZoomIn === canZoomIn && previous.canZoomOut === canZoomOut
      ? previous : { canZoomIn, canZoomOut })
  }

  function stop() {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }

  function tick(now: number) {
    const elapsed = Math.max(0, now - lastTime.current)
    lastTime.current = now
    const before = current.current
    const goal = target.current
    // Time-based easing feels the same at 60, 120 and 144Hz. Drag tracks the hand
    // immediately; only zoom/reset ease out, so there is no rubber-band delay.
    const blend = gesture.current?.moved || reducedMotion.current ? 1 : 1 - Math.exp(-elapsed / 65)
    const next = {
      x: before.x + (goal.x - before.x) * blend,
      y: before.y + (goal.y - before.y) * blend,
      scale: before.scale + (goal.scale - before.scale) * blend,
    }
    const settled = Math.abs(next.x - goal.x) * size.current.width < 0.04
      && Math.abs(next.y - goal.y) * size.current.height < 0.04
      && Math.abs(next.scale - goal.scale) < 0.00004
    current.current = settled ? goal : next
    paint()
    frame.current = settled ? null : requestAnimationFrame(tick)
  }

  function requestView(next: MapView) {
    target.current = bounded(next)
    if (frame.current !== null) return
    lastTime.current = performance.now()
    frame.current = requestAnimationFrame(tick)
  }

  function zoom(factor: number, atX = 0.5, atY = 0.5) {
    const previous = target.current
    const scale = clamp(previous.scale * factor, MIN_SCALE, MAX_SCALE)
    if (scale === previous.scale) return
    const ratio = scale / previous.scale
    // Accumulate quick wheel notches into the destination instead of restarting
    // the animation on every event. The cursor stays anchored throughout easing.
    if (frame.current === null) onNavigateRef.current?.()
    requestView({ x: atX - (atX - previous.x) * ratio, y: atY - (atY - previous.y) * ratio, scale })
    updateLimits()
  }

  useLayoutEffect(() => {
    size.current = { width, height }
    if (!enabled) {
      stop()
      current.current = target.current = INITIAL
    }
    paint()
  }, [width, height, enabled])

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { reducedMotion.current = preference.matches }
    update()
    preference.addEventListener('change', update)
    return () => {
      preference.removeEventListener('change', update)
      stop()
      gesture.current = null
    }
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !enabled || !width || !height) return
    function wheel(event: WheelEvent) {
      event.preventDefault()
      if (gesture.current) return
      const box = viewport!.getBoundingClientRect()
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1)
      zoom(Math.exp(-clamp(pixels, -240, 240) * 0.0015), (event.clientX - box.left) / width, (event.clientY - box.top) / height)
    }
    viewport.addEventListener('wheel', wheel, { passive: false })
    return () => viewport.removeEventListener('wheel', wheel)
  }, [enabled, width, height])

  function finish(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    // Flush the last coalesced drag frame before a subsequent click can read it.
    if (active.moved) {
      stop()
      current.current = target.current
      paint()
    }
    suppressClick.current = active.moved
    gesture.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return {
    viewportRef,
    worldRef,
    getView,
    dragging,
    ...limits,
    zoomIn: () => zoom(1.25),
    zoomOut: () => zoom(1 / 1.25),
    reset: () => { onNavigateRef.current?.(); requestView(INITIAL); updateLimits() },
    handlers: enabled ? {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || !event.isPrimary) return
        stop()
        target.current = current.current
        updateLimits()
        suppressClick.current = false
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: current.current, moved: false }
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const active = gesture.current
        if (!active || active.id !== event.pointerId) return
        if ((event.buttons & 1) === 0) { finish(event); return }
        const dx = event.clientX - active.x
        const dy = event.clientY - active.y
        if (!active.moved && Math.hypot(dx, dy) < 5) return
        if (!active.moved) {
          active.moved = true
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
          onNavigateRef.current?.()
        }
        requestView({ ...active.start, x: active.start.x + dx / size.current.width, y: active.start.y + dy / size.current.height })
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onPointerLeave(event: PointerEvent<HTMLDivElement>) {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) finish(event)
      },
      onClickCapture(event: MouseEvent<HTMLDivElement>) {
        if (!suppressClick.current) return
        suppressClick.current = false
        event.preventDefault()
        event.stopPropagation()
      },
    } : {},
  }
}
