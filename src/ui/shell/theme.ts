// Two theme classes share this registry.
//
// Palette themes (Day, Night) keep the MRQ-103 invariant: a palette theme is
// one `html[data-theme="…"]` block in tokens.css plus one row here, and it may
// only move color. Structure tokens — spacing, radius, the hairline, the type
// stacks, `--shadow: none` — are theme-invariant, which is what keeps Night a
// re-lit instrument rather than a generic dark mode. Day still carries no
// attribute so it stays the true default: nothing to load, and a browser that
// never runs the pre-paint script in index.html still gets the designed light
// palette.
//
// Register themes (latent.space, AI Engineer, swyxy) are the theme-round
// experiment: they re-light the palette AND restyle the shell's chrome —
// casing, marks, prompts — and move type, chrome, and layout tropes on the
// program home. Their styles live in `src/styles/themes/<id>.css`, every rule
// scoped under `html[data-theme="…"]`, so the classes stay orthogonal and the
// palette themes remain exactly what MRQ-103 shipped.
//
// The OS `prefers-color-scheme` is deliberately NOT consulted — including for
// swyxy's dark palette, which flips only from the explicit "dark" word in the
// topbar and persists as part of the one swyxy theme choice. Marquee is demoed
// and judged in daylight, and a visitor whose laptop happens to be in dark
// mode should not silently get a palette nobody chose for them.

export const THEME_STORAGE_KEY = "marquee-theme";
export const SWYXY_MODE_STORAGE_KEY = "marquee-swyxy-mode";

export type ThemeKind = "palette" | "register";
export type ThemeId = "day" | "night" | "latent-space" | "ai-engineer" | "swyxy";
export type SwyxyMode = "light" | "dark";

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  kind: ThemeKind;
}

export const THEMES: readonly ThemeDefinition[] = [
  { id: "day", label: "Marquee Light", kind: "palette" },
  { id: "night", label: "Marquee Night", kind: "palette" },
  { id: "latent-space", label: "latent.space", kind: "register" },
  { id: "ai-engineer", label: "AI Engineer", kind: "register" },
  // Lowercase is deliberate: the register is swyx.io's, and the judges read
  // the casing. Judge-facing, not a typo.
  { id: "swyxy", label: "swyxy", kind: "register" },
];

/**
 * The themes the front door offers (operator ruling, 2026-08-13).
 *
 * The landing picker is a first impression, not a catalogue — it shows these
 * four. swyxy is deliberately not among them; it stays fully available from the
 * top-bar switcher, one click away for anyone already inside. Every theme here
 * still needs its `public/themes/<id>.webp` preview.
 */
export const LANDING_THEME_IDS: readonly ThemeId[] = ["day", "night", "latent-space", "ai-engineer"];

export const LANDING_THEMES: readonly ThemeDefinition[] = THEMES.filter((theme) =>
  LANDING_THEME_IDS.includes(theme.id),
);

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

// `?theme=<id>` overrides the stored choice for comparison links (and
// screenshot runs) without writing storage; `?mode=dark` does the same for
// swyxy's palette. Both fall through to storage when absent or invalid.
function paramFromUrl(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch (_) {
    // No window (unit tests, worker-side renders): no override.
    return null;
  }
}

export function readTheme(): ThemeId {
  const override = paramFromUrl("theme");
  if (isThemeId(override)) return override;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(stored) ? stored : "day";
  } catch (_) {
    // Storage can throw outright in private mode — Day is the safe answer.
    return "day";
  }
}

/**
 * What the document is *currently wearing*, as opposed to what storage or the
 * URL would choose. The pre-paint script in index.html has already resolved
 * `?theme=` and storage into the attribute, so once the page is up the
 * attribute is the only honest answer: re-reading the URL here would pin a
 * live subscriber to a comparison link's override and make the switcher inert.
 */
export function domTheme(): ThemeId {
  // No document at all — a server render, or a component test outside jsdom.
  // Day is the honest answer there, and the guard keeps this a rendered
  // default rather than a ReferenceError.
  if (typeof document === "undefined") return "day";
  const attribute = document.documentElement.dataset.theme;
  return isThemeId(attribute) ? attribute : "day";
}

/** swyxy's mode as worn, for the same reason as `domTheme`. */
export function domSwyxyMode(): SwyxyMode {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.swyxyMode === "dark" ? "dark" : "light";
}

export function applyTheme(theme: ThemeId): void {
  if (theme === "day") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  // swyxy's light/dark lives on its own attribute, so the single "swyxy"
  // choice in storage carries both palettes and every swyxy rule keys on
  // `html[data-theme="swyxy"]` with the mode as a modifier.
  if (theme === "swyxy") applySwyxyMode(readSwyxyMode());
  else delete document.documentElement.dataset.swyxyMode;
}

export function writeTheme(theme: ThemeId): void {
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (_) {
    // A theme that cannot be remembered is still worth applying for this session.
  }
}

export function readSwyxyMode(): SwyxyMode {
  const override = paramFromUrl("mode");
  if (override === "dark" || override === "light") return override;
  try {
    return localStorage.getItem(SWYXY_MODE_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch (_) {
    return "light";
  }
}

export function applySwyxyMode(mode: SwyxyMode): void {
  // Light is the attribute-less default inside swyxy, mirroring Day's rule:
  // `html[data-theme="swyxy"]` alone is the light register.
  if (mode === "dark") document.documentElement.dataset.swyxyMode = "dark";
  else delete document.documentElement.dataset.swyxyMode;
}

export function writeSwyxyMode(mode: SwyxyMode): void {
  applySwyxyMode(mode);
  try {
    localStorage.setItem(SWYXY_MODE_STORAGE_KEY, mode);
  } catch (_) {
    // As with the theme itself: apply for the session even if it cannot persist.
  }
}
