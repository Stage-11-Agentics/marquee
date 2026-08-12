import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { THEMES, THEME_STORAGE_KEY, applyTheme, isThemeId, readTheme, writeTheme } from "../../src/ui/shell/theme";

const root = resolve(import.meta.dirname, "../..");

// theme.ts touches exactly two globals. Standing them up here keeps the test in
// the Worker-free pool: a theme toggle should not cost a Miniflare isolate.
type FakeStorage = { store: Map<string, string>; throwOn?: "get" | "set" };

function installDom(storage: FakeStorage | null): void {
  const dataset: Record<string, string> = {};
  (globalThis as Record<string, unknown>).document = {
    documentElement: {
      dataset: new Proxy(dataset, {
        deleteProperty(target, key: string) { delete target[key]; return true; },
      }),
    },
  };
  (globalThis as Record<string, unknown>).localStorage = storage
    ? {
        getItem(key: string) {
          if (storage.throwOn === "get") throw new Error("private mode");
          return storage.store.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          if (storage.throwOn === "set") throw new Error("quota exceeded");
          storage.store.set(key, value);
        },
      }
    : undefined;
}

function currentAttribute(): string | undefined {
  return (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } })
    .document.documentElement.dataset.theme;
}

let storage: FakeStorage;

beforeEach(() => {
  storage = { store: new Map() };
  installDom(storage);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe("MRQ-103 · theme system", () => {
  test("CONTRACT · Day is the default and carries no attribute, so an unstyled document is still the designed light palette", () => {
    expect(readTheme()).toBe("day");
    applyTheme("day");
    expect(currentAttribute()).toBeUndefined();
  });

  test("CONTRACT · Night sets the attribute the tokens key on, and round-trips through storage", () => {
    writeTheme("night");
    expect(currentAttribute()).toBe("night");
    expect(storage.store.get(THEME_STORAGE_KEY)).toBe("night");
    expect(readTheme()).toBe("night");
  });

  test("CONTRACT · switching back to Day removes the attribute rather than setting an empty one", () => {
    writeTheme("night");
    writeTheme("day");
    // A lingering data-theme="" would still match [data-theme] selectors.
    expect(currentAttribute()).toBeUndefined();
    expect(readTheme()).toBe("day");
  });

  test("CONTRACT · an unknown or corrupt stored value falls back to Day instead of a themeless document", () => {
    storage.store.set(THEME_STORAGE_KEY, "vaporwave");
    expect(readTheme()).toBe("day");
    storage.store.set(THEME_STORAGE_KEY, "");
    expect(readTheme()).toBe("day");
  });

  test("CONTRACT · storage that throws (private mode) still yields Day rather than an exception", () => {
    storage.throwOn = "get";
    expect(() => readTheme()).not.toThrow();
    expect(readTheme()).toBe("day");
  });

  test("CONTRACT · a theme that cannot be persisted is still applied for this session", () => {
    storage.throwOn = "set";
    expect(() => writeTheme("night")).not.toThrow();
    expect(currentAttribute()).toBe("night");
  });

  test("CONTRACT · isThemeId gates the select's value before it reaches the document", () => {
    expect(isThemeId("night")).toBe(true);
    expect(isThemeId("midnight")).toBe(false);
    expect(isThemeId(null)).toBe(false);
  });

  test("CONTRACT · the pre-paint script agrees with the module on key and value", () => {
    // These are two independent implementations of the same contract — the
    // inline script must stamp exactly what the module later reads, or the
    // app flashes the wrong palette and then corrects itself.
    const shell = readFileSync(resolve(root, "index.html"), "utf8");
    expect(shell).toContain(THEME_STORAGE_KEY);
    expect(shell).toMatch(/dataset\.theme/);
    for (const theme of THEMES) {
      if (theme.id === "day") continue;
      expect(shell).toContain(theme.id);
    }
  });

  test("CONTRACT · every registered theme has a matching tokens.css block, so the select cannot offer a dead option", () => {
    const tokens = readFileSync(resolve(root, "src/styles/tokens.css"), "utf8");
    for (const theme of THEMES) {
      if (theme.id === "day") continue; // Day is the bare :root.
      expect(tokens).toContain(`html[data-theme="${theme.id}"]`);
    }
  });
});
