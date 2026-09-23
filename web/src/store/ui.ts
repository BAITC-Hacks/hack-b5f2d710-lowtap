// Состояние интерфейса: экран, режим карты, ghost-превью, квартал таймлайна, связь с бэкендом.
// Одна машина режимов (VISUAL_SPEC §9): idle | placing(measureId) | playing; ghost — производное от hover.

import { create } from 'zustand'
import type { Health } from '../types/api'
import type { DistrictId, IndicatorCode } from '../types/data'
import type { Screen } from '../lib/permalink'

export type Mode = { kind: 'idle' } | { kind: 'placing'; measureId: string } | { kind: 'playing' }

/** Что показывает заливка карты: D района, один из 10 показателей или дельта D. */
export type MapIndicator = 'D' | IndicatorCode | 'delta'

export interface Ghost {
  measureId: string
  district: DistrictId | null
}

export type BackendStatus = 'unknown' | 'online' | 'offline'

interface UiState {
  screen: Screen
  mode: Mode
  ghost: Ghost | null
  selectedDistrict: DistrictId | null
  indicator: MapIndicator
  /** 0..8; 8 — итог по формуле ТЗ. */
  quarter: number
  bottomTab: 'timeline' | 'matrix'
  backend: BackendStatus
  health: Health | null

  setScreen: (screen: Screen) => void
  startPlacing: (measureId: string) => void
  startPlaying: () => void
  /** Esc: выход из постановки/проигрывания, затем снятие выбора района. */
  cancel: () => void
  setGhost: (ghost: Ghost | null) => void
  selectDistrict: (id: DistrictId | null) => void
  setIndicator: (indicator: MapIndicator) => void
  setQuarter: (quarter: number) => void
  toggleBottomTab: () => void
  setBackend: (status: BackendStatus, health?: Health | null) => void
}

export const HORIZON = 8

export const useUi = create<UiState>()((set, get) => ({
  screen: 'pult',
  mode: { kind: 'idle' },
  ghost: null,
  selectedDistrict: null,
  indicator: 'D',
  quarter: HORIZON,
  bottomTab: 'timeline',
  backend: 'unknown',
  health: null,

  setScreen: (screen) => set({ screen, mode: { kind: 'idle' }, ghost: null }),
  startPlacing: (measureId) => set({ mode: { kind: 'placing', measureId }, ghost: null }),
  startPlaying: () => set({ mode: { kind: 'playing' }, ghost: null }),
  cancel: () => {
    if (get().mode.kind !== 'idle') set({ mode: { kind: 'idle' }, ghost: null })
    else set({ selectedDistrict: null })
  },
  setGhost: (ghost) => set({ ghost }),
  selectDistrict: (id) => set((s) => ({ selectedDistrict: s.selectedDistrict === id ? null : id })),
  setIndicator: (indicator) => set({ indicator }),
  setQuarter: (quarter) => set({ quarter: Math.max(0, Math.min(HORIZON, Math.round(quarter))) }),
  toggleBottomTab: () => set((s) => ({ bottomTab: s.bottomTab === 'timeline' ? 'matrix' : 'timeline' })),
  setBackend: (backend, health) => set((s) => ({ backend, health: health === undefined ? s.health : health })),
}))
