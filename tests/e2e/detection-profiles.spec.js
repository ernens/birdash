// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = (process.env.BIRDASH_URL || 'http://192.168.2.217') + '/birds';

// API: list ships builtins, save+delete custom profile, builtin is protected.
test('detection-profiles API: list returns 3 builtins', async ({ request }) => {
  const resp = await request.get(`${BASE}/api/detection-profiles`);
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  expect(data.profiles).toBeDefined();
  for (const id of ['permissif', 'balance', 'rigoureux']) {
    expect(data.profiles[id], `builtin ${id} present`).toBeDefined();
    expect(data.profiles[id].builtin).toBe(true);
    expect(data.profiles[id].values.BIRDNET_CONFIDENCE).toBeGreaterThan(0);
  }
});

test('detection-profiles API: save + apply + delete a custom profile', async ({ request }) => {
  const id = 'e2etest_' + Date.now();
  const create = await request.post(`${BASE}/api/detection-profiles`, {
    data: {
      id,
      label: 'E2E test ' + id,
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
  expect(create.ok(), 'create returns 2xx').toBeTruthy();
  const createData = await create.json();
  expect(createData.profile.builtin).toBe(false);

  const apply = await request.post(`${BASE}/api/detection-profiles/apply`, { data: { id } });
  expect(apply.ok()).toBeTruthy();
  const applyData = await apply.json();
  expect(applyData.active).toBe(id);
  expect(applyData.values.BIRDNET_CONFIDENCE).toBe(0.55);

  const del = await request.delete(`${BASE}/api/detection-profiles/${id}`);
  expect(del.ok()).toBeTruthy();

  const list = await request.get(`${BASE}/api/detection-profiles`);
  const listData = await list.json();
  expect(listData.profiles[id]).toBeUndefined();
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
      values: { BIRDNET_CONFIDENCE: 999 },
    },
  });
  expect(resp.status()).toBe(400);
});

// UI: load a builtin profile fills the BirdNET confidence slider.
test('settings page: loading "Rigoureux" updates the BirdNET confidence input', async ({ page }) => {
  await page.goto('/birds/settings.html', { waitUntil: 'networkidle', timeout: 45000 });
  // Detection tab is the default tab on settings.html. Wait for the
  // profile bar (lazy-loaded partial).
  const select = page.locator('[data-test="profile-select"]');
  await select.waitFor({ state: 'visible', timeout: 15000 });
  await select.selectOption('rigoureux');
  await page.locator('[data-test="profile-load"]').click();
  // BIRDNET_CONFIDENCE for "rigoureux" is 0.80 in the seed file.
  const slider = page.locator('input[type="range"]').filter({ hasText: '' }).first();
  // Read the value via the value displayed beside the slider.
  await expect(page.locator('text=0.8').first()).toBeVisible({ timeout: 5000 });
});
