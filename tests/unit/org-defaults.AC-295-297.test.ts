/**
 * The two halves of this fold that need no Worker: the credential a human
 * speaks, and the order in which a theme is decided.
 */
import { afterEach, beforeEach, expect, test } from "vitest";

import { mintShortCode, normalizeShortCode, SHORT_CODE_WORDS } from "../../src/lib/auth/short-code";
import {
  cacheOrgDefaultTheme,
  ORG_DEFAULT_THEME_KEY,
  readTheme,
  THEME_STORAGE_KEY,
} from "../../src/ui/shell/theme";

/**
 * The unit project runs on bare Node — no DOM, deliberately, because a
 * Miniflare-free half is what keeps the suite cheap. `readTheme` needs exactly
 * two browser objects, so this supplies exactly two rather than pulling in a
 * whole document implementation for four assertions.
 */
const store = new Map<string, string>();
const fakeStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
};

function visit(search: string): void {
  (globalThis as { window?: unknown }).window = { location: { search } };
}

beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = fakeStorage;
  visit("");
});

afterEach(() => {
  store.clear();
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { window?: unknown }).window;
});

test("AC-297 · the short code alphabet is unbiased and the codes it mints are well formed", () => {
  // 256 exactly, so a random byte selects a word with no modulo bias. A list
  // that quietly grew to 257 would tilt every code toward the front of the
  // alphabet, which is an entropy loss nothing else in the system would notice.
  expect(SHORT_CODE_WORDS).toHaveLength(256);
  expect(new Set(SHORT_CODE_WORDS).size).toBe(256);
  for (const word of SHORT_CODE_WORDS) expect(word).toMatch(/^[A-Z]{3,10}$/);

  const codes = Array.from({ length: 200 }, () => mintShortCode());
  for (const code of codes) {
    expect(code).toMatch(/^[A-Z]+-[A-Z]+-\d{4}$/);
    expect(normalizeShortCode(code)).toBe(code);
  }
  // Not proof of entropy, but it does catch the mint that returns a constant —
  // a bug that would otherwise pass every other assertion in this file.
  expect(new Set(codes).size).toBeGreaterThan(190);
});

test("AC-297 · a code survives the registration desk, and nothing else is accepted", () => {
  const canonical = "AMBER-FALCON-4821";
  // The lossy channel: retyped in lower case, spoken with spaces, pasted with
  // stray padding. All of these are the same credential.
  expect(normalizeShortCode("amber-falcon-4821")).toBe(canonical);
  expect(normalizeShortCode("  Amber Falcon 4821 ")).toBe(canonical);
  expect(normalizeShortCode("amber_falcon_4821")).toBe(canonical);

  // And the refusals. Normalization that grew any looser would start accepting
  // strings nobody minted, which for a credential is the whole risk.
  for (const bad of [
    "AMBER-FALCON",           // a word short
    "AMBER-FALCON-482",       // three digits, not four
    "AMBER-FALCON-48219",     // five
    "AMBER-BANANA-4821",      // not a word on the list
    "AMBER-FALCON-ABCD",      // digits are digits
    "",
    "-".repeat(40),
    "kY7f2Qm9Zt4bR1nX8vL0sJ6pD3wG5cH",  // a long token is not a short code
  ]) {
    expect(normalizeShortCode(bad)).toBeNull();
  }
});

test("AC-295 · the theme is the person's choice, then the organization's default, then Day", () => {
  // Nothing chosen anywhere.
  expect(readTheme()).toBe("day");

  // The organization has a default, and this browser has never chosen.
  cacheOrgDefaultTheme("latent-space");
  expect(readTheme()).toBe("latent-space");

  // This person chooses. Their choice outranks the organization's default
  // forever after — an organization sets what someone gets BEFORE they choose,
  // never instead of choosing.
  localStorage.setItem(THEME_STORAGE_KEY, "night");
  expect(readTheme()).toBe("night");

  // The organization changing its mind does not reach back and re-dress someone
  // who has already chosen.
  cacheOrgDefaultTheme("ai-engineer");
  expect(readTheme()).toBe("night");

  // A comparison link still wins over both, and persists nothing.
  visit("?theme=swyxy");
  expect(readTheme()).toBe("swyxy");
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("night");
});

test("AC-295 · clearing the organization default removes the key rather than writing Day into it", () => {
  cacheOrgDefaultTheme("night");
  expect(localStorage.getItem(ORG_DEFAULT_THEME_KEY)).toBe("night");

  // Null means "this organization has not said". Storing "day" here instead
  // would pin every silent organization to today's default on the day the
  // product picks a different one.
  cacheOrgDefaultTheme(null);
  expect(localStorage.getItem(ORG_DEFAULT_THEME_KEY)).toBeNull();
  expect(readTheme()).toBe("day");

  // A value that is not a theme is not a default either.
  cacheOrgDefaultTheme("midnight-pro");
  expect(localStorage.getItem(ORG_DEFAULT_THEME_KEY)).toBeNull();
});

test("AC-295 · the pre-paint script reads the same three layers, in the same order", async () => {
  // index.html stamps the theme before first paint and cannot import
  // `readTheme`. Two implementations of one rule is how they drift, and the
  // symptom is a flash on load — so the duplication is asserted rather than
  // trusted.
  const html = (await import("../../index.html?raw")).default;
  const userLayer = html.indexOf('localStorage.getItem("marquee-theme")');
  const orgLayer = html.indexOf(`localStorage.getItem("${ORG_DEFAULT_THEME_KEY}")`);
  expect(userLayer).toBeGreaterThan(-1);
  expect(orgLayer).toBeGreaterThan(userLayer);
});
