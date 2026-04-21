/**
 * bird-weather-chip.js — global <weather-chip> component + range cache
 *
 * Must be loaded AFTER bird-vue-core.js.
 *
 * Two pieces:
 *   1. BIRDASH.weatherCache — Map<"date|hour", snapshot>, populated via
 *      BIRDASH.loadWeatherRange(from, to). 5-minute TTL per range key so
 *      live-refresh pages don't hammer the endpoint.
 *   2. <weather-chip :date="..." :time="..." :detailed="false" /> — looks
 *      up its snapshot in the cache, renders a compact icon+temp by default.
 *      Pass :detailed="true" to also show precip + wind when meaningful.
 *      Renders nothing if the lookup misses (silent degradation).
 */
(function (Vue, BIRDASH) {
  'use strict';
  const { computed } = Vue;
  const { useI18n } = BIRDASH;

  // ── Cache ──────────────────────────────────────────────────────────────────
  // weatherCache: keyed by "YYYY-MM-DD|H" (hour as integer 0-23, no padding)
  const weatherCache = new Map();
  // rangeFetchedAt: keyed by "from|to", value = timestamp ms — for TTL
  const rangeFetchedAt = new Map();
  const RANGE_TTL_MS = 5 * 60 * 1000;
  const inFlight = new Map();  // dedupe parallel requests for the same range

  async function loadWeatherRange(from, to) {
    if (!from) return;
    if (!to) to = from;
    const key = `${from}|${to}`;
    const now = Date.now();
    const last = rangeFetchedAt.get(key) || 0;
    if (now - last < RANGE_TTL_MS) return;
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = (async () => {
      try {
        const res = await fetch(`/birds/api/weather/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data && Array.isArray(data.snapshots)) {
          for (const s of data.snapshots) {
            weatherCache.set(`${s.date}|${s.hour}`, s);
          }
          rangeFetchedAt.set(key, Date.now());
        }
      } catch { /* silent — chips just won't render */ }
      finally { inFlight.delete(key); }
    })();
    inFlight.set(key, promise);
    return promise;
  }

  function lookup(date, time) {
    if (!date || !time) return null;
    const hour = parseInt(String(time).split(':')[0], 10);
    if (isNaN(hour)) return null;
    return weatherCache.get(`${date}|${hour}`) || null;
  }

  // ── Icon + label mapping (WMO codes via Open-Meteo) ────────────────────────
  function wmoIcon(code) {
    if (code == null) return 'cloud';
    if (code === 0) return 'sun';
    if (code <= 2) return 'cloud-sun';
    if (code === 3) return 'cloud';
    if (code <= 48) return 'cloud';
    if (code <= 67 || (code >= 80 && code <= 82) || code >= 95) return 'cloud-rain';
    if (code >= 71 && code <= 86) return 'snowflake';
    return 'cloud';
  }

  // ── Component ──────────────────────────────────────────────────────────────
  const WeatherChip = {
    props: {
      date:     { type: String, default: '' },
      time:     { type: String, default: '' },
      detailed: { type: Boolean, default: false },
    },
    setup(props) {
      const { t } = useI18n();
      // Recompute lookup whenever date/time change. The cache itself isn't
      // reactive; pages call loadWeatherRange before rendering, so by render
      // time the snapshot is in the Map. Live-refresh pages re-call
      // loadWeatherRange and the chip will pick up the new entry on its
      // next render tick (props change or parent re-render).
      const snap = computed(() => lookup(props.date, props.time));
      function wmoLabel(code) {
        if (code == null) return '';
        if (code === 0) return t('weather_clear');
        if (code <= 2) return t('weather_partly_cloudy');
        if (code === 3) return t('weather_cloudy');
        if (code <= 48) return t('weather_fog');
        if (code <= 57) return t('weather_drizzle');
        if (code <= 67) return t('weather_rain');
        if (code <= 77) return t('weather_snow');
        if (code <= 82) return t('weather_rain');
        if (code <= 86) return t('weather_snow');
        return t('weather_storm');
      }
      return { snap, wmoIcon, wmoLabel };
    },
    template: `
<span v-if="snap" class="weather-chip" :title="wmoLabel(snap.weather_code)">
  <bird-icon :name="wmoIcon(snap.weather_code)" :size="13"></bird-icon>
  <span v-if="snap.temp_c != null">{{Math.round(snap.temp_c)}}°C</span>
  <template v-if="detailed">
    <span v-if="snap.precip_mm > 0" class="weather-precip">
      <bird-icon name="cloud-rain" :size="11"></bird-icon>{{snap.precip_mm.toFixed(1)}}mm
    </span>
    <span v-if="snap.wind_kmh != null && snap.wind_kmh >= 5" class="weather-wind">
      <bird-icon name="wind" :size="11"></bird-icon>{{Math.round(snap.wind_kmh)}}km/h
    </span>
  </template>
</span>`,
  };

  // ── Register ──────────────────────────────────────────────────────────────
  BIRDASH.weatherCache = weatherCache;
  BIRDASH.loadWeatherRange = loadWeatherRange;
  BIRDASH.WeatherChip = WeatherChip;

  // Patch registerComponents so any app.use() picks up the chip too. Pages
  // that already called registerComponents before this script loaded need
  // to register manually — but in practice this script loads before the
  // app is created (it sits next to bird-spectro-modal.js in the head).
  const _origRegister = BIRDASH.registerComponents;
  if (_origRegister) {
    BIRDASH.registerComponents = function (app) {
      const ret = _origRegister(app);
      app.component('weather-chip', WeatherChip);
      // Original returns the app for chaining (.mount), preserve that.
      return ret || app;
    };
  }
})(window.Vue, window.BIRDASH);
