// Flat ESLint config for birdash (v9+).
// Goal: catch real bugs (undefined vars, unreachable code, syntax slips)
// without bikeshedding on style. Style stays where the team wants it.

const js = require('@eslint/js');

const NODE_GLOBALS = {
  __dirname: 'readonly', __filename: 'readonly',
  Buffer: 'readonly', console: 'readonly',
  process: 'readonly', global: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly',
  setImmediate: 'readonly', clearImmediate: 'readonly',
  module: 'readonly', require: 'readonly', exports: 'writable',
  URL: 'readonly', URLSearchParams: 'readonly', fetch: 'readonly',
  AbortController: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
  structuredClone: 'readonly', performance: 'readonly',
};

const BROWSER_GLOBALS = {
  window: 'readonly', document: 'readonly', navigator: 'readonly',
  location: 'readonly', history: 'readonly', screen: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly',
  fetch: 'readonly', XMLHttpRequest: 'readonly',
  console: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  getComputedStyle: 'readonly', structuredClone: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', FormData: 'readonly',
  Blob: 'readonly', File: 'readonly', FileReader: 'readonly',
  AbortController: 'readonly', EventSource: 'readonly', WebSocket: 'readonly',
  AudioContext: 'readonly', webkitAudioContext: 'readonly',
  Audio: 'readonly', Image: 'readonly',
  CustomEvent: 'readonly', Event: 'readonly', MouseEvent: 'readonly',
  HTMLElement: 'readonly', HTMLImageElement: 'readonly', HTMLCanvasElement: 'readonly',
  Element: 'readonly', Node: 'readonly', NodeList: 'readonly',
  DOMParser: 'readonly', XMLSerializer: 'readonly',
  performance: 'readonly', crypto: 'readonly',
  // Project + vendored libraries.
  // BIRD_CONFIG is declared in public/js/bird-config.js (covered by the
  // hybrid block below where 'no-redeclare' is disabled) and consumed
  // everywhere else as a global readonly.
  Vue: 'readonly', BIRDASH: 'readonly', BIRD_CONFIG: 'readonly',
  Chart: 'readonly', echarts: 'readonly', L: 'readonly',
  DOMPurify: 'readonly',
};

const COMMON_RULES = {
  // Real bugs
  'no-undef': 'error',
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  // Allow `while ((m = regex.exec(...)))` and similar — wrap in parens
  'no-cond-assign': ['error', 'except-parens'],
  'no-self-assign': 'error',
  'no-self-compare': 'error',
  'no-misleading-character-class': 'error',
  // Useful but warn-only — codebase has prior history we don't want to block on
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-prototype-builtins': 'off',
  'no-constant-condition': ['warn', { checkLoops: false }],
  // Off — too noisy or stylistic
  'no-control-regex': 'off',
  'no-useless-escape': 'off',
  // ES2025 rule, not enabled by default but we have to opt out for codebase
  // that throws bare new Error in catch blocks. Revisit when migrating to ES2025.
  'preserve-caught-error': 'off',
};

module.exports = [
  js.configs.recommended,

  // Server (CommonJS, Node) + tests (.test.js + .spec.js).
  // Tests pass arrow functions to Playwright's `page.evaluate` whose body
  // runs in the BROWSER, so we permit both global sets in tests/.
  {
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: NODE_GLOBALS,
    },
    rules: COMMON_RULES,
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS },
    },
    rules: COMMON_RULES,
  },

  // Scripts (ESM .mjs + CommonJS .js).
  // Many of these scripts drive Playwright and pass arrow functions to
  // page.evaluate() / page.locator().evaluate() — the body of those
  // closures runs in the BROWSER, not Node, so we permit both global
  // sets here. The duplication is benign: a typo on a Node-only API will
  // still fire elsewhere, and adding a browser global doesn't make Node
  // code incorrect.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS },
    },
    rules: {
      ...COMMON_RULES,
      'no-fallthrough': ['warn', { commentPattern: 'falls?\\s?through|process\\.exit' }],
    },
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS },
    },
    rules: {
      ...COMMON_RULES,
      'no-fallthrough': ['warn', { commentPattern: 'falls?\\s?through|process\\.exit' }],
    },
  },

  // Public/JS (browser globals + Vue)
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: BROWSER_GLOBALS,
    },
    rules: {
      ...COMMON_RULES,
      // Browser code uses lots of cherry-picked utilities; quiet the noise.
      'no-unused-vars': 'off',
    },
  },

  // Service worker
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        self: 'readonly', caches: 'readonly', fetch: 'readonly',
        Response: 'readonly', Request: 'readonly',
        URL: 'readonly', Promise: 'readonly', console: 'readonly',
      },
    },
    rules: COMMON_RULES,
  },

  // Root-level Node configs (playwright, etc.)
  {
    files: ['*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: NODE_GLOBALS,
    },
    rules: COMMON_RULES,
  },

  // Browser-side config + local overrides served as <script>.
  // birdash-local.js is hybrid: it's loaded as <script> in the browser,
  // but it also reads `process.env` and exports via `module.exports` so
  // the same file is requirable from Node tooling. Both global sets apply.
  {
    files: ['config/birdash-local*.js', 'public/js/birdash-local.js', 'public/js/bird-config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...BROWSER_GLOBALS, ...NODE_GLOBALS, BIRDASH_LOCAL: 'readonly' },
    },
    rules: {
      ...COMMON_RULES,
      'no-unused-vars': 'off',
      // bird-config.js declares BIRD_CONFIG; that's the source of truth.
      'no-redeclare': 'off',
    },
  },

  // Ignored — vendored libraries, generated, transient, out-of-scope
  {
    ignores: [
      'public/js/vue.global.prod.min.js',
      'public/js/chart.umd.min.js',
      'public/js/echarts.min.js',
      'node_modules/**',
      'data/**',
      'public-next/**',
      'shots-test/**',
      'test-results/**',
      'engine/**',                  // Python — out of scope
      'scripts/migrations/**',      // SQL fragments
      'scripts/screenshots/**',     // generated screenshots
      'scripts/__pycache__/**',
      '.claude/**',                  // claude session worktrees
    ],
  },
];
