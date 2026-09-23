import { expect, test, type Locator } from '@playwright/test'

test.use({ reducedMotion: 'reduce' })

async function viewport(world: Locator) {
  return world.evaluate((node) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform)
    return { x: matrix.e, y: matrix.f, scale: matrix.a }
  })
}

// Observe the rendered camera, so easing must produce visible intermediate
// positions. The test deliberately makes no assumption about display refresh rate.
async function cameraMotion(world: Locator, gesture: () => Promise<void>) {
  const recording = await world.evaluateHandle((node) => {
    const read = () => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform)
      return { x: matrix.e, y: matrix.f, scale: matrix.a }
    }
    const samples = [read()]
    let quiet: ReturnType<typeof setTimeout>
    let deadline: ReturnType<typeof setTimeout>
    const result = new Promise<typeof samples>((resolve) => {
      const finish = () => {
        observer.disconnect()
        clearTimeout(quiet)
        clearTimeout(deadline)
        resolve(samples)
      }
      const observer = new MutationObserver(() => {
        const next = read()
        const previous = samples[samples.length - 1]
        if (next.x === previous.x && next.y === previous.y && next.scale === previous.scale) return
        samples.push(next)
        clearTimeout(quiet)
        quiet = setTimeout(finish, 120)
      })
      observer.observe(node, { attributes: true, attributeFilter: ['style'] })
      deadline = setTimeout(finish, 2500)
    })
    return { result }
  })
  try {
    await gesture()
    return await recording.evaluate(({ result }) => result)
  } finally {
    await recording.dispose()
  }
}

// A polygon's bounding-box centre can be outside its fill. Find a visible interior
// point so the gesture really starts on the district, including after navigation.
async function interiorPoint(district: Locator) {
  return district.evaluate((node) => {
    const path = node as unknown as SVGGeometryElement
    const box = path.getBBox()
    const matrix = path.getScreenCTM()!
    const candidates: { x: number; y: number; distance: number }[] = []
    for (let row = 1; row < 20; row++) {
      for (let col = 1; col < 20; col++) {
        const local = new DOMPoint(box.x + box.width * col / 20, box.y + box.height * row / 20)
        if (!path.isPointInFill(local)) continue
        const screen = local.matrixTransform(matrix)
        if (document.elementFromPoint(screen.x, screen.y) !== path) continue
        candidates.push({ x: screen.x, y: screen.y, distance: (col - 10) ** 2 + (row - 10) ** 2 })
      }
    }
    candidates.sort((a, b) => a.distance - b.distance)
    if (!candidates.length) throw new Error('No visible point inside district')
    return { x: candidates[0].x, y: candidates[0].y }
  })
}

test('wheel zoom stays under the cursor, respects bounds, and carries the landscape with the districts', async ({ page }) => {
  await page.goto('/#/pult')
  const map = page.getByRole('main', { name: 'Карта Астаны' })
  const svg = map.getByRole('img', { name: 'Карта районов Астаны' })
  const world = map.getByTestId('map-world')
  await expect(world).toBeVisible()
  await expect(world.getByTestId('map-landscape')).toBeVisible()
  await expect(world.getByRole('button', { name: /^Сарыарка, D/ })).toBeVisible()

  const bounds = (await svg.boundingBox())!
  // Chromium reports wheel coordinates as whole CSS pixels.
  const pointer = {
    x: Math.round(bounds.x + bounds.width * 0.31) - bounds.x,
    y: Math.round(bounds.y + bounds.height * 0.37) - bounds.y,
  }
  const before = await viewport(world)
  await page.mouse.move(bounds.x + pointer.x, bounds.y + pointer.y)
  await page.mouse.wheel(0, -360)
  await expect.poll(async () => (await viewport(world)).scale).toBeGreaterThan(before.scale)
  const after = await viewport(world)
  expect((pointer.x - after.x) / after.scale).toBeCloseTo((pointer.x - before.x) / before.scale, 1)
  expect((pointer.y - after.y) / after.scale).toBeCloseTo((pointer.y - before.y) / before.scale, 1)

  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -1000)
  await expect.poll(async () => (await viewport(world)).scale).toBeCloseTo(4, 5)
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 1000)
  await expect.poll(async () => (await viewport(world)).scale).toBeCloseTo(0.75, 5)
  await expect(page).toHaveURL(/#\/pult$/)
})

test('dragging a district does not place a measure; the next ordinary click still places it', async ({ page }) => {
  await page.goto('/#/pult')
  const map = page.getByRole('main', { name: 'Карта Астаны' })
  const world = map.getByTestId('map-world')
  const district = world.getByRole('button', { name: /^Сарыарка, D/ })
  await page.getByRole('complementary', { name: 'Каталог мер' }).getByRole('button', { name: /^M7\s/ }).click()
  await expect(map.getByText(/→ выберите район/)).toBeVisible()
  const before = await viewport(world)
  const start = await interiorPoint(district)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 44, start.y + 26, { steps: 8 })
  await page.mouse.up()

  await expect.poll(async () => (await viewport(world)).x).toBeGreaterThan(before.x + 20)
  await expect(map.getByText(/→ выберите район/)).toBeVisible()
  await expect(page.getByRole('list', { name: 'Решения акима' }).getByText(/M7/)).toHaveCount(0)
  await expect(page).toHaveURL(/#\/pult$/)

  const target = await interiorPoint(district)
  await page.mouse.click(target.x, target.y)
  await expect(page).toHaveURL(/#\/pult\?d=M7:saryarka$/)
  await expect(map.getByText(/→ выберите район/)).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Решения акима' }).getByRole('button', { name: 'M7 · Сарыарка' })).toBeVisible()
})

test('pin actions follow the transformed pin and centring preserves the scenario', async ({ page }) => {
  await page.goto('/#/pult?d=M7:saryarka')
  const map = page.getByRole('main', { name: 'Карта Астаны' })
  const world = map.getByTestId('map-world')
  await expect(world).toBeVisible()
  await map.getByRole('button', { name: 'Приблизить карту', exact: true }).click()
  await expect.poll(async () => (await viewport(world)).scale).toBeGreaterThan(1)

  const bounds = (await map.boundingBox())!
  const beforeDrag = await viewport(world)
  await page.mouse.move(bounds.x + 24, bounds.y + 54)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 60, bounds.y + 72, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await viewport(world)).x).toBeGreaterThan(beforeDrag.x + 20)

  const pin = world.locator('text').filter({ hasText: /^M7$/ })
  const circle = pin.locator('..').locator('circle').last()
  await pin.click()
  const popup = map.getByRole('button', { name: 'Переставить', exact: true }).locator('..').locator('..')
  await expect(popup).toBeVisible()
  const pinBounds = (await circle.boundingBox())!
  const popupBounds = (await popup.boundingBox())!
  const pinX = pinBounds.x + pinBounds.width / 2
  const pinY = pinBounds.y + pinBounds.height / 2
  expect(popupBounds.x).toBeLessThan(pinX)
  expect(popupBounds.x + popupBounds.width).toBeGreaterThan(pinX)
  expect(popupBounds.y - pinY).toBeGreaterThan(0)
  expect(popupBounds.y - pinY).toBeLessThan(40)

  // Move the pin towards the bottom-right edge; its action card must remain
  // inside the map even when the usual below-pin position would be clipped.
  await map.getByRole('button', { name: 'Закрыть', exact: true }).click()
  const dx = bounds.x + bounds.width - 40 - pinX
  const dy = bounds.y + bounds.height - 30 - pinY
  await page.mouse.move(bounds.x + 24, bounds.y + 54)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 24 + dx, bounds.y + 54 + dy, { steps: 12 })
  await page.mouse.up()
  await pin.click()
  await expect(popup).toBeVisible()
  const edgePin = (await circle.boundingBox())!
  expect(edgePin.y + edgePin.height / 2 + 18 + popupBounds.height).toBeGreaterThan(bounds.y + bounds.height)
  await expect.poll(async () => {
    const card = (await popup.boundingBox())!
    return Math.max(bounds.x - card.x, bounds.y - card.y,
      card.x + card.width - bounds.x - bounds.width,
      card.y + card.height - bounds.y - bounds.height)
  }).toBeLessThanOrEqual(0)

  await map.getByRole('button', { name: 'Вернуть карту в центр' }).click()
  await expect.poll(async () => viewport(world)).toEqual({ x: 0, y: 0, scale: 1 })
  await expect(page).toHaveURL(/#\/pult\?d=M7:saryarka$/)
  await expect(page.getByRole('list', { name: 'Решения акима' }).getByRole('button', { name: 'M7 · Сарыарка' })).toBeVisible()
  await expect(map.getByRole('button', { name: 'Отдалить карту', exact: true })).toBeEnabled()
})

test.describe('smooth map navigation', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('wheel zoom renders intermediate positions while keeping the cursor anchor fixed', async ({ page }) => {
    await page.goto('/#/pult')
    const map = page.getByRole('main', { name: 'Карта Астаны' })
    const svg = map.getByRole('img', { name: 'Карта районов Астаны' })
    const world = map.getByTestId('map-world')
    await expect(world).toBeVisible()
    const bounds = (await svg.boundingBox())!
    const pointer = {
      x: Math.round(bounds.x + bounds.width * 0.31) - bounds.x,
      y: Math.round(bounds.y + bounds.height * 0.37) - bounds.y,
    }
    await page.mouse.move(bounds.x + pointer.x, bounds.y + pointer.y)

    const samples = await cameraMotion(world, () => page.mouse.wheel(0, -240))
    expect(samples.length).toBeGreaterThan(3)
    const before = samples[0]
    const after = samples[samples.length - 1]
    expect(after.scale).toBeGreaterThan(before.scale + 0.2)
    expect(samples[1].scale).toBeGreaterThan(before.scale)
    expect(samples[1].scale).toBeLessThan(after.scale - 0.05)
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].scale).toBeGreaterThanOrEqual(samples[i - 1].scale)
      expect((pointer.x - samples[i].x) / samples[i].scale).toBeCloseTo((pointer.x - before.x) / before.scale, 1)
      expect((pointer.y - samples[i].y) / samples[i].scale).toBeCloseTo((pointer.y - before.y) / before.scale, 1)
    }
  })

  test('reversing a wheel gesture and resetting interrupt easing without changing decisions', async ({ page }) => {
    await page.goto('/#/pult?d=M7:saryarka')
    const map = page.getByRole('main', { name: 'Карта Астаны' })
    const world = map.getByTestId('map-world')
    await expect(world).toBeVisible()
    const bounds = (await map.boundingBox())!
    await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.4)

    const samples = await cameraMotion(world, async () => {
      await page.mouse.wheel(0, -240)
      await expect.poll(async () => (await viewport(world)).scale, { intervals: [16] }).toBeGreaterThan(1.02)
      await page.mouse.wheel(0, 240)
    })
    expect(Math.max(...samples.map((sample) => sample.scale))).toBeGreaterThan(1.02)
    // The browser can pause rendering while Playwright dispatches the opposite
    // wheel event; check the live camera's destination independently of samples.
    await expect.poll(async () => (await viewport(world)).scale).toBeCloseTo(1, 5)
    const reversed = await viewport(world)
    expect(reversed.x).toBeCloseTo(0, 5)
    expect(reversed.y).toBeCloseTo(0, 5)

    await page.mouse.wheel(0, -240)
    await expect.poll(async () => (await viewport(world)).scale, { intervals: [16] }).toBeGreaterThan(1.02)
    await map.getByRole('button', { name: 'Вернуть карту в центр' }).click()
    await expect.poll(async () => viewport(world)).toEqual({ x: 0, y: 0, scale: 1 })
    await expect(page).toHaveURL(/#\/pult\?d=M7:saryarka$/)
    await expect(page.getByRole('list', { name: 'Решения акима' }).getByRole('button', { name: 'M7 · Сарыарка' })).toBeVisible()
  })

  test('leaving the map cancels its pending camera animation', async ({ page }) => {
    await page.goto('/#/pult?d=M7:saryarka')
    const map = page.getByRole('main', { name: 'Карта Астаны' })
    const world = map.getByTestId('map-world')
    await expect(world).toBeVisible()
    const originalWorld = (await world.elementHandle())!
    const bounds = (await map.boundingBox())!
    await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.4)
    await page.mouse.wheel(0, -240)
    await expect.poll(async () => (await viewport(world)).scale, { intervals: [16] }).toBeGreaterThan(1.02)
    await page.evaluate(() => { window.location.hash = '#/compare?d=M7:saryarka' })
    await expect(page.getByRole('heading', { name: 'СРАВНЕНИЕ' })).toBeVisible()
    await expect(map).toHaveCount(0)
    const unchanged = await originalWorld.evaluate(async (node) => {
      const transform = (node as HTMLElement).style.transform
      for (let frame = 0; frame < 8; frame++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      return !node.isConnected && (node as HTMLElement).style.transform === transform
    })
    expect(unchanged).toBe(true)
    await originalWorld.dispose()
  })
})
