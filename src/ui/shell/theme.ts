// Themes are palette-only: a theme is one `html[data-theme="…"]` block in
// tokens.css plus one row here. Structure tokens — spacing, radius, the
// hairline, the type stacks, `--shadow: none` — are theme-invariant, which is
// what keeps Night a re-lit instrument rather than a generic dark mode.
//
// Day carries no attribute so it stays the true default: nothing to load, and
// a browser that never runs the pre-paint script in index.html still gets the
// designed light palette.
//
// The OS `prefers-color-scheme` is deliberately NOT consulted. Marquee is
// demoed and judged in daylight, and a visitor whose laptop happens to be in
// dark mode should not silently get a palette nobody chose for them. Night is
// opt-in, and the choice persists.

export const THEME_STORAGE_KEY = "marquee-theme";

export type ThemeId = "day" | "night";

export const THEMES: readonly { id: ThemeId; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "night", label: "Night" },
];

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export function readTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(stored) ? stored : "day";
  } catch (_) {
    // Storage can throw outright in private mode — Day is the safe answer.
    return "day";
  }
}

export function applyTheme(theme: ThemeId): void {
  if (theme === "day") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function writeTheme(theme: ThemeId): void {
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (_) {
    // A theme that cannot be remembered is still worth applying for this session.
  }
}
