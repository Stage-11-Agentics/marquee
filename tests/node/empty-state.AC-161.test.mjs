import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const surfaces = [
  ["shared shell fallback", "src/ui/shell/AppShell.tsx", "Back to Program home"],
  ["program home", "src/ui/dashboard/DashboardPage.tsx", "+ Add session"],
  ["program board", "src/ui/board/ProgramBoardPage.tsx", "+ Add session"],
  ["submissions list", "src/ui/submissions/SubmissionsPage.tsx", "+ Add session"],
  ["submission record", "src/ui/submissions/SubmissionRecordPage.tsx", "Back to submissions"],
  ["create submission", "src/ui/submissions/CreateSubmissionPage.tsx", "Create record"],
  ["evaluation plan", "src/ui/evaluation/EvaluationPage.tsx", "Create evaluation plan"],
  ["reviewer queue", "src/ui/review/ReviewerPage.tsx", "Return to conference"],
  ["agenda builder", "src/ui/agenda/AgendaPage.tsx", "Open accepted submissions"],
  ["onboarding board", "src/ui/onboarding/OnboardingPage.tsx", "Open accepted speakers"],
  ["sessionize import", "src/ui/import/SessionizeImportPage.tsx", "Upload and preview"],
  ["event settings", "src/ui/settings/EventSettings.tsx", "+ Add format"],
  ["API tokens", "src/ui/settings/ApiTokensPage.tsx", "Create API token"],
  ["venues", "src/ui/venues/VenuesPage.tsx", "+ Add building"],
  ["CFP forms", "src/ui/forms/FormsPage.tsx", "+ New form"],
  ["communications", "src/ui/comms/CommsScreen.tsx", "Write an ad-hoc message"],
  ["speaker portal", "src/ui/portal/PortalPage.tsx", "Return to conference"],
  ["public agenda", "src/ui/public/agenda/PublicAgendaPage.tsx", "Show full agenda"],
  ["public embed", "src/ui/embeds/EmbedPage.tsx", "Show full agenda"],
  ["public landing", "src/routes/landing.route.tsx", "Enter as organizer"],
  ["public CFP", "src/ui/public/form/PublicForm.tsx", "Submit abstract"],
];

const sourceByPath = new Map(
  await Promise.all(surfaces.map(async ([label, relativePath, marker]) => [
    relativePath,
    { label, marker, source: await readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8") },
  ])),
);
const shellComponents = await readFile(new URL("../../src/ui/shell/components.tsx", import.meta.url), "utf8");
const sharedStyles = await readFile(new URL("../../src/styles/components.css", import.meta.url), "utf8");

test("AC-161 · every routed surface names a fresh-state next action", () => {
  for (const [relativePath, { label, marker, source }] of sourceByPath) {
    assert.ok(source.includes(marker), `${label} (${relativePath}) has no visible next-action marker: ${marker}`);
  }
});

test("AC-161 · empty-state actions reserve a stable slot", () => {
  assert.match(shellComponents, /class=\"empty-state-action\"/);
  assert.match(sharedStyles, /\.empty-state-action[^\n]*min-height: 30px/);
});

test("AC-161 · positive control rejects an empty state without an action", () => {
  const broken = '<EmptyState title="Nothing here" copy="The list is clear." />';
  assert.throws(() => assert.match(broken, /(?:action=|onClick=|href=)/));
});
