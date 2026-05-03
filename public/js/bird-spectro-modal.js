/**
 * bird-spectro-modal.js — SpectroModal component (extracted from bird-vue-core.js)
 *
 * Must be loaded AFTER bird-vue-core.js.
 * Reads: window.BIRDASH (useI18n, _spectroModal, closeSpectroModal)
 *        window.BIRDASH_UTILS (renderSpectrogram, buildAudioUrl)
 *        window.Vue (ref, computed, watch, onUnmounted, nextTick)
 */
(function(Vue, BIRDASH, U) {
  'use strict';
  const { ref, computed, watch, onUnmounted, nextTick } = Vue;
  const { useI18n } = BIRDASH;
  const _spectroModal = BIRDASH._spectroModal;
  let _spectroFocusTrap = null;
  function closeSpectroModal() { BIRDASH.closeSpectroModal(); }

  // ── Composant SpectroModal ──────────────────────────────────────────────
  // Full-screen spectrogram modal with audio playback, filters, and progress.
  // Opened via BIRDASH.openSpectroModal({ fileName, speciesName, ... })
  const SpectroModal = {
    setup() {
      const { t } = useI18n();
      const modal = _spectroModal;
      const loading = ref(false);
      const isPlaying = ref(false);
      const progress = ref(0);
      const currentTime = ref('0:00');
      const duration = ref('0:00');
      const filters = Vue.reactive({ gain: 0, highpass: 0, lowpass: 0 });
      const gainOpts = [0, 5, 10, 15, 20];
      const hpOpts = [0, 200, 500, 1000, 2000];
      const lpOpts = [0, 3000, 6000, 9000, 12000];

      const canvas = ref(null);
      let audioCtx = null;
      let sourceNode = null;
      let gainNode = null;
      let hpNode = null;
      let lpNode = null;
      let audioBuf = null;
      let startedAt = 0;
      let pausedAt = 0;
      let rafId = null;
      let pcmData = null;
      let sampleRate = 0;

      // Clean (denoise) state — mirrors today.html. _rawPcm/_rawSr/_rawAudioBuf
      // keep the untouched signal so the user can switch back without re-fetching.
      const cleanMode = ref(false);
      const cleanStrength = ref(0.75);
      const processingClean = ref(false);
      let _rawPcm = null;
      let _rawSr = 0;
      let _rawAudioBuf = null;

      // Bbox overlay toggle (Phase 1B) — pref persisted globally via localStorage.
      // Switching off re-renders the spectro without the bbox; switching on
      // re-renders, then re-paints the bbox over the fresh pixels.
      const bboxEnabled = ref(U.getBboxOverlayEnabled());
      function toggleBbox() {
        bboxEnabled.value = !bboxEnabled.value;
        U.setBboxOverlayEnabled(bboxEnabled.value);
        if (!canvas.value || !pcmData) return;
        // Re-render the current pcmData (which is already cleaned if cleanMode is on)
        // then re-paint or skip the bbox.
        U.renderSpectrogram(pcmData, sampleRate, canvas.value, { fftSize: 1024, maxHz: 12000 });
        if (bboxEnabled.value) {
          U.showBboxForFile(canvas.value, modal.fileName, { duration: audioBuf?.duration, maxHz: 12000 });
        } else {
          U.attachBboxOverlay(canvas.value, null);
        }
      }

      // Loop selection
      const loopStart = ref(null); // 0-1 fraction
      const loopEnd = ref(null);
      const loopActive = ref(false);
      let _dragging = false;
      let _dragStart = 0;

      const audioUrl = computed(() => modal.fileName ? U.buildAudioUrl(modal.fileName) : '');
      const downloadName = computed(() => modal.fileName || 'audio.wav');

      // Weather chip — fetched once per modal open from the hourly snapshot
      // populated by the weather-watcher background poller.
      const weather = Vue.ref(null);
      // WMO weather code → (icon, i18n key) mapping. Codes via Open-Meteo.
      function wmoIcon(code) {
        if (code == null) return 'cloud';
        if (code === 0) return 'sun';
        if (code <= 2) return 'cloud-sun';
        if (code === 3) return 'cloud';
        if (code <= 48) return 'cloud';                // fog
        if (code <= 67 || (code >= 80 && code <= 82) || code >= 95) return 'cloud-rain';
        if (code >= 71 && code <= 86) return 'snowflake';
        return 'cloud';
      }
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
      async function loadWeather() {
        weather.value = null;
        if (!modal.date || !modal.time) return;
        try {
          const res = await fetch(`/birds/api/weather/at?date=${encodeURIComponent(modal.date)}&time=${encodeURIComponent(modal.time)}`);
          if (res.ok) weather.value = await res.json();
        } catch { /* silent — chip just won't render */ }
      }

      function fmtSec(s) {
        if (!s || !isFinite(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return m + ':' + String(sec).padStart(2, '0');
      }

      async function loadAudio() {
        if (!modal.fileName) return;
        const url = audioUrl.value;
        if (!url) return;
        loading.value = true;
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const arrBuf = await resp.arrayBuffer();
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          audioBuf = await ctx.decodeAudioData(arrBuf);
          sampleRate = audioBuf.sampleRate;
          pcmData = audioBuf.getChannelData(0);
          duration.value = fmtSec(audioBuf.duration);
          await ctx.close();
          // Snapshot the raw signal so toggleClean() can revert without
          // re-fetching from the server.
          _rawPcm = pcmData;
          _rawSr = sampleRate;
          _rawAudioBuf = audioBuf;
          // Render spectrogram
          if (canvas.value) {
            U.renderSpectrogram(pcmData, sampleRate, canvas.value, { fftSize: 1024, maxHz: 12000 });
            U.showBboxForFile(canvas.value, modal.fileName, { duration: audioBuf.duration, maxHz: 12000 });
          }
        } catch (e) {
          console.warn('SpectroModal: load error', e);
        }
        loading.value = false;
      }

      function buildFilterChain() {
        if (!audioCtx) return;
        // Disconnect old nodes
        if (hpNode) try { hpNode.disconnect(); } catch(e) {}
        if (lpNode) try { lpNode.disconnect(); } catch(e) {}
        if (gainNode) try { gainNode.disconnect(); } catch(e) {}

        gainNode = audioCtx.createGain();
        gainNode.gain.value = Math.pow(10, filters.gain / 20);

        hpNode = audioCtx.createBiquadFilter();
        hpNode.type = 'highpass';
        hpNode.frequency.value = filters.highpass || 0;

        lpNode = audioCtx.createBiquadFilter();
        lpNode.type = 'lowpass';
        lpNode.frequency.value = filters.lowpass || audioCtx.sampleRate / 2;

        // Chain: source -> hp -> lp -> gain -> destination
        if (sourceNode) {
          sourceNode.disconnect();
          sourceNode.connect(hpNode);
        }
        hpNode.connect(lpNode);
        lpNode.connect(gainNode);
        gainNode.connect(audioCtx.destination);
      }

      function togglePlay() {
        if (isPlaying.value) {
          stopPlay();
        } else {
          startPlay();
        }
      }

      function startPlay() {
        if (!audioBuf) return;
        if (!audioCtx || audioCtx.state === 'closed') {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = audioBuf;
        sourceNode.loop = loopActive.value;
        if (loopActive.value && loopStart.value != null && loopEnd.value != null) {
          sourceNode.loopStart = loopStart.value * audioBuf.duration;
          sourceNode.loopEnd = loopEnd.value * audioBuf.duration;
        }
        buildFilterChain();
        sourceNode.connect(hpNode);

        let offset = pausedAt;
        if (loopActive.value && loopStart.value != null) {
          const ls = loopStart.value * audioBuf.duration;
          const le = loopEnd.value * audioBuf.duration;
          if (offset < ls || offset >= le) offset = ls;
        }
        sourceNode.start(0, offset);
        startedAt = audioCtx.currentTime - offset;
        isPlaying.value = true;

        sourceNode.onended = () => {
          if (isPlaying.value) {
            isPlaying.value = false;
            pausedAt = 0;
            progress.value = 0;
            currentTime.value = '0:00';
            cancelAnimationFrame(rafId);
          }
        };

        updateProgress();
      }

      function stopPlay() {
        if (sourceNode) {
          try { sourceNode.stop(); } catch(e) {}
          sourceNode = null;
        }
        if (audioCtx) {
          pausedAt = audioCtx.currentTime - startedAt;
        }
        isPlaying.value = false;
        cancelAnimationFrame(rafId);
      }

      function updateProgress() {
        if (!isPlaying.value || !audioCtx || !audioBuf) return;
        const elapsed = audioCtx.currentTime - startedAt;
        const dur = audioBuf.duration;
        progress.value = Math.min(100, (elapsed / dur) * 100);
        currentTime.value = fmtSec(elapsed);
        rafId = requestAnimationFrame(updateProgress);
      }

      function seek(e) {
        if (!audioBuf) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const seekTime = pct * audioBuf.duration;
        const wasPlaying = isPlaying.value;
        if (wasPlaying) {
          try { sourceNode.stop(); } catch(e2) {}
          sourceNode = null;
          isPlaying.value = false;
          cancelAnimationFrame(rafId);
        }
        pausedAt = seekTime;
        progress.value = pct * 100;
        currentTime.value = fmtSec(seekTime);
        if (wasPlaying) startPlay();
      }

      function setFilter(key, val) {
        filters[key] = val;
        if (isPlaying.value && audioCtx) {
          if (key === 'gain' && gainNode) {
            gainNode.gain.value = Math.pow(10, val / 20);
          } else if (key === 'highpass' && hpNode) {
            hpNode.frequency.value = val || 0;
          } else if (key === 'lowpass' && lpNode) {
            lpNode.frequency.value = val || audioCtx.sampleRate / 2;
          }
        }
      }

      // Loop selection via drag on canvas
      function onCanvasMousedown(e) {
        if (!audioBuf) return;
        const rect = e.currentTarget.getBoundingClientRect();
        _dragStart = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        _dragging = true;
        loopStart.value = _dragStart;
        loopEnd.value = _dragStart;
        loopActive.value = false;
      }

      function onCanvasMousemove(e) {
        if (!_dragging || !audioBuf) return;
        const rect = canvas.value.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        loopStart.value = Math.min(_dragStart, pos);
        loopEnd.value = Math.max(_dragStart, pos);
      }

      function onCanvasMouseup(e) {
        if (!_dragging) return;
        _dragging = false;
        if (loopEnd.value - loopStart.value < 0.02) {
          // Too small = click, treat as seek
          loopStart.value = null; loopEnd.value = null; loopActive.value = false;
          seek(e);
          return;
        }
        loopActive.value = true;
        // Restart playback in loop
        const wasPlaying = isPlaying.value;
        if (wasPlaying) stopPlay();
        pausedAt = loopStart.value * audioBuf.duration;
        if (wasPlaying) startPlay();
      }

      function clearLoop() {
        loopStart.value = null; loopEnd.value = null; loopActive.value = false;
        if (isPlaying.value && sourceNode) {
          sourceNode.loop = false;
        }
      }

      function close() {
      if (_spectroFocusTrap) { _spectroFocusTrap(); _spectroFocusTrap = null; }
        cleanup();
        closeSpectroModal();
      }

      function cleanup() {
        if (sourceNode) { try { sourceNode.stop(); } catch(e) {} sourceNode = null; }
        if (audioCtx && audioCtx.state !== 'closed') { audioCtx.close().catch(() => {}); }
        audioCtx = null; audioBuf = null; pcmData = null;
        _rawPcm = null; _rawSr = 0; _rawAudioBuf = null;
        cleanMode.value = false; processingClean.value = false;
        isPlaying.value = false;
        progress.value = 0;
        currentTime.value = '0:00';
        duration.value = '0:00';
        pausedAt = 0;
        filters.gain = 0; filters.highpass = 0; filters.lowpass = 0;
        loopStart.value = null; loopEnd.value = null; loopActive.value = false;
        cancelAnimationFrame(rafId);
      }

      // ── Audio cleaning (denoise) ─────────────────────────────────────────
      // Reuses U.cleanAudioPipeline (highpass + spectral subtraction) from
      // bird-shared.js. Builds a fresh AudioBuffer from the cleaned PCM so
      // playback uses the cleaned signal too — the existing filter chain
      // (gain/HP/LP) keeps working untouched on top of it.
      async function toggleClean() {
        if (!cleanMode.value) {
          cleanMode.value = true;
          await applyClean();
        } else {
          cleanMode.value = false;
          if (_rawPcm && canvas.value) {
            U.renderSpectrogram(_rawPcm, _rawSr, canvas.value, { fftSize: 1024, maxHz: 12000 });
            U.showBboxForFile(canvas.value, modal.fileName, { duration: audioBuf?.duration, maxHz: 12000 });
          }
          const wasPlaying = isPlaying.value;
          if (wasPlaying) stopPlay();
          if (_rawAudioBuf) { audioBuf = _rawAudioBuf; pcmData = _rawPcm; }
          if (wasPlaying) startPlay();
        }
      }

      async function applyClean() {
        if (!_rawPcm || !U.cleanAudioPipeline) { cleanMode.value = false; return; }
        processingClean.value = true;
        const wasPlaying = isPlaying.value;
        if (wasPlaying) stopPlay();
        try {
          // Yield so Vue can paint the spinner before the FFT-heavy pipeline runs.
          await new Promise(r => setTimeout(r, 30));
          const cleaned = U.cleanAudioPipeline(_rawPcm, _rawSr, cleanStrength.value);
          if (canvas.value) {
            U.renderSpectrogram(cleaned, _rawSr, canvas.value, { fftSize: 1024, maxHz: 12000 });
            U.showBboxForFile(canvas.value, modal.fileName, { duration: audioBuf?.duration, maxHz: 12000 });
          }
          // Build a new AudioBuffer so playback uses the cleaned signal.
          const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
          const newBuf = tmpCtx.createBuffer(1, cleaned.length, _rawSr);
          newBuf.copyToChannel(cleaned, 0);
          await tmpCtx.close();
          audioBuf = newBuf;
          pcmData = cleaned;
          if (wasPlaying) startPlay();
        } catch (e) {
          console.error('[spectro-modal clean]', e);
          cleanMode.value = false;
          if (_rawAudioBuf) { audioBuf = _rawAudioBuf; pcmData = _rawPcm; }
          if (wasPlaying) startPlay();
        } finally {
          processingClean.value = false;
        }
      }

      async function reapplyClean() {
        if (cleanMode.value) await applyClean();
      }

      function onKeydown(e) {
        if (!modal.open) return;
        if (e.key === 'Escape') { close(); e.preventDefault(); }
        if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
          togglePlay(); e.preventDefault();
        }
      }

      // Watch modal open state
      watch(() => modal.open, (val) => {
        if (val) {
          pausedAt = 0;
          nextTick(() => { loadAudio(); });
          loadWeather();
          document.addEventListener('keydown', onKeydown);
        } else {
          cleanup();
          weather.value = null;
          document.removeEventListener('keydown', onKeydown);
        }
      });

      onUnmounted(() => {
        cleanup();
        document.removeEventListener('keydown', onKeydown);
      });

      return {
        modal, loading, isPlaying, progress, currentTime, duration,
        filters, gainOpts, hpOpts, lpOpts,
        canvas, audioUrl, downloadName,
        loopStart, loopEnd, loopActive,
        weather, wmoIcon, wmoLabel,
        cleanMode, cleanStrength, processingClean,
        bboxEnabled, toggleBbox,
        togglePlay, seek, setFilter, close, t,
        onCanvasMousedown, onCanvasMousemove, onCanvasMouseup, clearLoop,
        toggleClean, reapplyClean
      };
    },
    template: `
<div v-if="modal.open" class="spectro-modal-overlay" @click.self="close" @keydown.escape="close" role="dialog" aria-modal="true" :aria-label="modal.speciesName">
  <div class="spectro-modal">
    <div class="spectro-modal-header">
      <div>
        <div class="spectro-modal-species">{{modal.speciesName}}</div>
        <div class="spectro-modal-sci">{{modal.sciName}}</div>
        <div class="spectro-modal-meta">
          <span v-if="modal.confidence" class="conf-badge" :class="modal.confidence>=0.8?'conf-high':'conf-mid'">
            {{Math.round(modal.confidence*100)}}%
          </span>
          <span v-if="modal.date">{{modal.date}}</span>
          <span v-if="modal.time">{{modal.time}}</span>
          <span v-if="weather" class="weather-chip" :title="wmoLabel(weather.weather_code)">
            <bird-icon :name="wmoIcon(weather.weather_code)" :size="14"></bird-icon>
            <span v-if="weather.temp_c != null">{{Math.round(weather.temp_c)}}°C</span>
            <span v-if="weather.precip_mm > 0" class="weather-precip">
              <bird-icon name="cloud-rain" :size="12"></bird-icon>{{weather.precip_mm.toFixed(1)}}mm
            </span>
            <span v-if="weather.wind_kmh != null && weather.wind_kmh >= 5" class="weather-wind">
              <bird-icon name="wind" :size="12"></bird-icon>{{Math.round(weather.wind_kmh)}}km/h
            </span>
          </span>
        </div>
      </div>
      <button class="spectro-modal-close" @click="close" aria-label="Close">&times;</button>
    </div>
    <div class="spectro-modal-canvas-wrap" style="position:relative;user-select:none;"
         @mousedown="onCanvasMousedown" @mousemove="onCanvasMousemove" @mouseup="onCanvasMouseup">
      <canvas ref="canvas" :width="800" :height="200"></canvas>
      <div v-if="loading || processingClean" class="spectro-modal-loading">{{processingClean ? t('audio_cleaning') : 'Loading...'}}</div>
      <div v-if="cleanMode && !processingClean"
           style="position:absolute;top:8px;left:10px;z-index:3;background:var(--success,#16a34a);
                  color:#fff;font-size:.7rem;font-weight:700;padding:.18rem .5rem;border-radius:3px;
                  letter-spacing:.06em;pointer-events:none;">
        ✨ CLEAN
      </div>
      <div v-if="isPlaying" class="spectro-cursor" :style="{left: progress+'%'}"></div>
      <div v-if="loopStart != null && loopEnd != null && loopEnd > loopStart"
           class="spectro-loop-zone"
           :style="{left: (loopStart*100)+'%', width: ((loopEnd-loopStart)*100)+'%'}"></div>
      <div class="spectro-freq-labels">
        <span>12kHz</span><span>9</span><span>6</span><span>3</span><span>0</span>
      </div>
    </div>
    <div class="spectro-modal-controls">
      <button class="play-big" :class="{playing: isPlaying}" @click="togglePlay" :aria-label="isPlaying ? 'Pause' : 'Play'">
        {{isPlaying ? '\u23F9' : '\u25B6'}}
      </button>
      <div class="audio-progress-wrap">
        <div class="audio-progress-bar" @click="seek">
          <div class="audio-progress-fill" :style="{width: progress+'%'}"></div>
        </div>
        <div class="audio-time">{{currentTime}} / {{duration}}</div>
      </div>
      <button v-if="loopActive" class="spectro-loop-btn" @click="clearLoop" title="Clear loop">🔁 ✕</button>
      <a :href="audioUrl" :download="downloadName" class="spectro-modal-dl" title="Download">\u2B07</a>
    </div>
    <div class="spectro-modal-filters">
      <div style="font-size:.72rem;color:var(--text-muted,#7a8a9e);margin-bottom:.4rem;padding:0 .2rem;">
        {{t('spectro_filters_hint')}}
      </div>
      <div class="spectro-modal-filter-group">
        <span class="rstb-flabel"><bird-icon name="volume-2" :size="12"></bird-icon> {{t('spectro_gain')}}</span>
        <div class="stb-pills">
          <button v-for="g in gainOpts" :key="g" class="stb-pill stb-pill-sm"
                  :class="{'stb-pill-active': filters.gain===g}"
                  @click="setFilter('gain',g)">{{g===0?'Off':'+'+g+'dB'}}</button>
        </div>
      </div>
      <div class="spectro-modal-filter-group">
        <span class="rstb-flabel"><bird-icon name="arrow-up" :size="12"></bird-icon> {{t('spectro_highpass')}}</span>
        <div class="stb-pills">
          <button v-for="h in hpOpts" :key="h" class="stb-pill stb-pill-sm"
                  :class="{'stb-pill-active': filters.highpass===h}"
                  @click="setFilter('highpass',h)">{{h===0?'Off':h>=1000?(h/1000)+'kHz':h+'Hz'}}</button>
        </div>
      </div>
      <div class="spectro-modal-filter-group">
        <span class="rstb-flabel"><bird-icon name="arrow-down" :size="12"></bird-icon> {{t('spectro_lowpass')}}</span>
        <div class="stb-pills">
          <button v-for="l in lpOpts" :key="l" class="stb-pill stb-pill-sm"
                  :class="{'stb-pill-active': filters.lowpass===l}"
                  @click="setFilter('lowpass',l)">{{l===0?'Off':l>=1000?(l/1000)+'kHz':l+'Hz'}}</button>
        </div>
      </div>
      <div class="spectro-modal-filter-group" style="border-top:1px solid var(--border);padding-top:.5rem;margin-top:.2rem;flex-wrap:wrap;gap:.5rem;">
        <button @click="toggleClean" :disabled="processingClean || loading"
                style="white-space:nowrap;padding:.3rem .8rem;border-radius:var(--radius);
                       font-size:.78rem;font-weight:600;border:1px solid;cursor:pointer;
                       transition:background .15s,color .15s;"
                :style="cleanMode
                  ? 'background:var(--accent);color:var(--on-accent);border-color:var(--accent);'
                  : 'background:transparent;color:var(--text-muted);border-color:var(--border);'">
          <span v-if="processingClean">⏳ {{t('audio_clean_progress')}}</span>
          <span v-else-if="cleanMode"><bird-icon name="sparkles" :size="14"></bird-icon> {{t('audio_clean_done')}}</span>
          <span v-else><bird-icon name="sliders-horizontal" :size="14"></bird-icon> {{t('audio_clean_btn')}}</span>
        </button>
        <template v-if="cleanMode && !processingClean">
          <span style="font-size:.72rem;color:var(--text-muted);align-self:center;white-space:nowrap;">Force</span>
          <input type="range" min="0.2" max="1.0" step="0.05" v-model.number="cleanStrength"
                 @change="reapplyClean" aria-label="Clean strength"
                 style="flex:1;min-width:100px;accent-color:var(--accent);">
          <span style="font-size:.72rem;font-family:monospace;color:var(--accent);min-width:38px;text-align:right;align-self:center;">
            {{Math.round(cleanStrength*100)}}%
          </span>
        </template>
        <button @click="toggleBbox" :title="t('bbox_toggle_title')"
                style="white-space:nowrap;padding:.3rem .6rem;border-radius:var(--radius);
                       font-size:.78rem;font-weight:600;border:1px solid;cursor:pointer;
                       margin-left:auto;transition:background .15s,color .15s;"
                :style="bboxEnabled
                  ? 'background:#fbbf24;color:#1f2937;border-color:#fbbf24;'
                  : 'background:transparent;color:var(--text-muted);border-color:var(--border);'">
          <bird-icon name="target" :size="14"></bird-icon>
          {{bboxEnabled ? t('bbox_on') : t('bbox_off')}}
        </button>
      </div>
    </div>
  </div>
</div>`
  };

  // Register on BIRDASH for registerComponents to pick up
  BIRDASH._SpectroModal = SpectroModal;

})(Vue, window.BIRDASH, window.BIRDASH_UTILS);
