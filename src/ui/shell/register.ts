// Register chrome: the typed, per-register configuration the shell and the
// dashboard read instead of branching on theme ids. A register theme's tropes
// are data here — which search glyph, which nav labels, which dashboard
// renderers — so components hold one `chrome.<field>` switch per section and
// never an ad-hoc `theme === "…"`.
//
// Palette themes resolve to DEFAULT_CHROME, which is exactly the MRQ-103
// shell: same glyph, same route-table labels, same dashboard renderers. That
// is what keeps Day and Night byte-identical while the registry is open.

import { useEffect, useState } from "preact/hooks";
import { readTheme, readSwyxyMode, type SwyxyMode, type ThemeId } from "./theme";

export interface RegisterChrome {
  /** Glyph pinned at the left of the topbar search box. */
  searchGlyph: "⌕" | ">_";
  /** Sidebar label overrides by route id (swyxy's lowercase single-word nav). */
  navLabels: Readonly<Record<string, string>>;
  /** Zero-pad the numeric pipeline icons (1–7 → 01–07) — AI Engineer. */
  zeroPadNavIcons: boolean;
  /** Which renderer each dashboard section uses. */
  attention: "cards" | "terminal" | "feed";
  waves: "bar" | "ascii" | "kv";
  tasks: "grid" | "timeline" | "feed";
  metrics: "grid" | "kv";
  /** Decorative silhouette behind the pipeline strip — latent.space's VAE. */
  pipelineDeco: "none" | "bottleneck";
  /** The lowercase "dark" word in the topbar — swyxy only. */
  darkToggle: boolean;
}

export const DEFAULT_CHROME: RegisterChrome = {
  searchGlyph: "⌕",
  navLabels: {},
  zeroPadNavIcons: false,
  attention: "cards",
  waves: "bar",
  tasks: "grid",
  metrics: "grid",
  pipelineDeco: "none",
  darkToggle: false,
};

const REGISTER_CHROME: Partial<Record<ThemeId, RegisterChrome>> = {
  "latent-space": { ...DEFAULT_CHROME, pipelineDeco: "bottleneck" },
  "ai-engineer": {
    ...DEFAULT_CHROME,
    searchGlyph: ">_",
    zeroPadNavIcons: true,
    attention: "terminal",
    waves: "ascii",
    tasks: "timeline",
  },
  swyxy: {
    ...DEFAULT_CHROME,
    navLabels: {
      people: "people",
      lists: "lists",
      sourcing: "sourcing",
      dashboard: "home",
      board: "board",
      submissions: "sessions",
      "submission-new": "add session",
      submitted: "submitted",
      "in-review": "in review",
      waved: "waved",
      accepted: "accepted",
      onboarding: "onboarding",
      scheduled: "scheduled",
      published: "published",
      speakers: "speakers",
      forms: "forms",
      evaluation: "evaluation",
      reviewer: "review",
      agenda: "agenda",
      files: "files",
      communications: "comms",
      tasks: "tasks",
      portal: "portal",
      "event-site": "site",
      embeds: "embeds",
      settings: "settings",
      "delivery-health": "follow-ups",
      "system-health": "health",
    },
    attention: "feed",
    waves: "kv",
    tasks: "feed",
    metrics: "kv",
    darkToggle: true,
  },
};

export function chromeFor(theme: ThemeId): RegisterChrome {
  return REGISTER_CHROME[theme] ?? DEFAULT_CHROME;
}

// Register themes may load webfonts; palette themes never do (Day/Night stay
// font-free). Links are injected once per theme, at pre-paint time by
// index.html's inline script for the stored theme and here for runtime
// switches. `display=swap` plus the fallback stacks in the stylesheets keep
// the layout standing when fonts are offline — speed is a graded feature.
const THEME_FONT_URLS: Partial<Record<ThemeId, string>> = {
  "latent-space": "https://fonts.googleapis.com/css2?family=Syncopate:wght@400;700&display=swap",
  "ai-engineer": "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap",
};

export function ensureThemeAssets(theme: ThemeId): void {
  const url = THEME_FONT_URLS[theme];
  if (!url || typeof document === "undefined") return;
  if (document.querySelector(`link[data-theme-fonts="${theme}"]`)) return;
  const preconnect = document.createElement("link");
  preconnect.rel = "preconnect";
  preconnect.href = "https://fonts.gstatic.com";
  preconnect.crossOrigin = "anonymous";
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = url;
  stylesheet.dataset.themeFonts = theme;
  // appendChild, not append: the test tsconfig pulls in the worker types
  // alongside DOM, where `append` resolves to the FormData/BodyInit overload.
  document.head.appendChild(preconnect);
  document.head.appendChild(stylesheet);
}

/**
 * The theme the document currently wears, kept live: the attribute is the
 * source of truth (index.html stamps it pre-paint; writeTheme moves it), so
 * an observer on `<html>` re-renders every subscriber on a switch.
 */
export function useThemeId(): ThemeId {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/** swyxy's light/dark, live like useThemeId — the mode is its own attribute. */
export function useSwyxyMode(): SwyxyMode {
  const [mode, setMode] = useState(readSwyxyMode);
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(readSwyxyMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-swyxy-mode"] });
    return () => observer.disconnect();
  }, []);
  return mode;
}
