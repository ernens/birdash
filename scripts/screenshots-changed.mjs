/**
 * screenshots-changed.mjs — Capture seulement les pages dont le fichier
 * source HTML a été modifié. Conçu pour être appelé par le hook
 * post-commit (mais utilisable à la main aussi).
 *
 * Usage :
 *   node scripts/screenshots-changed.mjs "stats.html,favorites.html"
 *   node scripts/screenshots-changed.mjs "system.html"   # capture aussi les sub-tabs
 *
 * Logique :
 *   Pour chaque .html cité, on cherche dans _pages.mjs toutes les
 *   entrées dont le `path` référence ce fichier — y compris les
 *   variantes avec query string ou hash (ex: stats.html → stats +
 *   stats-models). Pour system.html, on ajoute aussi les system-* sub-tabs.
 *
 * Mêmes paramètres que screenshots.mjs : theme lab, lang en, 1440x900,
 * retry sur 5xx, attente charts settled.
 */

import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pages, systemTabs } from './_pages.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const SHOTS_DIR = join(PROJECT_ROOT, 'screenshots');
const BASE = process.env.BIRDASH_BASE || 'http://localhost';
const THEME = 'lab';
const LANG = 'en';
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 5000;
const POST_READY_PAUSE_MS = 1500;

// ── Filter : map *.html files → page entries from _pages.mjs ──────────
const arg = process.argv[2] || '';
const changedHtmlFiles = arg.split(',').map(s => s.trim()).filter(Boolean);

if (!changedHtmlFiles.length) {
  console.error('Usage: node scripts/screenshots-changed.mjs "file1.html,file2.html"');
  process.exit(1);
}

// Find all page entries whose path references any of the changed files.
// '/birds/foo.html' or '/birds/foo.html?bar' or '/birds/foo.html#bar' all match 'foo.html'.
function pathMatches(path, htmlFile) {
  const re = new RegExp('/' + htmlFile.replace(/\./g, '\\.') + '($|[?#])');
  return re.test(path);
}

const targets = pages.filter(p =>
  changedHtmlFiles.some(f => pathMatches(p.path, f))
);

// Si system.html a changé, on capture aussi les sub-tabs (model/data/external)
if (changedHtmlFiles.includes('system.html')) {
  for (const st of systemTabs) {
    targets.push({
      name: st.name,
      path: `/birds/system.html#${st.tab}`,
      wait: 4500,
      ready: `[v-if*="${st.tab}"], .sys-tab-btn.active`,
    });
  }
}

if (!targets.length) {
  console.log(`No page entry matches: ${changedHtmlFiles.join(', ')}`);
  process.exit(0);
}

// ── Helpers (alignés sur screenshots.mjs) ─────────────────────────────
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

async function waitReadySelector(page, selector, timeout = 20000) {
  if (!selector) return;
  try { await page.waitForSelector(selector, { state: 'visible', timeout }); }
  catch {}
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

async function renderPage(page, p, url) {
  let upstreamError = false;
  const errorPaths = [];
  const handler = (resp) => {
    const code = resp.status();
    if (code === 502 || code === 504) {
      upstreamError = true;
      errorPaths.push(`${code} ${new URL(resp.url()).pathname}`);
    }
  };
  page.on('response', handler);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitReady(page, p.wait);
    if (p.action) await p.action(page);
    await waitReadySelector(page, p.ready);
    await waitChartsSettled(page);
  } finally {
    page.off('response', handler);
  }
  return { upstreamError, errorPaths };
}

async function captureWithRetry(page, p, url, outPath) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const tag = attempt === 0 ? '' : ` (retry ${attempt}/${MAX_RETRIES})`;
    process.stdout.write(`  ${p.name}${tag}...`);
    try {
      const { upstreamError, errorPaths } = await renderPage(page, p, url);
      if (upstreamError && attempt < MAX_RETRIES) {
        process.stdout.write(` 5xx (${errorPaths.slice(0, 2).join(', ')}), retrying\n`);
        await page.waitForTimeout(RETRY_BACKOFF_MS * (attempt + 1));
        continue;
      }
      await page.screenshot({ path: outPath, fullPage: false });
      process.stdout.write(upstreamError ? ` OK (with leftover 5xx)\n` : ` OK\n`);
      return;
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        process.stdout.write(` ERR (${e.message.slice(0, 60)}), retrying\n`);
        await page.waitForTimeout(RETRY_BACKOFF_MS * (attempt + 1));
      } else {
        process.stdout.write(` FAILED: ${e.message.slice(0, 80)}\n`);
      }
    }
  }
}

(async () => {
  console.log(`Capturing ${targets.length} screenshots from ${BASE} (filter: ${changedHtmlFiles.join(', ')})`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await setupPage(page);

  // Prime localStorage with theme/lang
  await page.goto(`${BASE}/birds/overview.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  for (const p of targets) {
    await captureWithRetry(page, p, `${BASE}${p.path}`, join(SHOTS_DIR, `${p.name}.png`));
  }

  await browser.close();
  console.log(`\nDone — ${targets.length} screenshots captured.`);
})();
