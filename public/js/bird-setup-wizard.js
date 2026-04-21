/**
 * bird-setup-wizard.js — first-run setup wizard modal
 *
 * Loads after bird-vue-core.js. Exposes:
 *   BIRDASH.SetupWizard      — Vue component
 *   BIRDASH.openSetupWizard()— manual trigger (called by Settings button)
 *   BIRDASH.checkSetupStatus()— returns Promise<{needed, …}> from /api/setup/status
 *
 * Phase 1 surface: Welcome → Location → Recap. P2 adds Audio + Model,
 * P3 adds Filters + Integrations + first-launch auto-trigger.
 *
 * The wizard state lives in a single reactive object exposed on BIRDASH
 * so any page that includes `<setup-wizard>` shares the same instance —
 * makes the "redo wizard" button work from any page.
 */
(function (Vue, BIRDASH) {
  'use strict';
  const { reactive, ref, computed, onMounted } = Vue;
  const { useI18n } = BIRDASH;

  // ── Global wizard state (single instance shared across pages) ──────────
  const state = reactive({
    open: false,
    step: 0,
    hardware: null,
    loading: false,
    applying: false,
    results: null,
    errors: [],
    // Accumulated user choices — defaults populated when we open the
    // wizard (so reopening starts fresh from current config).
    choices: {
      location:     { latitude: null, longitude: null },
      audio:        { device_id: '', device_name: '' },
      model:        { primary: '', secondary: null, dual: false },
      filters:      { privacy: true, dog: false },
      integrations: { birdweather_station_id: '', apprise_urls: [] },
    },
  });

  // Steps registered in P1 only; P2/P3 will splice in audio/model/etc.
  // Each step has: key (for i18n), required (cannot skip).
  const STEPS = [
    { key: 'welcome',  required: false },
    { key: 'location', required: true  },
    { key: 'recap',    required: false },
  ];

  // ── API helpers ────────────────────────────────────────────────────────
  async function checkSetupStatus() {
    try {
      const r = await fetch('/birds/api/setup/status');
      if (!r.ok) return { needed: false };
      return await r.json();
    } catch { return { needed: false }; }
  }

  async function loadHardware() {
    state.loading = true;
    try {
      const r = await fetch('/birds/api/setup/hardware-profile');
      if (r.ok) state.hardware = await r.json();
    } catch { state.hardware = null; }
    state.loading = false;
  }

  // Pre-populate location from BirdNET config so re-runs show current
  // values instead of empty fields.
  async function preloadCurrentConfig() {
    try {
      const r = await fetch('/birds/api/settings');
      if (!r.ok) return;
      const conf = await r.json();
      const lat = parseFloat(conf.LATITUDE || conf.latitude || '0');
      const lon = parseFloat(conf.LONGITUDE || conf.longitude || '0');
      if (!isNaN(lat) && !isNaN(lon) && (lat !== 0 || lon !== 0)) {
        state.choices.location.latitude = lat;
        state.choices.location.longitude = lon;
      }
    } catch {}
  }

  async function applyChoices() {
    state.applying = true;
    state.results = null;
    state.errors = [];
    try {
      const r = await fetch('/birds/api/setup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.choices),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        state.errors.push(data.message || data.error || 'apply_failed');
      } else {
        state.results = data.results;
      }
    } catch (e) {
      state.errors.push(e.message || 'network_error');
    }
    state.applying = false;
  }

  // ── Public API ─────────────────────────────────────────────────────────
  async function openSetupWizard() {
    state.step = 0;
    state.results = null;
    state.errors = [];
    state.open = true;
    // Load hardware + current config in parallel; wizard renders the
    // welcome step immediately and the data lands by the time the user
    // clicks "Next".
    await Promise.all([loadHardware(), preloadCurrentConfig()]);
  }

  function closeWizard(force = false) {
    if (!force && state.applying) return;
    state.open = false;
    // Suppress auto-reopen for the rest of this browser session. Cleared
    // on tab close. Manual reopen via openSetupWizard() always works.
    try { sessionStorage.setItem('birdash_wizard_dismissed', '1'); } catch {}
  }

  function nextStep() {
    if (state.step < STEPS.length - 1) state.step++;
  }
  function prevStep() {
    if (state.step > 0) state.step--;
  }

  // ── Component ──────────────────────────────────────────────────────────
  const SetupWizard = {
    setup() {
      const { t } = useI18n();

      const currentStep = computed(() => STEPS[state.step] || STEPS[0]);
      const isFirst = computed(() => state.step === 0);
      const isLast = computed(() => state.step === STEPS.length - 1);
      const stepNum = computed(() => state.step + 1);
      const totalSteps = computed(() => STEPS.length);

      // Validation per step — disables Next when the step has
      // a required field that's not yet filled.
      const canAdvance = computed(() => {
        const k = currentStep.value.key;
        if (k === 'location') {
          const lat = state.choices.location.latitude;
          const lon = state.choices.location.longitude;
          return typeof lat === 'number' && typeof lon === 'number'
              && !isNaN(lat) && !isNaN(lon)
              && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
              && (lat !== 0 || lon !== 0);
        }
        return true;
      });

      // Hardware summary used in welcome + recap steps for context.
      const hwSummary = computed(() => {
        const hw = state.hardware;
        if (!hw) return null;
        return {
          piModel: hw.pi?.model || '?',
          ram: hw.ram?.gb ? `${hw.ram.gb} GB RAM` : '',
          audio: hw.audio?.devices?.[0]?.desc || (hw.audio?.devices?.length ? hw.audio.devices[0].name : t('setup_no_audio_detected')),
          internet: hw.internet ? t('setup_online') : t('setup_offline'),
        };
      });

      // Recap building blocks — show only what the user actually configured.
      const recapItems = computed(() => {
        const items = [];
        const c = state.choices;
        if (typeof c.location.latitude === 'number') {
          items.push({
            key: 'location',
            label: t('setup_step_location'),
            value: `${c.location.latitude.toFixed(4)}, ${c.location.longitude.toFixed(4)}`,
          });
        }
        return items;
      });

      async function onApply() {
        await applyChoices();
        // If apply succeeded, jump to the final "done" view; the user
        // closes manually when they've read the results.
      }

      function tryClose() {
        if (state.applying) return;
        if (state.results) { closeWizard(true); return; }
        // Confirm if the user has filled anything but not applied
        const hasInput = typeof state.choices.location.latitude === 'number';
        if (hasInput && !confirm(t('setup_confirm_close'))) return;
        closeWizard();
      }

      return {
        state, t, currentStep, isFirst, isLast, stepNum, totalSteps,
        canAdvance, hwSummary, recapItems,
        nextStep, prevStep, onApply, tryClose,
      };
    },
    template: `
<div v-if="state.open" class="sw-overlay" @click.self="tryClose" role="dialog" aria-modal="true">
  <div class="sw-modal">
    <header class="sw-header">
      <div>
        <div class="sw-title">{{t('setup_title')}}</div>
        <div class="sw-step-label">{{t('setup_step_' + currentStep.key)}}</div>
      </div>
      <button class="sw-close" @click="tryClose" :aria-label="t('close')">×</button>
    </header>

    <div class="sw-progress">
      <div class="sw-progress-bar" :style="{width: (stepNum / totalSteps * 100) + '%'}"></div>
      <div class="sw-progress-text">{{stepNum}} / {{totalSteps}}</div>
    </div>

    <main class="sw-body">
      <!-- ── Welcome ─────────────────────────────────────────── -->
      <section v-if="currentStep.key === 'welcome'">
        <h2 class="sw-h2">{{t('setup_welcome_title')}}</h2>
        <p class="sw-p">{{t('setup_welcome_intro')}}</p>
        <ul class="sw-list">
          <li>{{t('setup_welcome_will_set_location')}}</li>
          <li>{{t('setup_welcome_will_set_audio')}}</li>
          <li>{{t('setup_welcome_will_set_model')}}</li>
          <li>{{t('setup_welcome_will_set_filters')}}</li>
          <li>{{t('setup_welcome_will_set_integrations')}}</li>
        </ul>
        <div v-if="state.loading" class="sw-loading">
          <span class="spinner-inline"><i></i><i></i><i></i></span>
          {{t('setup_detecting_hardware')}}
        </div>
        <div v-else-if="hwSummary" class="sw-hw-card">
          <div class="sw-hw-title">{{t('setup_detected_hardware')}}</div>
          <div class="sw-hw-row"><span class="sw-hw-lbl">{{t('setup_hw_pi')}}</span><span>{{hwSummary.piModel}} · {{hwSummary.ram}}</span></div>
          <div class="sw-hw-row"><span class="sw-hw-lbl">{{t('setup_hw_audio')}}</span><span>{{hwSummary.audio}}</span></div>
          <div class="sw-hw-row"><span class="sw-hw-lbl">{{t('setup_hw_internet')}}</span><span>{{hwSummary.internet}}</span></div>
        </div>
      </section>

      <!-- ── Location ────────────────────────────────────────── -->
      <section v-else-if="currentStep.key === 'location'">
        <h2 class="sw-h2">{{t('setup_step_location')}}</h2>
        <p class="sw-p">{{t('setup_location_desc')}}</p>
        <details class="sw-why">
          <summary>{{t('setup_why_this_matters')}}</summary>
          <p>{{t('setup_location_why')}}</p>
        </details>
        <div class="sw-form-row">
          <label>{{t('setup_latitude')}}
            <input type="number" v-model.number="state.choices.location.latitude"
                   step="0.0001" min="-90" max="90" placeholder="50.85">
          </label>
          <label>{{t('setup_longitude')}}
            <input type="number" v-model.number="state.choices.location.longitude"
                   step="0.0001" min="-180" max="180" placeholder="4.35">
          </label>
        </div>
        <div class="sw-hint">{{t('setup_location_hint')}}</div>
      </section>

      <!-- ── Recap ───────────────────────────────────────────── -->
      <section v-else-if="currentStep.key === 'recap'">
        <h2 class="sw-h2">{{t('setup_recap_title')}}</h2>
        <p v-if="!state.results && !state.errors.length" class="sw-p">{{t('setup_recap_intro')}}</p>
        <div v-if="recapItems.length" class="sw-recap-list">
          <div v-for="r in recapItems" :key="r.key" class="sw-recap-row">
            <span class="sw-recap-lbl">{{r.label}}</span>
            <span class="sw-recap-val">{{r.value}}</span>
          </div>
        </div>
        <div v-if="state.applying" class="sw-loading">
          <span class="spinner-inline"><i></i><i></i><i></i></span>
          {{t('setup_applying')}}
        </div>
        <div v-if="state.results" class="sw-results">
          <div class="sw-results-title">{{t('setup_done_title')}}</div>
          <ul>
            <li v-for="(v, k) in state.results" :key="k">
              <strong>{{k}}</strong>: {{v}}
            </li>
          </ul>
          <p class="sw-p">{{t('setup_done_restart_hint')}}</p>
        </div>
        <div v-if="state.errors.length" class="sw-errors">
          <div class="sw-errors-title">{{t('setup_apply_errors')}}</div>
          <ul><li v-for="(e, i) in state.errors" :key="i">{{e}}</li></ul>
        </div>
      </section>
    </main>

    <footer class="sw-footer">
      <button v-if="!state.results" class="sw-btn sw-btn-ghost" @click="prevStep" :disabled="isFirst || state.applying">
        ← {{t('setup_back')}}
      </button>
      <span class="sw-spacer"></span>
      <button v-if="state.results" class="sw-btn sw-btn-primary" @click="tryClose">
        {{t('close')}}
      </button>
      <button v-else-if="!isLast" class="sw-btn sw-btn-primary" @click="nextStep" :disabled="!canAdvance">
        {{t('setup_next')}} →
      </button>
      <button v-else class="sw-btn sw-btn-primary" @click="onApply" :disabled="state.applying">
        {{state.applying ? t('setup_applying') : t('setup_apply')}}
      </button>
    </footer>
  </div>
</div>`,
  };

  // ── Register ──────────────────────────────────────────────────────────
  BIRDASH.SetupWizard = SetupWizard;
  BIRDASH.openSetupWizard = openSetupWizard;
  BIRDASH.checkSetupStatus = checkSetupStatus;
  BIRDASH._setupWizardState = state;

  // Patch registerComponents so app.use() picks up <setup-wizard>.
  const _origRegister = BIRDASH.registerComponents;
  if (_origRegister) {
    BIRDASH.registerComponents = function (app) {
      const ret = _origRegister(app);
      app.component('setup-wizard', SetupWizard);
      return ret || app;
    };
  }
})(window.Vue, window.BIRDASH);
