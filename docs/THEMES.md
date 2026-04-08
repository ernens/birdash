# Theme system

Birdash ships **11 themes** built on a single design-token system in
[`public/css/bird-styles.css`](../public/css/bird-styles.css). This document
covers the architecture, the cascade tricks that keep it small, and how to
add a new theme.

## At a glance

| ID            | Mode  | Accent          | Notes                                |
|---------------|-------|-----------------|--------------------------------------|
| `auto`        | both  | emerald → teal  | Follows OS `prefers-color-scheme`    |
| `forest`      | dark  | emerald         | Default                              |
| `night`       | dark  | violet          |                                      |
| `paper`       | light | teal            |                                      |
| `ocean`       | dark  | cyan            |                                      |
| `dusk`        | dark  | rose            |                                      |
| `sepia`       | light | warm brown      | Reading-optimized parchment palette  |
| `solar-light` | light | Solarized teal  | Schoonover's Solarized Light         |
| `solar-dark`  | dark  | Solarized teal  | Schoonover's Solarized Dark          |
| `nord`        | dark  | Frost cyan      | Arctic Ice Studio Nord               |
| `hicontrast`  | dark  | saturated green | WCAG AAA target                      |

The active theme is set via `data-theme="..."` on `<html>` and persisted in
`localStorage` under the key `birdash_theme`. The picker is a Vue component
in `bird-vue-core.js`; the theme list itself is the `THEMES` array there.

## Token reference

All themes declare the same set of CSS custom properties. Code throughout
the app reads these — never raw hex values.

### Surfaces (per theme)

```
--bg-deep      darkest layer (header, scrim base)
--bg-page      page background
--bg-card      card / panel surface (= --surface-1)
--bg-card2     hovered / nested card surface (= --surface-2)
--bg-hover     interactive hover state (= --surface-3)
--bg-input     form field background
--border       neutral border
--border-light slightly lighter border for emphasis
```

The three `--surface-*` aliases are declared once at `:root` and resolve via
the cascade — they always follow the active theme's `--bg-*` values.

### Text (per theme)

```
--text-main   body text — required to clear WCAG AA on --bg-card
--text-muted  secondary text — also required to clear AA on --bg-card
--text-faint  decorative ONLY (placeholders, separators) — not body-safe
```

`--text-faint` does not need to clear AA. It's flagged in the source as
"decorative only" so reviewers don't reach for it for body text.

### Accent (per theme)

```
--accent       brand color
--accent-dim   slightly darker variant for hover/active states
--on-accent    foreground color for text/icons sitting on --accent
               (handpicked per theme — not derivable from accent alone)
```

### Accent-derived (computed once globally)

```
--accent-glow  color-mix(in srgb, var(--accent) 12%, transparent)
--focus-ring   color-mix(in srgb, var(--accent) 45%, transparent)
```

These are declared **once at `:root`** and re-evaluate per theme automatically
because CSS variables resolve at the use site (not the declaration site).
A new theme only needs to set `--accent`; the glow and focus ring follow.

### Semantic palette

```
--success  positive feedback (validation OK, healthy state)
--info     informational (neutral notices)
--warning  caution (review pending, slow)
--danger   error (failure, destructive action)
--amber    semantic amber for warnings/highlights
--blue     legacy alias of --info — kept for back-compat
```

`--amber` / `--amber-dim` / `--warning` are declared globally with dark-mode
defaults. **Light themes (paper, sepia, solar-light) override them locally**
because the dark-mode amber is too bright on a white background.

### Shadows & overlays (per theme)

```
--shadow         large card / modal shadow
--shadow-card    subtle resting card shadow
--overlay-scrim  modal/drawer backdrop
--overlay-line   subtle separator (e.g. dashed timeline lines)
```

Dark themes share `--overlay-line: rgba(255,255,255,.10)` via the dark-common
selector group. Light themes override it with a dark tint
(`rgba(28,25,23,.10)` etc.) so separators stay visible on white.

### Spectrogram & scrollbar

```
--bg-spectro       spectrogram canvas background — always dark, even in
                   light themes (the spectro is a dark visual surface)
--text-spectro     freq/time labels overlaid on the spectro
--scrollbar-thumb  custom scrollbar thumb
--scrollbar-track  custom scrollbar track
```

### Data-viz palette

Colors used by chart libraries, the phenology histogram, abundance gradients,
and any future data visualization. Defaults live at `:root` and target dark
themes; **light themes (paper, sepia, solar-light) override the saturated
ones** to avoid glare on white. Nord overrides them to its Aurora colors.

```
--data-night   --data-dawn   --data-day    --data-dusk
--data-abundance-0 ... --data-abundance-3   (low → high gradient)
--data-cat-1   ...   --data-cat-8           (categorical palette)
```

JS code reading these tokens does so via `var(--data-night)` in inline
`style` attributes — the browser re-resolves them on every paint, so a
theme switch instantly re-colors charts without any JS recompute.

## Cascade tricks worth knowing

### 1. `:root` and `[data-theme="..."]` have the same specificity

Both selectors have specificity (0,1,0). This is the single most important
thing to remember when editing this file:

> **When `:root` and a theme block declare the same property, source order
> wins, not specificity.**

That's why the file is structured as:

1. `:root { ... shared theme defaults ... }` ← defines fallbacks
2. `[data-theme="forest"], ...` ← theme blocks override defaults
3. `:root { ... font, radius, data-viz palette ... }` ← non-theme constants
4. Auto-light `@media` block ← must come AFTER both `:root` and theme blocks

If you add a new shared default to the first `:root` block, every theme can
override it. If you add it to the second `:root` block (or later), you've
locked it for everyone.

### 2. CSS variables resolve lazily (at use-site)

This is what makes `--accent-glow` work as a single global declaration:

```css
:root {
  --accent-glow: color-mix(in srgb, var(--accent) 12%, transparent);
}
```

When an element inside `[data-theme="paper"]` reads `--accent-glow`, the
browser resolves `var(--accent)` *on that element*, not on `:root`. So it
picks up paper's accent (`#0d9488`), not the default. One declaration
covers every present and future theme.

### 3. Selector grouping for shared subsets

Tokens that are identical across multiple themes live in a shared selector
group, not duplicated in each theme. The clearest example is the dark-common
group near the bottom of the theme section:

```css
[data-theme="forest"], [data-theme="night"], [data-theme="ocean"],
[data-theme="dusk"], [data-theme="auto"], [data-theme="hicontrast"],
[data-theme="solar-dark"], [data-theme="nord"] {
  --overlay-line: rgba(255,255,255,.10);
}
```

When you add a new dark theme, register it here so it inherits the dark
overlay line for free.

### 4. The `auto` theme

```css
:root, [data-theme="forest"], [data-theme="auto"] {
  /* forest tokens — auto inherits these as the dark default */
}

@media (prefers-color-scheme: light) {
  [data-theme="auto"] {
    /* paper tokens re-declared here — overrides the dark defaults */
  }
}
```

The `@media` block must come **after** the global `:root` data-viz palette,
otherwise the dark data colors leak into auto's light variant. Same cascade
gotcha as #1: equal specificity → source order wins.

## Adding a new theme

After phase 4 of the theme refactor, adding a new theme is roughly 30 lines:

1. **Declare the tokens** in `bird-styles.css`, after the existing themes:

   ```css
   [data-theme="my-theme"] {
     --bg-deep:      #...;
     --bg-page:      #...;
     --bg-card:      #...;
     --bg-card2:     #...;
     --bg-hover:     #...;
     --bg-input:     #...;
     --border:       #...;
     --border-light: #...;

     --accent:     #...;
     --accent-dim: #...;
     --on-accent:  #...;

     --danger:  #...;
     --success: #...;
     --info:    #...;
     --blue:    #...;

     --text-main:  #...;
     --text-muted: #...;
     --text-faint: #...;

     --bg-spectro:      #...;
     --text-spectro:    #...80; /* accent + 50% alpha */
     --scrollbar-thumb: #...;
     --scrollbar-track: #...;

     --shadow:        0 4px 24px rgba(0,0,0,.50);
     --shadow-card:   0 1px 3px rgba(0,0,0,.35), 0 1px 2px rgba(0,0,0,.20);
     --overlay-scrim: rgba(0,0,0,.70);
   }
   ```

   You do **not** need to declare `--accent-glow`, `--focus-ring`,
   `--surface-1/2/3`, `--amber`, `--amber-dim`, `--warning` — they're
   inherited from the global `:root` block and resolve via the cascade.

2. **If the theme is dark**, register it in the dark-common selector group
   so it inherits `--overlay-line: rgba(255,255,255,.10)`:

   ```css
   [data-theme="forest"], ..., [data-theme="my-theme"] {
     --overlay-line: rgba(255,255,255,.10);
   }
   ```

3. **If the theme is light**, declare its own light overlay-line and amber
   palette inside the theme block:

   ```css
   --overlay-line: rgba(28,25,23,.10); /* dark separator on light bg */
   --amber:        #d97706;
   --amber-dim:    #92400e;
   --warning:      #d97706;
   ```

4. **Optional: data-viz overrides.** If your theme is light or has a
   distinct palette, override the data-viz tokens in a second block right
   after the main theme block:

   ```css
   [data-theme="my-theme"] {
     --data-night: #...;
     --data-dawn:  #...;
     --data-day:   #...;
     --data-dusk:  #...;
     /* abundance and categorical overrides if relevant */
   }
   ```

5. **Add the picker preview** by appending one rule:

   ```css
   .theme-dot[data-t="my-theme"] {
     --preview-accent: #...;
     --preview-card:   #...;
     --preview-bg:     #...;
   }
   ```

   The base `.theme-dot` rule consumes these via a 3-band linear-gradient.

6. **Register in the picker** by adding one line to the `THEMES` array in
   `public/js/bird-vue-core.js`:

   ```js
   { id:'my-theme', label:'My Theme', colors:['#accent','#bg'] },
   ```

That's the entire process. No JS color logic, no Vue changes, no rebuild.

## Accessibility notes

- Every `--text-main` and `--text-muted` clears WCAG AA on its own
  `--bg-card`. The high-contrast theme clears AAA. If you change a muted
  text color, run a contrast check before committing.
- `--text-faint` is decorative only and is **not** required to clear AA.
  It's used for placeholder text, dimmed separators, decorative grid lines.
- The `prefers-reduced-motion` media query disables the theme cross-fade
  transition for users who request it. Don't add other animations to the
  shell containers without honoring this query.
- The `auto` theme is a real `prefers-color-scheme` listener — when an OS
  user toggles their system theme, Birdash flips live without a reload.

## Token-driven philosophy

Avoid hardcoded colors anywhere outside `bird-styles.css`. The token system
is the single source of truth. Concretely:

- **Don't** write `color: #fff` on a `var(--accent)` background — use
  `color: var(--on-accent)`. White breaks any future light-on-light theme.
- **Don't** write `box-shadow: 0 4px 12px rgba(0,0,0,.3)` — use
  `var(--shadow)` or `var(--shadow-card)`. Hardcoded black shadows look
  terrible on the paper / sepia / solar-light themes.
- **Don't** write `background: rgba(0,0,0,.5)` for a modal scrim — use
  `var(--overlay-scrim)`.
- **Don't** write hardcoded chart colors — use the `--data-*` palette.
- **Don't** invent new tokens locally in HTML `<style>` blocks. If you need
  a new semantic token, add it to `bird-styles.css` so every theme can set it.

The handful of remaining hardcoded `rgba(0,0,0,...)` values in the codebase
are intentional: they sit on top of bird photos or the spectrogram canvas,
which are always visually dark regardless of the UI theme. They don't track
the active theme — and that's correct.
