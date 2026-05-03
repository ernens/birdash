/**
 * Test ciblé Phase 1B — vérifie que le bbox SVG overlay s'affiche dans
 * la modal et sur today.html, et que le toggle fonctionne.
 *
 * Usage : node scripts/test_bbox_overlay.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost/birds';
const SCREENSHOTS_DIR = '/tmp/bbox-test';

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  const errors = [];
  const bboxApiCalls = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text());
    if (m.text().startsWith('[bbox-debug]')) console.log('  (browser)', m.text());
  });
  page.on('request', r => { if (r.url().includes('/api/detections/bbox')) bboxApiCalls.push(r.url()); });
  page.on('response', r => { if (r.url().includes('/api/detections/bbox')) bboxApiCalls.push(`  → ${r.status()}`); });

  // ── today.html ──────────────────────────────────────────────────────
  console.log('→ today.html');
  await page.goto(BASE + '/today.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  // Ensure pref is on
  await page.evaluate(() => localStorage.setItem('birdash:showBbox', '1'));
  await page.reload({ waitUntil: 'networkidle' });
  // Hook calls to attach + show before any spectro renders
  await page.addInitScript(() => {
    window.__bboxLog = [];
    const wait = setInterval(() => {
      if (window.BIRDASH?.showBboxForFile) {
        const orig = window.BIRDASH.showBboxForFile;
        window.BIRDASH.showBboxForFile = async function(canvas, file, opts) {
          window.__bboxLog.push({ fn: 'show', file, opts, hasCanvas: !!canvas, parentClass: canvas?.parentNode?.className });
          return orig.call(this, canvas, file, opts);
        };
        const origAttach = window.BIRDASH.attachBboxOverlay;
        window.BIRDASH.attachBboxOverlay = function(canvas, bbox, opts) {
          window.__bboxLog.push({ fn: 'attach', bbox, opts, hasCanvas: !!canvas });
          return origAttach.call(this, canvas, bbox, opts);
        };
        clearInterval(wait);
      }
    }, 50);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  // Try to click first species → first detection
  const firstSpecies = page.locator('.td-species-card').first();
  if (await firstSpecies.isVisible().catch(() => false)) {
    await firstSpecies.click();
    await page.waitForTimeout(2500); // wait for spectro decode + render
  }
  // Bbox is now painted directly on the canvas (no SVG sibling because Vue
  // strips non-Vue children). We verify by sampling pixels along the expected
  // bbox border for the amber color.
  const bboxOnToday = await page.evaluate(() => {
    const c = document.querySelector('canvas.spectro-canvas');
    if (!c) return 'no canvas';
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    let amberPx = 0;
    for (let i = 0; i < img.length; i += 4) {
      const r = img[i], g = img[i + 1], b = img[i + 2];
      // amber #fbbf24 → r=251, g=191, b=36, allow tolerance
      if (r > 230 && g > 170 && g < 220 && b < 80) amberPx++;
    }
    return amberPx;
  });
  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector('canvas.spectro-canvas');
    if (!c) return 'no canvas';
    const parent = c.parentElement;
    return {
      canvasW: c.width, canvasH: c.height,
      parentTag: parent.tagName, parentClass: parent.className,
      siblings: Array.from(parent.children).map(el => el.tagName + (el.className ? '.' + el.className.split(' ')[0] : '')),
      U_has_show: typeof window.BIRDASH?.showBboxForFile,
      pref: localStorage.getItem('birdash:showBbox'),
    };
  });
  console.log('  today.html amber pixels:', bboxOnToday);
  console.log('  canvasInfo:', JSON.stringify(canvasInfo));
  // Also probe a bbox API call
  const apiProbe = await page.evaluate(async () => {
    const file = window.__lastFile || null;
    if (!file) return 'no __lastFile';
    const r = await fetch('/api/detections/bbox?file=' + encodeURIComponent(file));
    return { status: r.status, file };
  });
  console.log('  apiProbe:', JSON.stringify(apiProbe));
  const bboxLog = await page.evaluate(() => window.__bboxLog || []);
  console.log('  bboxLog:', JSON.stringify(bboxLog).slice(0, 600));
  console.log('  bbox API calls so far:', bboxApiCalls.length, bboxApiCalls.slice(0, 4));
  await page.screenshot({ path: SCREENSHOTS_DIR + '/today_bbox.png', fullPage: false });
  // Cropped close-up of just the spectrogram for clearer visual confirmation
  const spec = await page.locator('canvas.spectro-canvas').first();
  if (await spec.isVisible().catch(() => false)) {
    await spec.screenshot({ path: SCREENSHOTS_DIR + '/today_bbox_close.png' });
  }

  // ── modal via review.html ────────────────────────────────────────────
  console.log('→ review.html → modal');
  await page.goto(BASE + '/review.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  // Click first spectro button
  const spectroBtn = page.locator('button[title="Spectrogramme"]').first();
  if (await spectroBtn.isVisible().catch(() => false)) {
    await spectroBtn.click();
    await page.waitForTimeout(3500); // wait for modal load + bbox fetch
  }
  const bboxInModal = await page.evaluate(() => {
    const c = document.querySelector('.spectro-modal-canvas-wrap canvas');
    if (!c) return 'no canvas';
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    let amberPx = 0;
    for (let i = 0; i < img.length; i += 4) {
      const r = img[i], g = img[i + 1], b = img[i + 2];
      if (r > 230 && g > 170 && g < 220 && b < 80) amberPx++;
    }
    return amberPx;
  });
  console.log('  modal amber pixels:', bboxInModal);
  await page.screenshot({ path: SCREENSHOTS_DIR + '/modal_bbox_on.png', fullPage: false });
  const mspec = await page.locator('.spectro-modal-canvas-wrap canvas').first();
  if (await mspec.isVisible().catch(() => false)) {
    await mspec.screenshot({ path: SCREENSHOTS_DIR + '/modal_bbox_on_close.png' });
  }

  // Toggle off — button has the i18n-translated title attr
  const toggleBtn = page.locator('.spectro-modal-filters button[title*="zone"], .spectro-modal-filters button[title*="energy"], .spectro-modal-filters button[title*="energie"]').first();
  if (await toggleBtn.isVisible().catch(() => false)) {
    await toggleBtn.click();
    await page.waitForTimeout(500);
    const bboxAfterOff = await page.locator('.spectro-modal-canvas-wrap svg.birdash-bbox-overlay').count();
    console.log('  after toggle off, SVG count:', bboxAfterOff);
    await page.screenshot({ path: SCREENSHOTS_DIR + '/modal_bbox_off.png', fullPage: false });
    // Toggle on again
    await toggleBtn.click();
    await page.waitForTimeout(800);
    const bboxAfterOn = await page.locator('.spectro-modal-canvas-wrap svg.birdash-bbox-overlay').count();
    console.log('  after toggle on, SVG count:', bboxAfterOn);
  } else {
    console.log('  toggle button not found');
  }

  if (errors.length) {
    console.log('\nERRORS:');
    errors.forEach(e => console.log('  ' + e));
  }

  await browser.close();
  console.log('\nScreenshots in', SCREENSHOTS_DIR);
  process.exit(errors.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
