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
  [components, /max-width:\s*760px[\s\S]*height:\s*54px/, "mobile rail is not 54px at 760px"],
]) {
  if (!contract[1].test(contract[0])) findings.push(contract[2]);
}
for (const label of ["Program home", "Program board", "Submitted", "In review", "Waved", "Ready to place", "Onboarding", "Scheduled", "Published", "CFP forms", "Evaluation plan", "Review queue", "Agenda", "Communications", "Speaker portal", "Conference site", "Conference settings"]) {
  if (!routes.includes(`label: "${label}"`)) findings.push(`route table missing ${label}`);
}
for (const [path, content] of sourceFiles) {
  if (/PROTOTYPE/i.test(content)) findings.push(`${path} contains a prototype badge/marker`);
}
const result = { command: "check:design", status: findings.length ? "fail" : "pass", findings };
emit(result);
if (findings.length) process.exitCode = 1;
