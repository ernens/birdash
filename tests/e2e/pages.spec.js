// @ts-check
const { test, expect } = require('@playwright/test');

// All pages that should load without HTTP error
const PAGES = [
  '/birds/overview.html', '/birds/today.html', '/birds/dashboard.html',
  '/birds/calendar.html', '/birds/timeline.html', '/birds/detections.html', '/birds/review.html',
  '/birds/species.html', '/birds/rarities.html', '/birds/gallery.html', '/birds/recordings.html', '/birds/favorites.html',
  '/birds/weather.html', '/birds/stats.html', '/birds/stats.html?tab=models',
  '/birds/analyses.html', '/birds/biodiversity.html', '/birds/phenology.html', '/birds/comparison.html',
  '/birds/spectrogram.html', '/birds/log.html',
  '/birds/settings.html', '/birds/system.html', '/birds/network.html',
];

for (const pagePath of PAGES) {
  const name = pagePath.replace('/birds/', '').replace('.html', '').replace('?', '-');

  test(`${name} loads (HTTP 200, has <title>)`, async ({ page }) => {
    const resp = await page.goto(pagePath, { waitUntil: 'commit', timeout: 15000 });
    expect(resp.status()).toBe(200);

    // Verify the page is an HTML page with a title (not a blank/error page)
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
}

// Smoke test: one page fully renders Vue content
test('overview renders KPI content', async ({ page }) => {
  await page.goto('/birds/overview.html', { waitUntil: 'networkidle', timeout: 45000 });
  // Vue should have mounted and rendered at least the shell
  const bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText.length).toBeGreaterThan(20);
});
