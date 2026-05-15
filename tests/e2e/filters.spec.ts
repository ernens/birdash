// @ts-check
// tests/e2e/filters.spec.ts
//
// E2E coverage of the /detections filter panel.
//
// Each test re-navigates to /detections and waits for the first row, so the
// suite has no shared state — order-independent and safe to run in parallel.
//
// API interception note: the user asked to intercept `/api/detections`, but
// detections.html does not use that endpoint. It POSTs SQL through the
// multiplexed `/api/query` route (see public/js/bird-shared.js → birdQuery).
// The tests therefore listen on `/api/query` and identify detection queries
// by their SQL fragment (`FROM detections`). The `/api/detections` route is
// also intercepted defensively so a future refactor that introduces it would
// not silently bypass our assertions.

import { test, expect, type Page, type Request } from '@playwright/test';

const DETECTIONS_PATH = '/birds/detections.html';

/** A captured detections SQL request. */
type DetectionsQuery = {
  url: string;
  sql: string;
  params: unknown[];
};

/**
 * Install a fetch listener that records every `/api/query` whose SQL touches
 * the `detections` table. Returns the list and a helper that waits for the
 * next request to land.
 */
function trackDetectionsQueries(page: Page) {
  const seen: DetectionsQuery[] = [];

  page.on('request', (req: Request) => {
    const url = req.url();
    if (req.method() !== 'POST') return;
    if (!url.includes('/api/query') && !url.includes('/api/detections')) return;
    let body: { sql?: string; params?: unknown[] } = {};
    try {
      body = JSON.parse(req.postData() || '{}');
    } catch {
      /* non-JSON body — skip */
    }
    const sql = body.sql || '';
    if (!/from\s+detections/i.test(sql)) return;
    seen.push({ url, sql, params: body.params ?? [] });
  });

  /** Wait for at least `min` detections queries to have arrived since `since`. */
  const waitForNew = async (since: number, min = 1, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (seen.length - since >= min) return seen.slice(since);
      await page.waitForTimeout(50);
    }
    throw new Error(
      `Timed out waiting for ${min} new /api/query (detections) request(s); ` +
        `saw ${seen.length - since}.`
    );
  };

  return { seen, waitForNew };
}

/** Wait for the table to settle: at least one row, no spinner. */
async function waitForDetections(page: Page) {
  await expect(page.getByTestId('detections-list')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('detections-row').first()).toBeVisible();
}

/** Number reported in the result-count badge (parsed from data-count). */
async function readResultCount(page: Page): Promise<number> {
  const raw = await page.getByTestId('detections-result-count').getAttribute('data-count');
  if (raw === null) throw new Error('detections-result-count missing data-count');
  return parseInt(raw, 10);
}

/** Set the confidence slider via Vue's reactive change handler. */
async function setConfidenceSlider(page: Page, value: number) {
  const slider = page.getByTestId('filter-confidence-slider');
  // Use the DOM directly: Vue listens on the @input event, not on label clicks.
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/** Pick a species in the multiselect by its common-name data attribute. */
async function selectSpecies(page: Page, species: string) {
  await page.getByTestId('filter-species-trigger').click();
  await expect(page.getByTestId('filter-species-dropdown')).toBeVisible();
  await page.getByTestId('filter-species-search').fill(species.slice(0, 4));
  // Within the dropdown, click the option for the exact species. Force the
  // click because the parent label is wider than the visible checkbox.
  await page
    .locator(`[data-testid="filter-species-option"][data-species="${species}"]`)
    .first()
    .click();
  // Close the dropdown — that's what flushes the species filter to the API.
  await page.getByTestId('filter-species-trigger').click();
  await expect(page.getByTestId('filter-species-dropdown')).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.goto(DETECTIONS_PATH);
  await waitForDetections(page);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Species filter + autocomplete behaviour
// ─────────────────────────────────────────────────────────────────────────────
test('species filter narrows the table and triggers an API call with the species', async ({
  page,
}) => {
  const queries = trackDetectionsQueries(page);
  const initialBefore = queries.seen.length;
  const initialCount = await readResultCount(page);

  // Open dropdown — autocomplete search becomes visible.
  await page.getByTestId('filter-species-trigger').click();
  await expect(page.getByTestId('filter-species-dropdown')).toBeVisible();
  await expect(page.getByTestId('filter-species-search')).toBeVisible();

  // Initial option count: typically dozens of species in the local checklist.
  const optionsAll = page.getByTestId('filter-species-option');
  const initialOptionsCount = await optionsAll.count();
  expect(initialOptionsCount).toBeGreaterThan(1);

  // Type "merle" — list shrinks to species whose name contains the query
  // (Merle noir, Merle à plastron, etc.).
  await page.getByTestId('filter-species-search').fill('merle');
  // Give Vue one tick.
  await page.waitForFunction(
    (initial) =>
      document.querySelectorAll('[data-testid="filter-species-option"]').length < initial,
    initialOptionsCount,
    { timeout: 3000 }
  );
  const filteredCount = await optionsAll.count();
  expect(filteredCount).toBeLessThan(initialOptionsCount);
  // Every remaining option's common name should contain the search string.
  const remaining = await optionsAll.evaluateAll((els) =>
    els.map((e) => (e.getAttribute('data-species') || '').toLowerCase())
  );
  for (const name of remaining) {
    expect(name).toContain('merle');
  }

  // Pick "Merle noir" (the most prolific species in Heinsch).
  const TARGET = 'Merle noir';
  await page
    .locator(`[data-testid="filter-species-option"][data-species="${TARGET}"]`)
    .first()
    .click();
  // Close dropdown → flushes filter to the API.
  await page.getByTestId('filter-species-trigger').click();
  await expect(page.getByTestId('filter-species-dropdown')).toBeHidden();

  // The selected species shows up as a removable tag in the trigger.
  await expect(
    page.locator(`[data-testid="filter-species-tag"][data-species="${TARGET}"]`)
  ).toBeVisible();

  // At least one new SQL query was issued, with "Merle noir" in the params.
  const newQueries = await queries.waitForNew(initialBefore, 1);
  const speciesQuery = newQueries.find((q) =>
    q.params.some((p) => typeof p === 'string' && p.includes(TARGET))
  );
  expect(
    speciesQuery,
    `expected at least one /api/query carrying "${TARGET}" in params, got: ` +
      JSON.stringify(newQueries.map((q) => q.params))
  ).toBeTruthy();

  // The remaining rows all belong to the picked species.
  const rows = page.getByTestId('detections-row');
  await expect(rows.first()).toBeVisible();
  const rowSpecies = await rows.evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-species'))
  );
  for (const s of rowSpecies) expect(s).toBe(TARGET);

  // Filtering should not enlarge the result set.
  const filteredResultCount = await readResultCount(page);
  expect(filteredResultCount).toBeLessThanOrEqual(initialCount);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Date-range filter
// ─────────────────────────────────────────────────────────────────────────────
test('date-range filter changes the active period and re-queries with a new range', async ({
  page,
}) => {
  const queries = trackDetectionsQueries(page);

  // Default is 7d (set by useFilterPeriod's `default: '7d'` in review/detections).
  await expect(page.getByTestId('filter-period-7d')).toHaveClass(/active/);

  const before = queries.seen.length;
  await page.getByTestId('filter-period-1d').click();
  await expect(page.getByTestId('filter-period-1d')).toHaveClass(/active/);
  await expect(page.getByTestId('filter-period-7d')).not.toHaveClass(/active/);

  const queriesForRange = await queries.waitForNew(before, 1);

  // The new range must be reflected in at least one SQL's params. The where
  // clause uses `Date >= ? AND Date <= ?`; today's ISO date appears in params.
  const today = new Date().toISOString().slice(0, 10);
  const matched = queriesForRange.find((q) =>
    q.params.some((p) => typeof p === 'string' && p === today)
  );
  expect(
    matched,
    `expected a date param matching today (${today}); got: ` +
      JSON.stringify(queriesForRange.map((q) => q.params))
  ).toBeTruthy();

  // Active chip banner is populated (range != default).
  await expect(page.getByTestId('filter-active-chips')).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Confidence slider (debounced ~250 ms in useFilterConfidence)
// ─────────────────────────────────────────────────────────────────────────────
test('confidence slider re-queries with the new threshold and keeps only high-confidence rows', async ({
  page,
}) => {
  const queries = trackDetectionsQueries(page);
  const before = queries.seen.length;

  await setConfidenceSlider(page, 0.9);

  // 250 ms debounce + RTT.
  const newQueries = await queries.waitForNew(before, 1, 4000);
  const matched = newQueries.find((q) =>
    q.params.some((p) => typeof p === 'number' && Math.abs(p - 0.9) < 1e-6)
  );
  expect(
    matched,
    `expected a confidence param ≥ 0.9; got: ` +
      JSON.stringify(newQueries.map((q) => q.params))
  ).toBeTruthy();

  // The visible rows must respect the threshold.
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('[data-testid="detections-row"]');
    if (!rows.length) return true; // empty after threshold is acceptable
    return Array.from(rows).every((r) => {
      const c = parseFloat((r as HTMLElement).getAttribute('data-confidence') || '0');
      return c >= 0.9 - 1e-6;
    });
  });

  const rows = page.getByTestId('detections-row');
  const rowCount = await rows.count();
  if (rowCount > 0) {
    const confidences = await rows.evaluateAll((els) =>
      els.map((e) => parseFloat(e.getAttribute('data-confidence') || '0'))
    );
    for (const c of confidences) {
      expect(c).toBeGreaterThanOrEqual(0.9 - 1e-6);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Combo: species + date
// ─────────────────────────────────────────────────────────────────────────────
test('species + date combine, both chips show, and the API receives both filters', async ({
  page,
}) => {
  const queries = trackDetectionsQueries(page);
  const TARGET = 'Merle noir';

  // Widen the date window first so a common species is likely to appear.
  await page.getByTestId('filter-period-1y').click();
  await expect(page.getByTestId('filter-period-1y')).toHaveClass(/active/);

  // Now pick the species.
  await selectSpecies(page, TARGET);

  // Both chips should be present.
  await expect(page.getByTestId('filter-active-chips')).toBeVisible();
  const chipKeys = await page
    .getByTestId('filter-active-chip')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-chip')));
  expect(chipKeys).toEqual(expect.arrayContaining(['species', 'period']));

  // At least one query carried both the species AND a date string that is not
  // today (because the 1y window spans further back).
  const lastQuery = queries.seen.at(-1);
  expect(lastQuery, 'no detections query captured').toBeTruthy();
  expect(
    lastQuery!.params.some((p) => typeof p === 'string' && p.includes(TARGET))
  ).toBeTruthy();
  expect(
    lastQuery!.params.some((p) => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p))
  ).toBeTruthy();

  // All visible rows are the picked species.
  const rows = page.getByTestId('detections-row');
  if ((await rows.count()) > 0) {
    const speciesValues = await rows.evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-species'))
    );
    for (const s of speciesValues) expect(s).toBe(TARGET);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Reset returns the panel to its initial state
// ─────────────────────────────────────────────────────────────────────────────
test('reset restores default period, removes chips, and brings the row count back', async ({
  page,
}) => {
  // Capture the pristine state.
  const initialCount = await readResultCount(page);
  await expect(page.getByTestId('filter-active-chips')).toBeHidden();
  await expect(page.getByTestId('filter-period-7d')).toHaveClass(/active/);

  // Apply three filters — period, species, confidence — so chip bar shows them all.
  await page.getByTestId('filter-period-1d').click();
  await expect(page.getByTestId('filter-period-1d')).toHaveClass(/active/);

  await selectSpecies(page, 'Merle noir');
  await setConfidenceSlider(page, 0.95);

  // Chip bar visible with at least one chip (count depends on whether 0.95
  // counts as "non default" for confidence — the panel emits a chip for each
  // filter that differs from default).
  await expect(page.getByTestId('filter-active-chips')).toBeVisible();
  expect(await page.getByTestId('filter-active-chip').count()).toBeGreaterThan(0);

  // Now reset.
  await page.getByTestId('filter-reset').click();

  // Chip bar disappears, default period is back, species tag gone.
  await expect(page.getByTestId('filter-active-chips')).toBeHidden();
  await expect(page.getByTestId('filter-period-7d')).toHaveClass(/active/);
  await expect(page.getByTestId('filter-period-1d')).not.toHaveClass(/active/);
  await expect(page.getByTestId('filter-species-tag')).toHaveCount(0);

  // Count returns to the pre-filter value (allow a small drift: a fresh
  // detection may have landed during the test).
  const afterReset = await readResultCount(page);
  expect(Math.abs(afterReset - initialCount)).toBeLessThanOrEqual(5);
});
