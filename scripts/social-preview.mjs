/**
 * social-preview.mjs — Generate a 1280×640 social preview image
 * for GitHub repo (also good for Twitter/Mastodon/HN cards).
 *
 * Composes a 6-screenshot collage with logo overlay + tagline.
 * Output : screenshots/social-preview.png
 *
 * Usage : node scripts/social-preview.mjs
 *
 * Upload manuel : repo Settings → Social preview → Upload an image
 */

import { chromium } from 'playwright';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const OUT_PATH = join(PROJECT_ROOT, 'screenshots', 'social-preview.png');

const SHOTS = [
  'overview.png',
  'today.png',
  'spectrogram.png',
  'analyses.png',
  'biodiversity.png',
  'system.png',
];

function imgDataUrl(relPath, mime) {
  const data = readFileSync(join(PROJECT_ROOT, relPath));
  return `data:${mime};base64,${data.toString('base64')}`;
}

const shotsB64 = SHOTS.map(s => imgDataUrl(join('screenshots', s), 'image/png'));
const logoB64 = imgDataUrl(join('public', 'img', 'robin-logo.svg'), 'image/svg+xml');

const html = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1280px; height: 640px; overflow: hidden; }
  body {
    background: linear-gradient(135deg, #0a1810 0%, #142820 50%, #0a1810 100%);
    font-family: 'Lora', Georgia, serif; color: #c8e6c0;
    position: relative;
  }
  .grid {
    position: absolute; inset: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(2, 1fr);
    gap: 14px;
    padding: 24px;
    opacity: .85;
    filter: saturate(.95);
  }
  .cell {
    background-size: cover; background-position: top center;
    border-radius: 10px;
    border: 1px solid rgba(90, 158, 58, .35);
    box-shadow: 0 4px 14px rgba(0,0,0,.5);
  }
  .overlay {
    position: absolute; inset: 0;
    background:
      linear-gradient(180deg, rgba(10, 24, 16, .15) 0%, rgba(10, 24, 16, .55) 38%, rgba(10, 24, 16, .9) 65%, rgba(10, 24, 16, .95) 100%);
    display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
    text-align: center; padding: 60px 40px 50px;
  }
  .logo-wrap {
    display: flex; align-items: center; gap: 22px;
    margin-bottom: 16px;
  }
  .logo-img {
    width: 88px; height: 88px;
    filter: drop-shadow(0 0 14px rgba(90, 158, 58, .55));
  }
  h1 {
    font-size: 86px; font-weight: 700;
    color: #c8e6c0; letter-spacing: -0.02em;
    text-shadow: 0 2px 18px rgba(0,0,0,.6);
  }
  .tagline {
    font-size: 26px; color: #c8e6c0; font-style: italic;
    margin-top: 4px; max-width: 880px; line-height: 1.4;
    text-shadow: 0 2px 8px rgba(0,0,0,.7);
  }
  .badges {
    display: flex; gap: 20px; margin-top: 26px;
    font-size: 18px; color: #c8e6c0;
  }
  .badge {
    background: rgba(90, 158, 58, .18);
    border: 1px solid rgba(90, 158, 58, .5);
    border-radius: 16px;
    padding: 6px 16px;
    font-family: ui-monospace, monospace;
  }
</style></head><body>
  <div class="grid">
    ${shotsB64.map(b64 => `<div class="cell" style="background-image: url('${b64}');"></div>`).join('')}
  </div>
  <div class="overlay">
    <div class="logo-wrap">
      <img class="logo-img" src="${logoB64}" alt="">
      <h1>BirdStation</h1>
    </div>
    <div class="tagline">
      Real-time bird detection dashboard for Raspberry Pi<br>
      BirdNET V2.4 + Perch V2 · weather · spectrogram · 4 languages
    </div>
    <div class="badges">
      <span class="badge">Pi 3 / 4 / 5</span>
      <span class="badge">Vue 3 + Node</span>
      <span class="badge">MIT</span>
    </div>
  </div>
</body></html>`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT_PATH, fullPage: false, omitBackground: false });
  await browser.close();
  console.log(`Social preview written: ${OUT_PATH}`);
  console.log('Upload via: GitHub repo → Settings → Social preview → Upload');
})();
