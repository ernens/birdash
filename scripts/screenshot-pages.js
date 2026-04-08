#!/usr/bin/env node
/**
 * screenshot-pages.js — Capture every page of a birdash site with Playwright
 *
 * Usage:
 *   node scripts/screenshot-pages.js [options]
 *
 * Options:
 *   --root <url>         Root URL of the site          (default: http://192.168.2.217/birds)
 *   --out <dir>          Output directory              (default: ./screenshots)
 *   --pages <list>       Comma-separated page list     (default: auto-discover from public/)
 *   --width <px>         Viewport width                (default: 1440)
 *   --height <px>        Viewport height               (default: 900)
 *   --full-page          Capture the full scrollable page (default: true)
 *   --no-full-page       Capture only the viewport
 *   --wait <ms>          Extra wait after load         (default: 3000)
 *   --theme <name>       Force theme via localStorage  (auto|forest|night|paper|ocean|dusk|sepia|hicontrast|solar-dark|solar-light|nord)
 *   --lang <code>        Force UI language via localStorage  (fr|en|nl|de)
 *   --headful            Show the browser window
 *   --timeout <ms>       Navigation timeout            (default: 60000)
 *   --no-subpages        Skip settings/* and system tabs (default: include)
 *   --fail-on-api-error  Mark page as failed if API requests return 4xx/5xx
 *   --gap <ms>           Delay between pages to avoid rate limits (default: 3000)
 *   --retries <n>        Retry pages with API errors up to N times (default: 2)
 *
 * Example:
 *   node scripts/screenshot-pages.js --root http://192.168.2.217/birds --out ./shots
 *   node scripts/screenshot-pages.js --root http://192.168.2.217/birdstest --theme dark
 *
 * Prerequisite:
 *   npm install -D playwright
 *   npx playwright install chromium
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── CLI parsing ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    root:     'http://192.168.2.217/birds',
    out:      path.resolve(process.cwd(), 'screenshots'),
    pages:    null,
    width:    1440,
    height:   900,
    fullPage: true,
    wait:     3000,
    theme:    null,
    lang:     null,
    headful:  false,
    timeout:  60000,
    subpages: true,
    failOnApiError: false,
    gap:      3000,
    retries:  2,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--root':         args.root = argv[++i]; break;
      case '--out':          args.out  = path.resolve(argv[++i]); break;
      case '--pages':        args.pages = argv[++i].split(',').map(s => s.trim()).filter(Boolean); break;
      case '--width':        args.width  = parseInt(argv[++i], 10); break;
      case '--height':       args.height = parseInt(argv[++i], 10); break;
      case '--full-page':    args.fullPage = true; break;
      case '--no-full-page': args.fullPage = false; break;
      case '--wait':         args.wait = parseInt(argv[++i], 10); break;
      case '--theme':        args.theme = argv[++i]; break;
      case '--lang':         args.lang  = argv[++i]; break;
      case '--headful':      args.headful = true; break;
      case '--timeout':      args.timeout = parseInt(argv[++i], 10); break;
      case '--no-subpages':  args.subpages = false; break;
      case '--fail-on-api-error': args.failOnApiError = true; break;
      case '--gap':          args.gap = parseInt(argv[++i], 10); break;
      case '--retries':      args.retries = parseInt(argv[++i], 10); break;
      case '-h':
      case '--help':
        console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
        process.exit(0);
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(1);
    }
  }
  return args;
}

// ── Page discovery ───────────────────────────────────────────────────────────
// Tab pages: hash-based subpages within a single HTML file. Captured as
// <basename>-<tab>.png by navigating to <page>#<tab>.
const TAB_PAGES = {
  'system.html':   ['health', 'model', 'data', 'external'],
  'settings.html': ['detection', 'audio', 'notif', 'station', 'services',
                    'species', 'backup', 'database', 'terminal'],
};

function isRedirectStub(filePath) {
  // Detect HTML files that redirect via <meta refresh> or location.replace
  // before <body>. Some files (e.g. recent.html) preserve the full markup
  // for legacy/SEO but redirect from the <head>, so we only look at the head.
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const headEnd = content.search(/<\/head>/i);
    const head = headEnd > 0 ? content.slice(0, headEnd) : content.slice(0, 2000);
    return /meta\s+http-equiv=["']refresh["']|location\.(replace|href)\s*[(=]/i.test(head);
  } catch (e) {
    return false;
  }
}

function discoverPages(includeSubpages) {
  // Try to discover HTML pages from public/ directory if available
  const publicDir = path.resolve(__dirname, '../public');
  const defaults = [
    'overview.html', 'today.html',
    'dashboard.html', 'spectrogram.html', 'log.html',
    'calendar.html', 'timeline.html', 'detections.html', 'review.html',
    'species.html', 'rarities.html', 'gallery.html', 'recordings.html', 'favorites.html',
    'weather.html', 'stats.html', 'analyses.html', 'biodiversity.html',
    'models.html', 'phenology.html',
    'settings.html', 'system.html',
  ];

  let topLevel;
  if (!fs.existsSync(publicDir)) {
    topLevel = defaults;
  } else {
    try {
      const files = fs.readdirSync(publicDir)
        .filter(f => f.endsWith('.html'))
        // Skip test/debug pages
        .filter(f => !f.startsWith('test') && !f.includes('-test') && !f.startsWith('spectro-test'))
        // Skip redirect-only stubs (e.g. index.html → dashboard, recent.html → calendar)
        .filter(f => !isRedirectStub(path.join(publicDir, f)))
        .sort();
      topLevel = files.length ? files : defaults;
    } catch (e) {
      topLevel = defaults;
    }
  }

  if (!includeSubpages) return topLevel;

  // Expand tab pages into one entry per tab
  const expanded = [];
  for (const p of topLevel) {
    expanded.push(p);
    if (TAB_PAGES[p]) {
      for (const tab of TAB_PAGES[p]) {
        expanded.push(`${p}#${tab}`);
      }
    }
  }
  return expanded;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);

  // Lazy-require playwright so the --help flag works even if not installed
  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    console.error('\u274c  playwright is not installed.');
    console.error('   Install it with:');
    console.error('     cd ' + path.resolve(__dirname, '..'));
    console.error('     npm install -D playwright');
    console.error('     npx playwright install chromium');
    process.exit(1);
  }

  const pages = args.pages || discoverPages(args.subpages);

  // Ensure output directory exists
  fs.mkdirSync(args.out, { recursive: true });

  const root = args.root.replace(/\/+$/, ''); // strip trailing slash
  console.log(`\uD83C\uDF10  Root: ${root}`);
  console.log(`\uD83D\uDCC1  Output: ${args.out}`);
  console.log(`\uD83D\uDCCB  Pages: ${pages.length}`);
  console.log(`\uD83D\uDDBC\uFE0F   Viewport: ${args.width}\u00d7${args.height}${args.fullPage ? ' (full page)' : ''}`);
  if (args.theme) console.log(`\uD83C\uDFA8  Theme: ${args.theme}`);
  if (args.lang)  console.log(`\uD83C\uDF10  Language: ${args.lang}`);
  console.log('');

  const browser = await playwright.chromium.launch({ headless: !args.headful });
  const context = await browser.newContext({
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: 2, // retina quality
    ignoreHTTPSErrors: true,
  });

  // Apply theme + language overrides before any page loads.
  // Note: the app uses `birdash_theme` and `birdash_lang` (underscores).
  // We also set the legacy hyphenated key for theme in case the migration
  // hasn't run yet on this browser.
  //
  // IMPORTANT: addInitScript runs on the new document BEFORE document.documentElement
  // exists, so we can't call setAttribute on it. The page's own bird-vue-core.js
  // reads localStorage and sets data-theme/lang on documentElement immediately
  // after Vue boots — so localStorage.setItem alone is enough. Setting localStorage
  // is also done first so a subsequent throw can't strand it.
  if (args.theme || args.lang) {
    await context.addInitScript(({ theme, lang }) => {
      try {
        if (theme) {
          localStorage.setItem('birdash_theme', theme);
          localStorage.setItem('birdash-theme', theme);
        }
        if (lang) {
          localStorage.setItem('birdash_lang', lang);
        }
      } catch (e) {}
    }, { theme: args.theme, lang: args.lang });
  }

  // Log console errors per page
  context.on('weberror', e => console.warn(`   \u26a0\uFE0F  pageerror: ${e.error().message}`));

  const results = { ok: [], failed: [], apiErrors: [] };
  const started = Date.now();

  // Capture one page. Returns { ok, apiErrors, error, dt, outFile }.
  async function capturePage(page) {
    const hashIdx = page.indexOf('#');
    const filePart = hashIdx >= 0 ? page.slice(0, hashIdx) : page;
    const hashPart = hashIdx >= 0 ? page.slice(hashIdx + 1) : '';
    const stem     = filePart.replace(/\.html?$/i, '');
    const basename = hashPart ? `${stem}-${hashPart}` : stem;
    const url      = `${root}/${page}`;
    const outFile  = path.join(args.out, `${basename}.png`);

    const pw = await context.newPage();
    pw.on('pageerror', e => console.warn(`   \u26a0\uFE0F  JS error on ${page}: ${e.message}`));

    // Known-noise endpoints we ignore (auth-gated, expected to fail in headless)
    const IGNORE_URL_RX = /\/terminal\/token$/;
    const apiErrors = [];
    pw.on('response', (resp) => {
      const status = resp.status();
      const u = resp.url();
      if (status >= 400 && !IGNORE_URL_RX.test(u)) apiErrors.push(`${status} ${u}`);
    });
    pw.on('requestfailed', (req) => {
      const u = req.url();
      if (IGNORE_URL_RX.test(u)) return;
      apiErrors.push(`FAIL ${req.failure() ? req.failure().errorText : '?'} ${u}`);
    });

    const t0 = Date.now();
    try {
      await pw.goto(url, { waitUntil: 'load', timeout: args.timeout });
      try {
        await pw.waitForLoadState('networkidle', { timeout: 5000 });
      } catch (_) { /* polling page — that's ok */ }
      if (args.wait) await pw.waitForTimeout(args.wait);
      await pw.screenshot({ path: outFile, fullPage: args.fullPage });
      return { ok: true, apiErrors, dt: Date.now() - t0, outFile };
    } catch (e) {
      return { ok: false, apiErrors, dt: Date.now() - t0, outFile, error: e.message };
    } finally {
      await pw.close();
    }
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    process.stdout.write(`\u27a4  ${page.padEnd(28)} `);

    let res = await capturePage(page);
    let attempt = 0;
    // Retry on navigation failure OR if API errors happened (likely rate limit)
    while (
      attempt < args.retries &&
      (!res.ok || res.apiErrors.length > 0)
    ) {
      attempt++;
      // Back-off: 429 means rate-limited, needs much longer than other errors.
      const has429 = res.apiErrors.some(e => e.startsWith('429 '));
      const backoff = has429 ? 20000 * attempt : 5000 * attempt;
      process.stdout.write(`(retry ${attempt} in ${backoff}ms) `);
      await new Promise(r => setTimeout(r, backoff));
      res = await capturePage(page);
    }

    if (res.ok) {
      const apiTag = res.apiErrors.length ? `  \u26a0\uFE0F  ${res.apiErrors.length} API err` : '';
      console.log(`\u2714  ${res.dt}ms  \u2192  ${path.basename(res.outFile)}${apiTag}`);
      if (res.apiErrors.length) {
        res.apiErrors.slice(0, 5).forEach(e => console.log(`     \u2937  ${e}`));
        if (res.apiErrors.length > 5) console.log(`     \u2937  ... +${res.apiErrors.length - 5} more`);
        results.apiErrors.push({ page, errors: res.apiErrors });
        if (args.failOnApiError) {
          results.failed.push({ page, error: `${res.apiErrors.length} API errors` });
        } else {
          results.ok.push(page);
        }
      } else {
        results.ok.push(page);
      }
    } else {
      console.log(`\u2718  ${res.dt}ms  ${res.error.split('\n')[0]}`);
      results.failed.push({ page, error: res.error });
    }

    // Inter-page delay to avoid hammering the API rate limiter
    if (args.gap && i < pages.length - 1) {
      await new Promise(r => setTimeout(r, args.gap));
    }
  }

  await browser.close();

  const total = Date.now() - started;
  console.log('');
  console.log(`\u2705  ${results.ok.length} OK   \u274C  ${results.failed.length} failed   \u26A0\uFE0F  ${results.apiErrors.length} with API errors   \u23F1\uFE0F  ${(total / 1000).toFixed(1)}s`);
  if (results.apiErrors.length) {
    console.log('');
    console.log('Pages with API errors:');
    results.apiErrors.forEach(({ page, errors }) => {
      console.log(`  - ${page} (${errors.length})`);
      errors.slice(0, 3).forEach(e => console.log(`      ${e}`));
      if (errors.length > 3) console.log(`      ... +${errors.length - 3} more`);
    });
  }
  if (results.failed.length) {
    console.log('');
    console.log('Failed pages:');
    results.failed.forEach(f => console.log(`  - ${f.page}: ${f.error.split('\n')[0]}`));
    process.exit(2);
  }
}

main().catch(err => {
  console.error('\u274c  Fatal:', err);
  process.exit(1);
});
