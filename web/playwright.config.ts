import { defineConfig, devices } from '@playwright/test'

// Один smoke-тест UI: npm run e2e (поднимает dev-сервер сам или переиспользует запущенный).
const port = process.env.E2E_PORT ?? '5173'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1280, height: 720 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } }],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
