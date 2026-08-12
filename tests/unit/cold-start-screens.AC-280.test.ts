/**
 * The second conference, and the dialog that never blocks.
 *
 * Both halves are source-and-structure facts rather than runtime behaviour, so
 * they belong in the Worker-free project: the cold start's Worker-backed
 * assertions already cost one Miniflare isolate in
 * `tests/integration/cold-start.AC-275-286.test.ts`, and nothing here needs a
 * second.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import createConferenceSource from "../../src/ui/setup/CreateConferencePage.tsx?raw";
import formsPageSource from "../../src/ui/forms/FormsPage.tsx?raw";
import formsRouteSource from "../../src/routes/forms.routes.ts?raw";
import sidebarSource from "../../src/ui/shell/Sidebar.tsx?raw";
import eventSwitcherSource from "../../src/ui/shell/EventSwitcher.tsx?raw";
import { CONFERENCE_CHECKLIST_STEPS, INSTANCE_LEVEL_STEP_KEYS } from "../../src/ui/setup/checklist";
import { routeTable } from "../../src/ui/shell/route-table";

const UI_ROOT = fileURLToPath(new URL("../../src/ui", import.meta.url));

/** Every `.tsx`/`.ts` under `src/ui`, as text. The scan is the parity check. */
function uiSources(directory = UI_ROOT): { path: string; text: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return uiSources(path);
    if (!/\.tsx?$/.test(entry.name)) return [];
    return [{ path: path.slice(UI_ROOT.length + 1), text: readFileSync(path, "utf8") }];
  });
}

test("AC-280 · the screen and the switcher's ＋ open one create-conference endpoint", () => {
  // Both doors are the same door. The `＋` navigates to the screen rather than
  // posting on its own, and the screen holds the only reference to the create
  // endpoint anywhere in the client — so there is no second way a conference
  // can come into existence, and no second shape for it to come in.
  // The ＋ and the conference name share one row, which is now the switcher's
  // own component; the sidebar composes it.
  expect(eventSwitcherSource).toContain('href="/conferences/new"');
  expect(eventSwitcherSource).toContain('navigate("/conferences/new")');
  expect(eventSwitcherSource).toContain('aria-label="Create conference"');
  expect(eventSwitcherSource).not.toContain("apiFetch");
  expect(eventSwitcherSource).not.toContain('method: "POST"');
  expect(sidebarSource).not.toContain("apiFetch");
  expect(sidebarSource).not.toContain('method: "POST"');

  // The conference name is a control again, and this time it picks something.
  // The rule the judge's defect actually established still holds: it must never
  // be a link back to the page you are already on. So — a button that opens a
  // list, never an anchor, and never a navigation to /dashboard from the row
  // itself.
  expect(eventSwitcherSource).toContain('class="event-context event-switcher"');
  expect(eventSwitcherSource).toContain('aria-haspopup="listbox"');
  expect(eventSwitcherSource).not.toMatch(/<a[^>]*class="event-context/);

  expect(createConferenceSource).toContain('export const CREATE_EVENT_ROUTE = "/api/v1/events"');
  expect(createConferenceSource).toContain("apiFetch<CreatedEvent>(CREATE_EVENT_ROUTE");
  expect(createConferenceSource).toContain("route: CREATE_EVENT_ROUTE");

  // The collection route is read in one place and written in one place. Reading
  // it is what the switcher is made of; writing it is what makes a conference,
  // and there is still exactly one file that can.
  const touchesCollection = uiSources().filter((file) => file.text.includes('"/api/v1/events"'));
  expect(touchesCollection.map((file) => file.path).sort()).toEqual([
    "setup/CreateConferencePage.tsx",
    "shell/event-context.tsx",
  ]);
  const creators = touchesCollection.filter((file) => file.text.includes('method: "POST"'));
  expect(creators.map((file) => file.path)).toEqual(["setup/CreateConferencePage.tsx"]);

  // The screen the `＋` opens is a real registered route, not a dead href.
  const registered = routeTable.find((route) => route.path === "/conferences/new");
  expect(registered?.id).toBe("conference-new");

  // The prior conference stays selectable: creating one selects the new
  // conference by id rather than replacing what the switcher points at. The
  // selection is written through the context — a `?event=` left in the address
  // bar would re-pin the old conference on the next reload.
  expect(createConferenceSource).toContain("switchEvent(created.data.event.id)");
  expect(createConferenceSource).toContain('navigate(mode === "sessionize" ? "/import" : "/dashboard")');
});

test("AC-280 · the checklist is conference-scoped, with nothing instance-level and nothing to claim", () => {
  const keys = CONFERENCE_CHECKLIST_STEPS.map((step) => step.key);
  expect(keys).toEqual(["details", "taxonomy", "form", "evaluation", "intake"]);
  for (const forbidden of INSTANCE_LEVEL_STEP_KEYS) {
    expect(keys).not.toContain(forbidden);
  }

  // Every step is done on a conference screen, and every one of those screens
  // is a route the shell actually serves.
  const paths = new Set(routeTable.map((route) => route.path));
  for (const step of CONFERENCE_CHECKLIST_STEPS) {
    expect(paths.has(step.route)).toBe(true);
    expect(step.route.startsWith("/")).toBe(true);
    const prose = `${step.label} ${step.note} ${step.action}`.toLowerCase();
    for (const instanceWord of ["claim", "cloudflare", "wrangler", "resend", "turnstile", "domain", "deploy"]) {
      expect(prose).not.toContain(instanceWord);
    }
  }
});

test("AC-285 · the mail-unconfigured acknowledgment names its three consequences and cannot block a publish", () => {
  // Raised only on a read that came back false. `null` — the instance has not
  // answered — never raises it, in either direction.
  expect(formsPageSource).toContain("const [mailConfigured, setMailConfigured] = useState<boolean | null>(null)");
  expect(formsPageSource).toContain('if (next !== "publish" || mailConfigured !== false) {');
  expect(formsPageSource).toContain("runLifecycle(next);");

  expect(formsPageSource).toContain('role="alertdialog"');
  for (const consequence of [
    "submitters get no confirmation email",
    "accepted speakers get no decision mail",
    "no calendar invites are delivered",
  ]) {
    expect(formsPageSource).toContain(consequence);
  }

  // Cancel closes the dialog and publishes nothing; acknowledging publishes and
  // carries the acknowledgment to the server.
  expect(formsPageSource).toContain('<Button onClick={() => setMailWarning(false)}>Configure mail first</Button>');
  expect(formsPageSource).toContain('setMailWarning(false); runLifecycle("publish", true);');
  expect(formsPageSource).toContain('JSON.stringify({ acknowledge_mail_unconfigured: true })');

  // Server-side there is no refusal to find: the publish handler reads the
  // acknowledgment and writes it down, and the only thing that can stop the
  // route is a close time already in the past.
  expect(formsRouteSource).toContain('action: "form.published_without_mail"');
  expect(formsRouteSource).not.toMatch(/RESEND_API_KEY[\s\S]{0,400}throw/);
  expect(formsRouteSource).not.toMatch(/mail[\s\S]{0,80}ApiError\.(unprocessable|conflict|forbidden)/i);
});
