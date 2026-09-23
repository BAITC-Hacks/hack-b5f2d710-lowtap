import { expect, test } from '@playwright/test'

test('пресет «Пример ТЗ»: Score 56.54, бюджет 95/100, КРИТ 0, валидатор 6/6', async ({ page }) => {
  await page.goto('/#/pult')
  await expect(page.getByText('52.56').first()).toBeVisible()
  await page.getByRole('button', { name: 'Пресеты' }).click()
  await page.locator('[data-preset="example_tz"]').click()

  const rail = page.getByRole('complementary', { name: 'Score' })
  await expect(rail.getByText('56.54').first()).toBeVisible()
  await expect(rail.getByText('95', { exact: true })).toBeVisible()
  await expect(rail.getByText('Astana Quality of Life Score')).toBeVisible()
  await expect(rail.getByText('6/6')).toBeVisible()
  await expect(page.getByText('КРИТ 0')).toBeVisible()
  await expect(page).toHaveURL(/#\/pult\?d=M7:nura,M8:nura,M10:nura,M12,M5:saryarka/)
})

test('невалидный набор: причина вместо Score, расчёт заблокирован', async ({ page }) => {
  await page.goto('/#/pult')
  await page.getByRole('button', { name: 'Пресеты' }).click()
  await page.locator('[data-preset="invalid_budget"]').click()

  const rail = page.getByRole('complementary', { name: 'Score' })
  await expect(rail.getByText('превышение на 29 у.е.')).toBeVisible()
  await expect(rail.getByText('Astana Quality of Life Score')).toHaveCount(0)
  await expect(rail.getByRole('button', { name: 'Рассчитать' })).toBeDisabled()
})
