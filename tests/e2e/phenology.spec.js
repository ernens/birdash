// @ts-check
// Phenology multi-year stacked ribbon: one row per year (replaces the year
// selector), shared absolute colour scale, click-to-zoom per (year, week).
const { test, expect } = require('@playwright/test');

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return errors;
}

async function openFirstSpecies(page) {
  await page.goto('/birds/phenology.html', { waitUntil: 'networkidle', timeout: 45000 });
  const sugg = page.locator('.ph-suggestion-btn').first();
  await sugg.waitFor({ state: 'visible', timeout: 20000 });
  await sugg.click();
  await expect(page.locator('.ph-year-row').first()).toBeVisible({ timeout: 20000 });
}

test('phenology: stacked year-rows, no year selector, no JS errors', async ({ page }) => {
  const errors = trackErrors(page);
  await openFirstSpecies(page);

  // At least one year row, each carrying a 53-week ribbon.
  const rows = await page.locator('.ph-year-row').count();
  expect(rows).toBeGreaterThanOrEqual(1);
  expect(await page.locator('.ph-year-row').first().locator('.ph-cell').count()).toBe(53);

  // The legacy year <select> is gone.
  await expect(page.locator('.ph-year-select')).toHaveCount(0);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('phenology: clicking a data cell opens the week zoom', async ({ page }) => {
  await openFirstSpecies(page);
  const cell = page.locator('.ph-cell.has-data').first();
  await cell.waitFor({ state: 'visible', timeout: 20000 });
  await cell.click();
  await expect(page.locator('.ph-week-zoom')).toBeVisible({ timeout: 10000 });
});
