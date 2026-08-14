/**
 * The theme registry, on its own so both sides of the wire can hold it.
 *
 * The shell has always owned themes because only a browser wears one. But an
 * organization now stores a *default* theme (ruling O7), which means the Worker
 * has to be able to say whether a submitted value is a theme at all — and a
 * route validating against a hard-coded copy of this list is a second registry
 * that drifts the first time a theme is added.
 *
 * So the registry lives here, in code neither side owns, and
 * `src/ui/shell/theme.ts` re-exports it unchanged: every existing import keeps
 * working and there is still exactly one list. What stays in the shell is
 * everything that touches a document — applying, storing, dressing the tab.
 */

export type ThemeKind = "palette" | "register";
export type ThemeId = "day" | "night" | "latent-space" | "ai-engineer" | "swyxy";

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

export const THEME_IDS: readonly ThemeId[] = THEMES.map((theme) => theme.id);

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}
