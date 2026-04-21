/**
 * screenshots.mjs — Capture all birdash pages for README
 *
 * Usage: node scripts/screenshots.mjs [baseUrl]
 *
 * Takes screenshots of every page in English, Paper theme,
 * at 1440x900 viewport. Saves to screenshots/ directory.
 */

import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pages, systemTabs } from './_pages.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const SHOTS_DIR = join(PROJECT_ROOT, 'screenshots');
const BASE = process.argv[2] || 'http://localhost';

// Set English + Paper theme via localStorage before each page
async function setupPage(page) {
  await page.addInitScript(() => {
    localStorage.setItem('birdash_lang', 'en');
    localStorage.setItem('birdash_theme', 'paper');
  });
}

// Wait for Vue to mount + data to load
async function waitReady(page, ms = 3000) {
  // Wait for v-cloak to disappear (Vue mounted)
  await page.waitForSelector('[v-cloak]', { state: 'detached', timeout: 10000 }).catch(() => {});
  // Extra wait for async data
  await page.waitForTimeout(ms);
}

// Wait for a "ready" selector — typically something that appears only after
// data finishes loading (a KPI value, a chart canvas, a table row). Accepts
// a comma-separated list; we resolve when ANY of them shows up.
async function waitReadySelector(page, selector, timeout = 15000) {
  if (!selector) return;
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout });
  } catch {
    // Don't fail the whole run — just screenshot what we have.
  }
}

// After the "ready" selector resolves, give chart/canvas libs a beat to
// finish drawing. Chart.js and ECharts mount synchronously but draw on
// the next animation frame.
async function waitChartsSettled(page) {
  await page.waitForTimeout(800);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  // Let visible <img> elements resolve so photo-heavy pages don't ship grey placeholders.
  await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll('img')).filter(i => i.offsetParent !== null);
    await Promise.all(imgs.map(i => i.complete && i.naturalWidth > 0 ? Promise.resolve() :
      new Promise(r => { i.onload = r; i.onerror = r; setTimeout(r, 4000); })));
  });
}

// Page list lives in _pages.mjs (shared with smoke.mjs)

(async () => {
  console.log(`Capturing ${pages.length} screenshots from ${BASE}`);
  console.log(`Theme: paper, Lang: en, Viewport: 1440x900`);
  console.log(`Output: ${SHOTS_DIR}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();
  await setupPage(page);

  // First navigate to set localStorage, then reload
  await page.goto(`${BASE}/birds/overview.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  for (const p of pages) {
    const url = `${BASE}${p.path}`;
    const outPath = join(SHOTS_DIR, `${p.name}.png`);

    process.stdout.write(`  ${p.name}...`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await waitReady(page, p.wait);

      // Custom action (e.g. select a species, click Start)
      if (p.action) await p.action(page);

      // For settings pages with hash tabs, click the tab
      if (p.path.includes('#') && !p.path.endsWith('#detection')) {
        const tabId = p.path.split('#')[1];
        const tabBtn = page.locator(`[data-tab="${tabId}"], [onclick*="${tabId}"], button:has-text("${tabId}")`).first();
        if (await tabBtn.isVisible().catch(() => false)) {
          await tabBtn.click();
          await page.waitForTimeout(1000);
        }
      }

      // Wait for the page-specific "ready" selector, then a beat for
      // canvas-based charts to finish drawing.
      await waitReadySelector(page, p.ready);
      await waitChartsSettled(page);

      await page.screenshot({ path: outPath, fullPage: false });
      process.stdout.write(` OK\n`);
    } catch (e) {
      process.stdout.write(` FAILED: ${e.message.slice(0, 80)}\n`);
    }
  }

  // System sub-tabs (model, data, external) — the page reads location.hash
  // on mount, so we navigate fresh to each hashed URL rather than clicking.
  for (const st of systemTabs) {
    const outPath = join(SHOTS_DIR, `${st.name}.png`);
    process.stdout.write(`  ${st.name}...`);
    try {
      await page.goto(`${BASE}/birds/system.html#${st.tab}`, { waitUntil: 'domcontentloaded' });
      await waitReady(page, 4000);
      // Each tab has its own characteristic content — wait for something visible.
      await waitReadySelector(page, `[v-if*="${st.tab}"], .sys-tab-btn.active`, 8000);
      await waitChartsSettled(page);
      await page.screenshot({ path: outPath, fullPage: false });
      process.stdout.write(` OK\n`);
    } catch (e) {
      process.stdout.write(` FAILED: ${e.message.slice(0, 80)}\n`);
    }
  }

  await browser.close();
  console.log(`\nDone — ${pages.length + systemTabs.length} screenshots captured.`);
})();
