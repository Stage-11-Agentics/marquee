import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { REPOSITORY_ROOT, emit } from "./lib/command.mjs";

const skin = await readFile(resolve(REPOSITORY_ROOT, "prototypes/skins/skin-c.html"), "utf8");
const tokens = await readFile(resolve(REPOSITORY_ROOT, "src/styles/tokens.css"), "utf8");
const components = await readFile(resolve(REPOSITORY_ROOT, "src/styles/components.css"), "utf8");
const routes = await readFile(resolve(REPOSITORY_ROOT, "src/ui/shell/route-table.ts"), "utf8");
const sourceFiles = await Promise.all(
  ["src/ui/app.tsx", "src/ui/shell/AppShell.tsx", "src/ui/shell/Sidebar.tsx", "src/ui/shell/Topbar.tsx"]
    .map(async (path) => [path, await readFile(resolve(REPOSITORY_ROOT, path), "utf8")]),
);

const canonical = skin.match(/TOKEN BLOCK[\s\S]*?\n  (:root \{[\s\S]*?\n  \})/)?.[1]
  ?.split("\n").map((line) => line.startsWith("  ") ? line.slice(2) : line).join("\n").trim();
const lifted = tokens.match(/^:root \{[\s\S]*?\n\}/)?.[0].trim();
const findings = [];
if (!canonical || canonical !== lifted) findings.push("skin-c canonical token block differs from the first tokens.css root block");
for (const contract of [
  [components, /grid-template-columns:\s*224px minmax\(0, ?1fr\)/, "desktop sidebar is not 224px"],
  [components, /height:\s*52px/, "topbar is not 52px"],
  [components, /max-width:\s*1000px[\s\S]*grid-template-columns:\s*68px/, "compact sidebar is not 68px at 1000px"],
  [components, /@media \(max-width: 760px\)[\s\S]*\.sidebar \{[^}]*height:\s*100vh;[^}]*width:\s*min\(302px, 86vw\);/, "mobile drawer is not 302px at 760px"],
  [components, /@media \(max-width: 760px\)[\s\S]*\.page \{[^}]*padding:\s*22px 16px 56px;/, "mobile page still reserves the retired bottom rail"],
]) {
  if (!contract[1].test(contract[0])) findings.push(contract[2]);
}
const mobileContract = components.match(/@media \(max-width: 760px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
if (/\.sidebar \{[^}]*height:\s*54px;/.test(mobileContract)) {
  findings.push("mobile bottom rail is still present at 760px");
}
// The labels the signed design names. Several are shorter than they were: a row
// under "Call for proposals" that says "CFP forms" says CFP twice, and one under
// "Speaker ops" that says "Speaker follow-ups" says speaker twice. The group
// carries the scope, so the row carries only the noun (v1.15, 2026-08-14). The
// seven lifecycle stages keep their labels here while their rows are gone from
// the sidebar: they are the stage flyout's rows now, and their URLs still resolve.
for (const label of ["Program pipeline", "Program board", "Submitted", "In review", "Waved", "Ready to place", "Onboarding", "Scheduled", "Published", "Forms", "Evaluation", "Review queue", "Agenda", "Communications", "Speaker portal", "Conference site", "Settings", "Follow-ups", "System health", "People CRM", "Outreach", "Abstracts & sessions"]) {
  if (!routes.includes(`label: "${label}"`)) findings.push(`route table missing ${label}`);
}
for (const [path, content] of sourceFiles) {
  if (/PROTOTYPE/i.test(content)) findings.push(`${path} contains a prototype badge/marker`);
}

// A hardcoded color is invisible to the theme system: it looks correct in Day
// and is simply wrong in Night, with nothing to catch it but a human's eye on
// the one screen that happens to use it. Every color the admin shell paints
// must come from a token, so themes stay a property of tokens.css alone.
//
// Scope is the admin shell. The public site, embeds, and the API docs page are
// deliberately outside it: an embed inherits its host page's palette, and an
// attendee reading a public agenda should not have it re-lit because an
// organizer picked Night in admin. Those surfaces own their own palettes.
const THEMED_STYLESHEET = "src/styles/components.css";
const themedCss = components
  .split("\n")
  .map((line, index) => [index + 1, line])
  .filter(([, line]) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(line) && !/^\s*\/\*/.test(line));
for (const [lineNumber, line] of themedCss) {
  findings.push(`${THEMED_STYLESHEET}:${lineNumber} hardcodes a color; use a token so themes can re-light it — ${line.trim().slice(0, 80)}`);
}

// Night must define every token Day's second :root introduces, or a night
// screen silently inherits a light value (white text on white, most likely).
const dayExtensions = [...tokens.matchAll(/^:root \{[\s\S]*?\n\}\s*\n\/\* Binding[\s\S]*?\n:root \{([\s\S]*?)\n\}/g)][0]?.[1] ?? "";
const nightBlock = tokens.match(/html\[data-theme="night"\] \{([\s\S]*?)\n\}/)?.[1] ?? "";
if (!nightBlock) findings.push("tokens.css has no html[data-theme=\"night\"] block");
else {
  // Only color tokens are themeable; aliases that resolve to other tokens and
  // the structure tokens are intentionally inherited.
  const colorLiteral = /^\s*(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8}|rgba?\()/;
  for (const line of dayExtensions.split("\n")) {
    const name = line.match(colorLiteral)?.[1];
    if (name && !new RegExp(`^\\s*${name}\\s*:`, "m").test(nightBlock)) {
      findings.push(`night theme does not redefine ${name}; it would inherit the Day color`);
    }
  }
}
const result = { command: "check:design", status: findings.length ? "fail" : "pass", findings };
emit(result);
if (findings.length) process.exitCode = 1;
