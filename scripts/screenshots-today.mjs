/**
 * screenshots-today.mjs — Capture only pages modified in today's session.
 *
 * Reuses the same setup/render helpers as screenshots.mjs but limited
 * to the 5 pages touched: analyses, biodiversity, favorites, system
 * (health tab par défaut), stats (avec onglet models en plus).
 *
 * Output : screenshots/{name}.png — overwrites the standard files.
 *
 * Usage: node scripts/screenshots-today.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(__dirname, '..', 'screenshots');
const BASE = process.argv[2] || 'http://localhost';
const THEME = 'lab';
const LANG = 'en';
const POST_READY_PAUSE_MS = 1500;

// Pages modifiées aujourd'hui — copies/extensions des entrées de _pages.mjs
const targets = [
  { name: 'analyses', path: '/birds/analyses.html', wait: 2000, action: async (page) => {
    const topBtn = page.locator('.sp-topn-btn').first();
    if (await topBtn.isVisible().catch(() => false)) {
      await topBtn.click().catch(() => {});
      await page.waitForTimeout(9000);
    }
  }},
  { name: 'biodiversity', path: '/birds/biodiversity.html', wait: 4000 },
  { name: 'favorites', path: '/birds/favorites.html', wait: 6000 },
  { name: 'system', path: '/birds/system.html', wait: 4000 },  // default = health tab
  { name: 'stats', path: '/birds/stats.html', wait: 4000 },
  // stats.html?tab=models — capture la cmp-list grid + le compact chart
  { name: 'stats-models', path: '/birds/stats.html?tab=models#models', wait: 6000,
    ready: '.cmp-row, .cmp-stat .big' },
];

async function setupPage(page) {
  await page.addInitScript(({ lang, theme }) => {
    localStorage.setItem('birdash_lang', lang);
    localStorage.setItem('birdash_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, { lang: LANG, theme: THEME });
}

async function waitReady(page, ms = 3000) {
  await page.waitForSelector('[v-cloak]', { state: 'detached', timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function waitChartsSettled(page) {
  await page.waitForTimeout(POST_READY_PAUSE_MS);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll('img')).filter(i => i.offsetParent !== null);
    await Promise.all(imgs.map(i => i.complete && i.naturalWidth > 0 ? Promise.resolve() :
      new Promise(r => { i.onload = r; i.onerror = r; setTimeout(r, 4000); })));
  });
}

(async () => {
  console.log(`Capturing ${targets.length} screenshots from ${BASE}`);
  console.log(`Theme: ${THEME}, Lang: ${LANG}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await setupPage(page);

  // Prime localStorage
  await page.goto(`${BASE}/birds/overview.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  for (const p of targets) {
    process.stdout.write(`  ${p.name}...`);
    try {
      await page.goto(`${BASE}${p.path}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await waitReady(page, p.wait);
      if (p.action) await p.action(page);
      if (p.ready) {
        await page.waitForSelector(p.ready, { state: 'visible', timeout: 15000 }).catch(() => {});
      }
      await waitChartsSettled(page);
      await page.screenshot({ path: join(SHOTS_DIR, `${p.name}.png`), fullPage: false });
      process.stdout.write(` OK\n`);
    } catch (e) {
      process.stdout.write(` FAILED: ${e.message.slice(0, 80)}\n`);
    }
  }

  await browser.close();
  console.log(`\nDone — ${targets.length} screenshots captured.`);
})();
