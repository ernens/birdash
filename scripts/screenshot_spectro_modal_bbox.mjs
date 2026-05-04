/**
 * Capture spectro-modal-bbox.png — full-screen spectrogram modal with the
 * Phase 1B amber bbox overlay visible. Used in the README / docs to show
 * the Detection Refinement module in action.
 *
 * Manual capture (not part of screenshots.mjs auto-run) because modal
 * flows aren't covered by the standard pages list.
 *
 * Usage: node scripts/screenshot_spectro_modal_bbox.mjs
 */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'screenshots', 'spectro-modal-bbox.png');
const BASE = 'http://localhost/birds';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();

  // Force English + lab theme for consistency with the auto screenshots
  await page.addInitScript(() => {
    localStorage.setItem('birdash_lang', 'en');
    localStorage.setItem('birdash_theme', 'lab');
    localStorage.setItem('birdash:showBbox', '1');
    document.documentElement.setAttribute('data-theme', 'lab');
  });

  // Open review.html — its rows have a spectro icon button that triggers the modal.
  // review has more low-conf / unstable detections so the bbox is on something interesting.
  console.log('→ review.html');
  await page.goto(`${BASE}/review.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const spectroBtn = page.locator('button[title="Spectrogramme"], button[title*="Spectrogram"]').first();
  if (!(await spectroBtn.isVisible().catch(() => false))) {
    console.error('No spectro button visible — aborting.');
    process.exit(1);
  }
  await spectroBtn.click();
  // Modal opens, fetches MP3, decodes, renders spectro, then bbox overlay paints.
  await page.waitForTimeout(4500);

  // Screenshot the whole viewport (modal is full-screen).
  await page.screenshot({ path: OUT, fullPage: false });
  console.log(`Wrote ${OUT}`);

  await browser.close();
})();
