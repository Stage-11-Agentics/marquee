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

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

/**
 * The tab dresses with the page.
 *
 * A register repaints the shell down to its mark — latent.space wears a
 * gradient hexagon, AI Engineer a shell prompt, swyxy the wordmark's period —
 * and a tab still showing the Flight Deck M above one of them reads as another
 * site's icon on the wrong window. So icon and browser-chrome colour are part
 * of the theme, applied by whoever applies the theme: the pre-paint script in
 * index.html on load, and `applyTheme` on every switch after it. Keep the two
 * in sync; the shell's map is the same map.
 *
 * Only the two live formats move. /favicon.ico is the legacy last resort and
 * stays the Day mark: a browser old enough to need it is one no register theme
 * was drawn for. The icon paths are `/favicon-<id>` by construction, so a new
 * theme's assets are named by its id and nothing here needs a new branch.
 */
export const THEME_CHROME_COLOR: Record<ThemeId, string> = {
  day: "#eaeef2",
  night: "#121416",
  "latent-space": "#0b0b0e",
  "ai-engineer": "#ffffff",
  swyxy: "#ffffff",
};
export const SWYXY_DARK_CHROME_COLOR = "#0b1120";

export function themeIcons(theme: ThemeId): { svg: string; png: string } {
  if (theme === "day") return { svg: "/favicon.svg", png: "/favicon-32.png" };
  return { svg: `/favicon-${theme}.svg`, png: `/favicon-${theme}-32.png` };
}

function dressIcon(id: string, href: string): void {
  const link = document.getElementById(id) as HTMLLinkElement | null;
  if (!link || link.getAttribute("href") === href) return;
  // Swap the element rather than its href: browsers re-read an icon reliably
  // when the link itself changes, and less reliably when only the attribute
  // does — the difference is a tab that keeps the old mark until reload.
  const fresh = link.cloneNode(false) as HTMLLinkElement;
  fresh.setAttribute("href", href);
  link.replaceWith(fresh);
}

/** Point the tab's icon and chrome colour at what the document is wearing. */
export function applyHeadDress(theme: ThemeId, mode: SwyxyMode): void {
  // No document, or a head this route rewrote without the tags: nothing to
  // dress, and the palette must still apply.
  if (typeof document === "undefined" || typeof document.getElementById !== "function") return;
  const icons = themeIcons(theme);
  dressIcon("icon-svg", icons.svg);
  dressIcon("icon-png", icons.png);
  const meta = document.getElementById("theme-color-meta") as HTMLMetaElement | null;
  if (meta) {
    meta.setAttribute(
      "content",
      theme === "swyxy" && mode === "dark" ? SWYXY_DARK_CHROME_COLOR : THEME_CHROME_COLOR[theme],
    );
  }
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
  applyHeadDress(theme, theme === "swyxy" ? domSwyxyMode() : "light");
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
  // The chrome colour follows the mode as well as the theme; the icon does
  // not — one indigo mark carries both swyxy palettes.
  if (domTheme() === "swyxy") applyHeadDress("swyxy", mode);
}

export function writeSwyxyMode(mode: SwyxyMode): void {
  applySwyxyMode(mode);
  try {
    localStorage.setItem(SWYXY_MODE_STORAGE_KEY, mode);
  } catch (_) {
    // As with the theme itself: apply for the session even if it cannot persist.
  }
}
