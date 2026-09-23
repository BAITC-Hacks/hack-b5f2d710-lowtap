import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const dataDir = fileURLToPath(new URL('../data', import.meta.url))

/**
 * data/plan_distribution.json (бэкенд, все 694 395 валидных наборов) весит ~6 МБ: в бандл идёт
 * только сжатая выжимка — бины для гистограммы, top20 и кумулятивная таблица с шагом 0.001
 * для перцентиля офлайн (ошибка < 0.005 п.п.; при живом бэкенде перцентиль точный с сервера).
 */
function planDistribution(): Plugin {
  const id = 'virtual:plan-distribution'
  const file = `${dataDir}/plan_distribution.json`
  const STEP = 0.001
  return {
    name: 'plan-distribution',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(resolved) {
      if (resolved !== `\0${id}`) return null
      if (!existsSync(file)) return 'export default null'
      this.addWatchFile(file)
      const d = JSON.parse(readFileSync(file, 'utf8'))
      const scores: [number, number][] = d.score_counts
      const start = Math.floor(d.worst / STEP) * STEP
      const n = Math.ceil((d.best - start) / STEP) + 2
      const cum: number[] = []
      let j = 0
      let below = 0
      for (let i = 0; i < n; i++) {
        const edge = start + i * STEP
        while (j < scores.length && scores[j][0] < edge) below += scores[j++][1]
        cum.push(below)
      }
      const out = {
        count: d.count,
        worse_than_baseline: d.worse_than_baseline,
        baseline: d.baseline,
        best: d.best,
        worst: d.worst,
        bins: d.bins,
        top20: d.top20,
        data_hash: d.data_hash,
        fine: { start, step: STEP, cum },
      }
      return `export default ${JSON.stringify(out)}`
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), planDistribution()],
  resolve: {
    // Датасет ТЗ живёт в корне репозитория (data/*.json) и общий с бэкендом.
    alias: { '@data': dataDir },
  },
  build: {
    // Один экран демо целиком офлайн: React + motion + d3 + границы районов + выжимка распределения ≈ 200 КБ gzip.
    chunkSizeWarningLimit: 800,
  },
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
