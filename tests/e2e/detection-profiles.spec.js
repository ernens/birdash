// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = (process.env.BIRDASH_URL || 'http://192.168.2.217') + '/birds';

// Profiles are sectioned since 1.55.38 ({shared, birdnet, perch, dual}).
// The server still accepts the legacy flat shape on POST and auto-migrates
// it into sections so a half-upgraded fleet during rollout keeps working.

test('detection-profiles API: list returns 3 builtins (sectioned)', async ({ request }) => {
  const resp = await request.get(`${BASE}/api/detection-profiles`);
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  expect(data.profiles).toBeDefined();
  for (const id of ['permissif', 'balance', 'rigoureux']) {
    expect(data.profiles[id], `builtin ${id} present`).toBeDefined();
    expect(data.profiles[id].builtin).toBe(true);
    // Every builtin populates all 4 sections.
    const v = data.profiles[id].values;
    expect(v.shared.SENSITIVITY, `${id}.shared.SENSITIVITY`).toBeGreaterThan(0);
    expect(v.birdnet.BIRDNET_CONFIDENCE, `${id}.birdnet.BIRDNET_CONFIDENCE`).toBeGreaterThan(0);
    expect(v.perch.PERCH_CONFIDENCE, `${id}.perch.PERCH_CONFIDENCE`).toBeGreaterThan(0);
    expect(v.dual.BIRDNET_CONFIDENCE, `${id}.dual.BIRDNET_CONFIDENCE`).toBeGreaterThan(0);
    expect(v.dual.DUAL_CONFIRM_ENABLED, `${id}.dual.DUAL_CONFIRM_ENABLED`).toBe(1);
  }
});

test('detection-profiles API: save (sectioned) + apply + delete', async ({ request }) => {
  const id = 'e2etest_' + Date.now();
  const create = await request.post(`${BASE}/api/detection-profiles`, {
    data: {
      id,
      label: 'E2E test ' + id,
      values: {
        shared: { SENSITIVITY: 1.1, SF_THRESH: 0.02 },
        birdnet: { BIRDNET_CONFIDENCE: 0.55, OVERLAP: 0.5 },
        perch: { PERCH_CONFIDENCE: 0.60, PERCH_MIN_MARGIN: 0.08 },
        dual: {
          BIRDNET_CONFIDENCE: 0.55,
          PERCH_CONFIDENCE: 0.20,
          PERCH_MIN_MARGIN: 0.08,
          DUAL_CONFIRM_ENABLED: 1,
          PERCH_STANDALONE_CONFIDENCE: 0.80,
          BIRDNET_ECHO_CONFIDENCE: 0.12,
        },
      },
    },
  });
  expect(create.ok(), 'create returns 2xx').toBeTruthy();
  const createData = await create.json();
  expect(createData.profile.builtin).toBe(false);
  expect(createData.profile.values.dual.BIRDNET_CONFIDENCE).toBe(0.55);

  const apply = await request.post(`${BASE}/api/detection-profiles/apply`, { data: { id } });
  expect(apply.ok()).toBeTruthy();
  const applyData = await apply.json();
  expect(applyData.active).toBe(id);
  expect(applyData.values.dual.BIRDNET_CONFIDENCE).toBe(0.55);
  expect(applyData.values.shared.SENSITIVITY).toBe(1.1);

  const del = await request.delete(`${BASE}/api/detection-profiles/${id}`);
  expect(del.ok()).toBeTruthy();

  const list = await request.get(`${BASE}/api/detection-profiles`);
  const listData = await list.json();
  expect(listData.profiles[id]).toBeUndefined();
});

test('detection-profiles API: flat shape auto-migrates to sectioned on POST', async ({ request }) => {
  const id = 'e2eflat_' + Date.now();
  const create = await request.post(`${BASE}/api/detection-profiles`, {
    data: {
      id,
      label: 'E2E flat ' + id,
      values: {
        BIRDNET_CONFIDENCE: 0.55,
        PERCH_CONFIDENCE: 0.20,
        PERCH_MIN_MARGIN: 0.08,
        DUAL_CONFIRM_ENABLED: 1,
        PERCH_STANDALONE_CONFIDENCE: 0.80,
        BIRDNET_ECHO_CONFIDENCE: 0.12,
        SENSITIVITY: 1.1,
        OVERLAP: 0.5,
        SF_THRESH: 0.02,
      },
    },
  });
  expect(create.ok(), 'flat POST accepted via auto-migration').toBeTruthy();
  const createData = await create.json();
  const v = createData.profile.values;
  // Shared keys land in shared.
  expect(v.shared.SENSITIVITY).toBe(1.1);
  expect(v.shared.SF_THRESH).toBe(0.02);
  // OVERLAP moves to birdnet (Perch uses fixed chunks).
  expect(v.birdnet.OVERLAP).toBe(0.5);
  // Everything else lands in dual — flat profiles were always tuned for dual.
  expect(v.dual.BIRDNET_CONFIDENCE).toBe(0.55);
  expect(v.dual.PERCH_CONFIDENCE).toBe(0.20);
  expect(v.dual.DUAL_CONFIRM_ENABLED).toBe(1);
  expect(v.dual.PERCH_STANDALONE_CONFIDENCE).toBe(0.80);
  expect(v.dual.BIRDNET_ECHO_CONFIDENCE).toBe(0.12);
  // No legacy flat keys remain at the top.
  expect(v.BIRDNET_CONFIDENCE).toBeUndefined();

  await request.delete(`${BASE}/api/detection-profiles/${id}`);
});

test('detection-profiles API: cannot delete a builtin', async ({ request }) => {
  const resp = await request.delete(`${BASE}/api/detection-profiles/balance`);
  expect(resp.status()).toBe(409);
});

test('detection-profiles API: invalid value rejected', async ({ request }) => {
  const resp = await request.post(`${BASE}/api/detection-profiles`, {
    data: {
      id: 'e2e_invalid_' + Date.now(),
      label: 'invalid',
      values: { dual: { BIRDNET_CONFIDENCE: 999 } },
    },
  });
  expect(resp.status()).toBe(400);
});

test('detection-profiles API: key in wrong section rejected', async ({ request }) => {
  // BIRDNET_CONFIDENCE doesn't belong in `shared` — it has different values per
  // topology, so it must live in `birdnet` and/or `dual`.
  const resp = await request.post(`${BASE}/api/detection-profiles`, {
    data: {
      id: 'e2e_wrong_section_' + Date.now(),
      label: 'wrong section',
      values: { shared: { BIRDNET_CONFIDENCE: 0.6 } },
    },
  });
  expect(resp.status()).toBe(400);
  const body = await resp.json();
  expect(body.error).toMatch(/not allowed in section shared/);
});

// UI: load a builtin profile fills the BirdNET confidence slider.
test('settings page: loading "Rigoureux" updates the BirdNET confidence input', async ({ page }) => {
  await page.goto('/birds/settings.html', { waitUntil: 'networkidle', timeout: 45000 });
  // Detection tab is the default tab on settings.html. Wait for the
  // profile bar (lazy-loaded partial).
  const select = page.locator('[data-testid="settings-detection-profile-select"]');
  await select.waitFor({ state: 'visible', timeout: 15000 });
  await select.selectOption('rigoureux');
  await page.locator('[data-testid="settings-detection-profile-load"]').click();
  // Rigoureux fills dual.BIRDNET_CONFIDENCE = 0.80 on a bird-like dual setup.
  // (On a BirdNET-only host, birdnet.BIRDNET_CONFIDENCE = 0.80 would fill instead.)
  await expect(page.locator('text=0.8').first()).toBeVisible({ timeout: 5000 });
});
