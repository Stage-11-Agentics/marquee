import { expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const reviewerPage = source("../../src/ui/review/ReviewerPage.tsx");
const reviewerStyles = source("../../src/ui/review/review.css");
const themeSwitch = source("../../src/ui/shell/ThemeSwitch.tsx");
const topbar = source("../../src/ui/shell/Topbar.tsx");
const signinDestination = source("../../src/lib/auth/signin-destination.ts");

function shellSources(): string[] {
  return readdirSync(fileURLToPath(new URL("../../src/ui/shell", import.meta.url)), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(tsx|ts)$/.test(entry.name))
    .map((entry) => readFileSync(fileURLToPath(new URL(`../../src/ui/shell/${entry.name}`, import.meta.url)), "utf8"));
}

test("AC-10 · the reviewer topline brand and exit link use the seat-home mapping", () => {
  expect(signinDestination).toContain('reviewer: "/reviewer"');
  expect(reviewerPage).toContain('import { ROLE_HOME } from "../../lib/auth/signin-destination"');
  expect(reviewerPage).toContain('<a class="reviewer-brand" href={ROLE_HOME.reviewer}');
  expect(reviewerPage).toContain('<a class="reviewer-exit" href={ROLE_HOME.reviewer}>Exit queue</a>');
  expect(reviewerPage).not.toContain("window.history.back");
});

test("AC-11 · the theme control is one shared implementation used by admin and both reviewer pages", () => {
  expect(topbar).toContain('import { ThemeSwitch } from "./ThemeSwitch"');
  expect(topbar).toContain("<ThemeSwitch />");
  expect(topbar).not.toContain('class="theme-switch"');
  expect(reviewerPage).toContain('import { ThemeSwitch } from "../shell/ThemeSwitch"');
  // One common topline renders for both `mode="home"` and queue mode.
  expect(reviewerPage.match(/<ThemeSwitch \/>/g)).toHaveLength(1);
  expect(themeSwitch.match(/<select/g)).toHaveLength(1);
  expect(themeSwitch).toContain("THEMES.map");
  expect(themeSwitch).toContain("writeTheme(next)");
  expect(themeSwitch).toContain("writeSwyxyMode");
  expect(themeSwitch).toContain("a select holds one fixed width however many are registered");
  expect(reviewerStyles).toContain(".reviewer-top-meta > .theme-switch { flex: 0 0 138px; min-width: 138px; }");

  const implementationCount = shellSources()
    .join("\n")
    .match(/class="theme-switch"/g)?.length ?? 0;
  expect(implementationCount).toBe(1);
});
