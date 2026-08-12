# MRQ-129 — adversarial pre-implementation audit

**Auditor:** `agent:mrq129-audit`, 2026-08-12.
**Subject:** MRQ-129 "Multi-event, end to end", minted from `sequence/multi-event-design.md` (ratified 2026-08-12).
**Code verified against:** `github/main @ cd907d3` (current tip) and the read-only worktree `Marquee-worktrees/eval-triage-ro @ 4b2dc09` (the design's pinned "code truth"). Every citation below was read in this pass; where the design's own citation and the code disagree, that disagreement is a finding.
**Rubric verified against:** `.eval-kit/specs/01-call-for-papers.yaml` (the YAML, per §1 rule 1 of `eval-response-tickets.md`), plus `.eval-kit/evalconfig.json` and the run-1 verdicts in `.eval-kit/runs/2026-08-12T02-37-27/report.json`.

**Verdict in one line:** the design is sound in its shape and wrong in its facts. The reconciliation of the two lineages is right; the archaeology it rests on is a tree that main has moved 34 commits and ~17,700 lines past, and the copy engine as specified will write cross-event references that the schema quietly accepts. Six blockers, fourteen majors. Two of the blockers (B1, B6) are operator decisions, not delegator work.

---

## BLOCKERS

### B1 · MRQ-105 is already building `POST /api/v1/events`, `/conferences/new`, and the switcher ＋ — right now, on a do-not-merge branch

`lattice show MRQ-105` — status **in progress**, `agent:claude-opus-mrq-105`, branch `mrq-105-cold-start`. Its scope paragraph, verbatim:

> "…post-claim scoped-token offer (ordinary api_tokens row, no new kind); **POST /api/v1/events + /conferences/new UI + switcher ＋**; org invites mint/exchange/revoke …"

and its process paragraph:

> "**DO NOT MERGE** — merging is human-gated, and this ticket is post-deadline scope that must not merge before the competition freeze clears (BUILDPLAN Amendment 12)."

MRQ-129 scope items 1 and 4 claim the same endpoint, the same route, and the same control. MRQ-105 also owns `cli/generate-skill.mjs` `renderSkill()` under a byte-equality test — which MRQ-129 scope item 5 also touches. The design doc *reads* the cold-start lineage (§1.7 cites `prototypes/cold-start/DECISIONS.md` D3/D7, including D7's "in the build, `POST /api/v1/events` must exist for the agent path anyway") but treats it as a **design input**, never noticing it is an **in-flight implementation**. MRQ-129's ticket text names no dependency on MRQ-105 and the board carries no link between them.

This is not a merge conflict to resolve later. MRQ-105 is gated behind a competition freeze; MRQ-129's entire justification is a rubric run that presumably happens before that freeze clears. Two agents cannot both land `POST /api/v1/events`.

**Amendment.** An operator ruling is required before a delegator starts, and it is one of exactly three:
1. **MRQ-129 waits** for MRQ-105 to merge, then builds on its endpoint (rubric timing risk).
2. **MRQ-129 owns the endpoint**, MRQ-105 rebases onto it and drops those three scope lines (rewrites an in-flight ticket mid-implementation).
3. **MRQ-129 is scoped down** to "everything MRQ-105 does not own" — `GET /api/v1/events`, the copy engine, the event context sweep, the reset org-sweep, the popover list, ⌘K rows, CLI verbs — and takes `POST /api/v1/events` as a dependency.

Whichever is chosen, `lattice link` the two tickets and state the file-ownership contract in MRQ-129's description the way `eval-response-tickets.md` §4 states them for T-A/T-B/T-C.

---

### B2 · The design's entire archaeology is pinned to a tree main has moved far past

The design header says: *"Code truth: worktree `Marquee-worktrees/eval-triage-ro`, github/main @ `4b2dc09`."* `github/main` is at **`cd907d3`**. Between them: **34 commits, 258 files, +17,698 / −861 lines**, including MRQ-106 through MRQ-127. Concretely, on current main:

| Design claim | Reality on `cd907d3` |
|---|---|
| "`evt_aie-ny-2026` … in **16** runtime sites" (§1.4) | **18.** Two new: `src/ui/files/FilesPage.tsx:24` (MRQ-115) and `src/ui/speakers/SpeakersPage.tsx:11` (MRQ-111). Every cited line number has also shifted (FormsPage 188→265, DeliveryHealthPage 207→270, AppShell 178→183, SubmissionsPage 228→239, AgendaPage 20→22, SessionizeImportPage 67→69, OnboardingPage 9→11, SubmissionRecordPage 11→12). |
| "The sidebar 'switcher' is a plain `/dashboard` link dressed in switcher clothes (`Sidebar.tsx:11`, class `event-switcher`)" (§1.4, §2.6 "lives where the fake one sits") | **Gone.** MRQ-125 deliberately demoted it to `<div class="event-context">` with a comment: *"This is a caption, not a picker… When real multi-event lands, a genuine control replaces this element."* The `event-switcher` class no longer exists in `src/`. The prototype's CSS keys on `.event-switcher`. |
| "`AppShell({ eventName = "AIE NYC 2026" })` (AppShell.tsx:41, T-N1's target)" (§1.4); "eventName wired from the same object (absorbs T-N1's shell-name half — coordinate if T-N1 lands first)" (§2.7, ticket item 3) | **T-N1's shell-name half already shipped as MRQ-125.** Main has `export function AppShell({ eventName }: { eventName: string })` — already required — and `src/ui/app.tsx` has a `ShellEntry` wrapper calling `useEventName()` (`src/ui/shell/identity.tsx:82`) that feeds **both** `AppShell` and `DeliveryHealthShell`. `scripts/checks/check-shell-truth.mjs:10` already ships the forbidden-literal check for `"AIE NYC 2026"`. |
| Schema as described in §1.1/§2.3 | **Six migrations added after 0008:** `0009_criterion_kinds`, `0009_file_comments`, `0009_person_custom_fields`, `0010_bound_form_options`, `0010_evaluation_round_committees`, `0010_saved_embeds`. Three of them change tables in the copy set (B3, M8) and one adds an event-scoped table to the reset sweep. |
| "`cli/api-registry.json`" as a tracked artifact | Untracked since `e3cfce6` ("Stop tracking cli/api-registry.json: a build artifact does not belong in git"). |

**Amendment.** Re-pin the design's "code truth" line to `cd907d3`, correct §1.4 to 18 sites with current line numbers, delete the T-N1 coordination language and replace it with "extend `ShellEntry`/`useEventName` (already shipped by MRQ-125)", and re-run the §1 archaeology on the six new migrations before a delegator reads it. A delegator who trusts §1 as written will grep for a class that does not exist, count 16 props and miss two, and rebuild a name-wiring that already ships.

---

### B3 · A copied evaluation round carries `committee_id` into the new event — the exact cross-event authority leak the design says it is avoiding

`migrations/0010_evaluation_round_committees.sql` (MRQ-110, merged `cd907d3`):

```sql
ALTER TABLE evaluation_rounds ADD COLUMN committee_id TEXT REFERENCES committees(id);
```

The copy contract (§2.3) copies `evaluation_plans, evaluation_rounds, rubric_criteria` and states, in the same table, that committees **never** copy — with the rationale at §2.3: *"silently carrying reviewer authority across years is a scoping smell."* A row-faithful copy of `evaluation_rounds` does precisely that: the new event's round 1 points at the *source* event's committee. Consequences: (a) the new conference's reviewer pool is last year's committee, invisibly; (b) the FK dangles the moment the source event is deleted — which the reset now does, org-wide, by this ticket's own scope item 2.

The same class of bug lives one table down. `0009_criterion_kinds.sql` rebuilt `rubric_criteria` with four new columns (`kind`, `options`, `scale_min`, `scale_max`); `0010_saved_embeds.sql` added `name`/`enabled` to `embeds`; `0002/0003` added `lat`, `lng`, `access_minutes`, `access_note` to `buildings`. A hand-written column list in a copy engine is a defect generator — it silently drops whatever the next migration adds.

**Amendment.** Two explicit rules in the ticket:
1. **Named null-outs.** `evaluation_rounds.committee_id` → `NULL` on copy. State it as a rule, not an inference, and test it: *copying an eval plan whose round has a committee produces a round with `committee_id IS NULL`.*
2. **Copy by discovered columns, not by literal.** Derive the column list per table (`PRAGMA table_info` at build time, or a single declared per-table manifest with a test that asserts the manifest matches the live schema), so migration N+1 cannot silently stop copying a column. Every remapped or nulled column is declared once, in that manifest.

---

### B4 · `task_templates.form_id` is unremapped, and nulling it violates a CHECK

`migrations/0001_init.sql:578–596`:

```sql
CREATE TABLE task_templates (
  ...
  form_id TEXT REFERENCES forms(id),
  ...
  CHECK (kind <> 'form' OR form_id IS NOT NULL)
);
```

The design's remap list is *"rooms→buildings, form_fields→forms, criteria→rounds"* (§2.2, §2.3, ticket item 1). `task_templates.form_id → forms` is missing from all three. Both branches are broken:

- **Task templates + CFP forms both checked** → the copied template points at the *source* event's form. Every speaker task of kind `form` in next year's conference sends speakers to last year's form. Nothing in the schema objects: `form_id` has a plain single-column FK to `forms(id)`, with no `event_id` in the key, so cross-event pointing is legal at the database level.
- **Task templates checked, CFP forms unchecked** (a legal state — they are independent toggles in §2.6's checklist and in `prototypes/multi-event/index.html:265–271`) → nulling `form_id` makes the row violate `CHECK (kind <> 'form' OR form_id IS NOT NULL)`, and the whole `db.batch()` rolls back. The organizer gets a 500 on a checkbox combination the UI offered them.

**Amendment.** Add `task_templates.form_id → forms` to the remap list, and rule the dependent case explicitly. Recommended: **the CFP-forms set is a hard prerequisite of the task-templates set when any source template has `kind='form'`** — the checklist disables/auto-checks CFP forms with an inline reason, and the API rejects the combination with a 422 naming the offending templates rather than 500-ing on a CHECK. Test both branches.

---

### B5 · With two `demo_mode = 1` events, the demo-event oracle can resolve to the judge's empty conference

`src/routes/auth.routes.ts:390`:

```sql
SELECT * FROM events WHERE demo_mode = 1 ORDER BY created_at ASC LIMIT 1
```

Global — no `org_id` filter — and ordered by `created_at`. This one row feeds `demo_event_id` and `demo_event_name` on `/api/v1/auth/me` (`auth.routes.ts:303–304, 315–316`), which in turn feeds:

- the shell's conference caption (`useEventName`, `identity.tsx:93`),
- the CLI's default event when none is given (`cli/marquee.mjs:169`, and the bootstrap path at `:242`),
- **and this ticket's own selection precedence chain** — `?event=` → sessionStorage → localStorage → **`demo_event_id`** → first (§2.4, ticket item 3).

Scope item 1 makes every event created in the demo org `demo_mode = 1`. So the ordering now decides which conference the whole product considers "the demo". And the ordering is not safe:

`npm run seed` — the documented production seeding path (`DEPLOY.md:59`: `npm run seed -- --remote`) — stamps every row with `FROZEN_NOW` (`scripts/seed/index.ts:81`, `buildSeedRows(now = FROZEN_NOW)`; `scripts/seed/event.ts:16`, `FROZEN_NOW = Date.UTC(2026, 7, 20, 16, 0, 0, 0)` = **2026-08-20T16:00Z**), which is **eight days in the future** of today. An event created now carries `created_at = Date.now()`, which sorts **before** it. The judge's "Forward Summit 2028" becomes the demo event: the sidebar names it, the CLI targets it, new tabs boot into it, and every subsequent eval scenario — CFP-S2/S3/S4 and all of areas 02–07 — signs in to an empty workspace.

A UI reset masks it (`reseedDemo(db, now = Date.now(), …)`, `reseed-demo.ts:312–319`, stamps real wall-clock), which is why the standing "reset via the sidebar button before every run" discipline in `eval-response-tickets.md` §3 T-O happens to hide it. The failure is one forgotten reset away, in the most expensive place possible.

**Amendment.** Make the resolution deterministic rather than ordering-dependent, and say so in the ticket. Cheapest correct form: resolve the demo event by identity, not by age — `WHERE demo_mode = 1 AND org_id = ? ORDER BY created_at ASC` is still fragile; prefer resolving to the shipped demo event id when it exists and falling back to oldest only when it does not. Add a test: *with two `demo_mode=1` events where the created one has the earlier `created_at`, `/auth/me` still returns the seeded event.* This is a one-line query change that removes a whole class of catastrophic, invisible failure.

---

### B6 · The eval harness is currently instructed not to look for this feature

`.eval-kit/evalconfig.json`, `submissionNotes`, verbatim:

> "**MULTI-EVENT — NOT IMPLEMENTED IN THIS BUILD.** The shell shows the conference name as an affordance but does not switch conferences; /conferences/new returns the shared shell's 'Route not found' / 'This route is not installed' state, and no create-event UI is available. Creating or switching between conferences is genuinely absent; **do not spend turns hunting for it.**"

These notes are handed to the eval agent. Ship MRQ-129 without amending them and the agent is told, in the strongest terms the harness has, to skip CFP-S1 step 12 — which is the only scenario step CFP-17 and CFP-18 are scored from (`specs/01-call-for-papers.yaml:359, 367`). The entire ≈ +3.0 overall points that motivates this ticket evaporates on a stale config line.

`.eval-kit/` is third-party and gitignored, so this is not a repo change a delegator can make.

**Amendment.** Add an explicit **operator handoff** line to MRQ-129's AC: *"Before the next eval run, `.eval-kit/evalconfig.json` `submissionNotes` must be rewritten — delete the MULTI-EVENT paragraph and replace it with the real route and control names."* Track it as a `needs-human` item on the ticket, not as delegator work. While it is being rewritten, the same paragraph's `/conferences/new` sentence and the ROUTES list both need the new route added.

---

## MAJOR

### M1 · There is no authorization rule for `GET`/`POST /api/v1/events` — and the pipeline cannot express one the obvious way

`src/api/router.ts` `principalHasGrant`:

```ts
if (principal.kind === "token") {
  return eventId !== undefined && tokenHasGrant(principal, grant, eventId);
}
if (eventId === undefined) return false;
```

`eventId` comes from `context.req.param("eventId")`. A collection route has no `{eventId}` segment, so **any `auth: { kind: "grants" }` policy on `/api/v1/events` returns 403 for every caller, session and token alike.** The existing precedent for an org-scoped route is `src/routes/tokens.routes.ts:113` — `policy: { auth: { kind: "authenticated" } }` plus a hand-rolled guard (`requireTokenAdmin`, `:47–61`) that (a) rejects any non-session principal outright and (b) requires an org-wide (`event_id === null`) membership of `program_lead` or better.

The design specifies neither. Two consequences: the delegator will reach for `grants` and get a route that 403s everything; and if they copy `requireTokenAdmin` wholesale, **API tokens cannot list or create events at all** — which directly contradicts ticket scope item 5 (`marquee events list` / `events create`) and PHILOSOPHY's agent-native principle the design invokes at §2.2.

**Amendment.** Specify both routes' authorization in the ticket:
- `GET /api/v1/events` — `authenticated`; handler scopes to the principal's org, and for a token principal further intersects with `tokenEventAllowed` (`scope-resolution.ts:105–109`) so an event-restricted token sees only its events.
- `POST /api/v1/events` — `authenticated`; handler requires an **org-wide** membership of `program_lead` or better; state explicitly whether a token may create an event, and if yes, which grant gates it (`program:write` is the natural one, but note it is currently only ever checked against an eventId).
Test the token cases; they are the ones nobody exercises by hand.

### M2 · `POST /events` mints no membership for its creator

`roleForEvent` (`src/lib/auth/scope-resolution.ts:62–75`) grants a role on event B only from an org-wide membership (`event_id IS NULL`) or an event-scoped one for B. A program lead whose membership is scoped to event A creates event B and is immediately 403'd out of their own new conference. The demo path is masked by accident: the seed writes `organizationMembership(STAFF_PERSON_ID, "owner")` with `event_id: null` (`scripts/seed/evaluations.ts:37–50`) — so the judge is fine, and the design's §1.2 conclusion holds even though its citation does not (see m2). Self-hosted installs and MRQ-105's cold start are not fine.

**Amendment.** `POST /events` writes, in the same transaction, an `owner` membership for the creating person scoped to the new event, unless they already hold an org-wide staff membership. Test: an event-scoped `program_lead` who creates an event can immediately read its dashboard.

### M3 · The AC "no live mail can originate from the demo org" is false as written

`src/jobs/mail/consumer.ts:155`, inside `demoMailWouldBeSuppressed` (which is what `shouldSuppress` at `:164` delegates to):

```ts
if (sendPolicy === "always_live") return false;
```

The `always_live` short-circuit runs **before** `demo_mode` is read. `src/jobs/mail/outbox.ts:132` (`enqueuePublicFormConfirmation`) writes `send_policy = 'always_live'`, guarded only by "the address must match the one typed in this request". So a public-form confirmation from a `demo_mode = 1` event delivers live mail, today, on the seeded demo event. `demo_mode` inheritance does not close it.

This is not a new hole MRQ-129 opens — the copy contract's "forms arrive closed" (§2.3) means a created event has no open form until someone opens one, which is the real mitigation. But the ticket's AC states the false thing, and an AC that asserts a safety property the code does not have is worse than no AC.

**Amendment.** Rewrite the AC to what is true and verifiable: *"An event created in the demo org inherits `demo_mode = 1`; with no `event_settings` row its allowlist is the empty set, so every `demo_safe` message is suppressed (`consumer.ts:125–130`, verified). `always_live` senders (public-form confirmation, smoke harness) are unaffected by `demo_mode` by design — copied forms therefore arrive `closed`, and that is the containment."* Test the suppression path end-to-end on a created event with no `event_settings` row; state the `always_live` carve-out in the same test's comment so nobody "fixes" it later.

### M4 · The reset's R2 cleanup is not swept org-wide

`reseed-demo.ts:284`:

```ts
export async function deleteDemoObjects(media: R2Bucket, eventId = DEMO_EVENT_ID): Promise<number> {
  const prefix = "uploads/" + eventId + "/";
```

Called once, with the default, at `:318` — **before** the wipe/reseed batch, deliberately ("R2 cleanup is performed first and fails closed", `:307`). Turning the D1 deletes into org subqueries leaves every created event's `uploads/<newEventId>/` partition alive in R2 forever, with its `attachments` rows deleted — orphaned objects with no index. The scope item 2 sentence ("every `WHERE event_id = 'evt_aie-ny-2026'` becomes the org-subquery form") covers only the SQL half.

**Amendment.** Add to scope item 2: enumerate the demo org's event ids **before** the R2 sweep, delete each `uploads/<id>/` prefix, then run the batch. Note in the ticket that R2 and D1 are not atomic with each other (they already are not) and that an event created between the enumeration and the batch leaves objects behind — acceptable, but say so rather than discovering it. The nightly `runUploadOrphanSweep` (`src/lib/r2/orphan-sweep.ts`, cron `30 4 * * *`) is the backstop; confirm it is org-blind enough to catch these.

### M5 · `mirror_outbox`'s delete plan is scoped to one event id inside a JSON payload

`reseed-demo.ts:255–258`:

```sql
DELETE FROM mirror_outbox
WHERE json_extract(payload, '$.event_id') = ? OR json_extract(payload, '$.org_id') = ?
```

The design's §2.5 waves this away with *"org-scoped tables already delete by org"* — but `mirror_outbox` is neither event- nor org-columned; it is payload-JSON-scoped to the one seeded event id. Rows a created event produced survive the sweep. (`mirror_state` is deliberately global and must keep surviving — `reseed-demo.ts:75–77`.)

**Amendment.** Name `mirror_outbox` explicitly in scope item 2 with its subquery form (`json_extract(payload,'$.event_id') IN (SELECT id FROM events WHERE org_id = ?)`). Walk the `DELETE_PLANS` map table by table in the plan phase rather than pattern-matching on the literal — three of its 46 entries (`mirror_outbox`, `api_tokens`, `memberships`) are already not of the form the design's rewrite rule assumes.

### M6 · The `EventProvider` belongs in `ShellEntry`, not in `AppShell`

Ticket item 3 says "`EventProvider` in AppShell". On current main, `src/ui/app.tsx`:

```tsx
function ShellEntry({ health = false }: { health?: boolean }): JSX.Element {
  const eventName = useEventName() ?? "Conference";
  return health ? <DeliveryHealthShell eventName={eventName} /> : <AppShell eventName={eventName} />;
}
...
} else if (window.location.pathname === "/delivery-health") { render(<ShellEntry health />, root); }
else if (!isPublicPage) render(<ShellEntry />, root);
```

`/delivery-health` is a **separate render root** (an `external: true` sidebar row, `route-table.ts`), so a provider mounted inside `AppShell` never reaches `DeliveryHealthShell` — one of the 18 sites. And `AppShell` early-returns `PortalPage` / `CoSpeakerPage` / `ReviewerPage` before its own layout (`AppShell.tsx:124–126` on `4b2dc09`), so a provider mounted inside the layout also never reaches `ReviewerPage` — another of the 18. `ShellEntry` already wraps both roots and already owns the `useEventName` read; it is the correct seam, and MRQ-125 built it.

**Amendment.** Retarget ticket item 3 to `ShellEntry`, and say what a **reviewer or speaker seat** gets. `GET /api/v1/events` returns "events the caller can read" — for a reviewer with one event-scoped membership that is one event; for a speaker seat with no staff membership it may be **zero**, and `eventId: string` required has no value to take. Specify the zero-events and single-event behaviours (no switcher chrome, no create control, a defined `eventId` or an honest blocked state) rather than leaving a required prop with nothing to fill it.

### M7 · Stale selection after a reset is unspecified — and the reset ends in a reload

`AppShell.tsx:86`: `window.setTimeout(() => window.location.reload(), 250)` after the reset job reports done. The org-sweep deletes the created event; sessionStorage and localStorage still name it; the page reloads straight into the precedence chain, which takes the stored id at face value. Every subsequent request 403s or 404s under an event that no longer exists. The seeded event survives this by luck — its id is a deterministic slug (`seedId("evt","aie-ny-2026")`) and the reseed re-inserts the same id.

This is the judge's exact path if they reset after step 12, and the operator's exact path on every T-O run.

**Amendment.** Make validation part of the precedence rule in ticket item 3: *"each candidate is accepted only if it appears in the `GET /events` result; otherwise fall through to the next. A stored id that no longer resolves is cleared from both storages."* Test: with `sessionStorage` naming a deleted event, boot selects the demo event and clears the stale key.

### M8 · The copy sets are not independent — forms bind to formats and tracks by name

`migrations/0010_bound_form_options.sql` (MRQ-126) rewrote the seeded form fields to `config.source: "formats" | "tracks"`, and its own header explains why: *"The submit path resolves an answer under `format` / `tracks` back to a row in the formats / tracks tables BY NAME."* Copy the CFP-forms set with the Formats or Tracks set **unchecked** and the new event has a bound dropdown over an empty table — a form that renders with no options and cannot be submitted. §2.6's checklist and the prototype (`prototypes/multi-event/index.html:265–271`) present all seven sets as free, independent toggles.

The good news, verified: `form_fields.config` embeds **no ids** (only `source`, and `minItems` for tracks), and `form_fields.condition` references `fieldKey`, not field id (`src/lib/form-conditions.ts:27–36`). So no id remapping is needed inside either JSON blob — see m5.

**Amendment.** Declare the dependency in the ticket: *"CFP forms depends on Formats and Tracks when any copied field carries `config.source`. The checklist auto-checks and locks the prerequisites with an inline reason; the API returns 422 naming the bound fields rather than creating an unusable form."*

### M9 · Date-bearing rows do copy, contradicting "nothing date-bearing copies"

§2.3 closes with *"Dates are entered fresh; nothing date-bearing copies, so no date-shifting engine."* Three copy-set tables carry absolute epoch-millisecond timestamps:

- `forms.opens_at`, `forms.closes_at` (`0001_init.sql:223–224`) — last year's submission window on next year's form. The design says copied forms arrive closed, which makes the dates dormant rather than harmless: an organizer who flips a copied form to `open` inherits a `closes_at` in the past.
- `task_templates.due_at` (`:585`) — and it cannot simply be nulled: `CHECK ((due_at IS NULL) <> (due_offset_days IS NULL))` (`:592`) requires exactly one of the pair.
- `evaluation_rounds.opens_at`, `evaluation_rounds.closes_at` (`:453–454`).

**Amendment.** State the per-column rule in the copy manifest. Recommended: null `forms.opens_at`/`closes_at` and `evaluation_rounds.opens_at`/`closes_at` (all nullable, all safe); for `task_templates`, convert an absolute `due_at` to a `due_offset_days` derived from the source event's `starts_on`, or — simpler and honest — drop such templates from the copy with a per-set count of what was skipped, surfaced in the receipt. Either way, say which; do not leave it to the delegator, because the CHECK makes the naive answer illegal.

### M10 · The copied evaluation plan's status is unspecified

`evaluation_plans.status TEXT NOT NULL` (`0001_init.sql:436`) — **no CHECK**, so whatever the source carries travels. Forms get an explicit rule ("arrive closed/draft — never auto-live", §2.3); plans get none. A copied plan landing in whatever active state the source was in, with zero assignments and a nulled committee, is a live-looking evaluation surface over nothing.

**Amendment.** Give the plan the same explicit treatment as forms: name the status a copied plan arrives in, and test it.

### M11 · Two of the 18 sites are not component props, so the typechecker trick does not reach them

§2.7 step 2's whole argument is *"page components take `eventId: string` **required** … the typechecker then proves no page can render unscoped."* It holds for 16 of the 18. It does not hold for:

- `src/ui/venues/venue-writer.ts:4,8,13` — `DEFAULT_EVENT_ID` is a module constant used as a **default function parameter** on `loadVenueModel(eventId = DEFAULT_EVENT_ID)` and `saveVenueModel(model, eventId = DEFAULT_EVENT_ID)`. Making the parameter required is the same move, but it is a module API change with call sites in `VenuesPage` and `VenueMap`, not a prop drill.
- `src/ui/health/DeliveryHealthShell.tsx:22` — separate render root (M6).

Also note `src/ui/shell/QuickSearch.tsx:16` **already declares `eventId: string` required**; only its call site (`AppShell.tsx:183`) hardcodes the literal. That one is a single-line fix, not a migration.

**Amendment.** Enumerate the 18 sites in the ticket by current path and line, flag the two non-prop cases, and note that QuickSearch needs a call-site change only.

### M12 · The create form must not bounce the judge on required dates

CFP-S1 step 12 gives the agent a name and nothing else: *"create a second event named 'Forward Summit 2028'"*. The schema requires `starts_on`, `ends_on`, `timezone` — all `NOT NULL`, plus `CHECK (starts_on <= ends_on)` (`0001_init.sql:19–29`). Run 1 hit the **70-turn cap on all four CFP scenarios** (`evalconfig.json` `maxTurnsPerScenario: 70`; `eval-response-tickets.md` §1 rule 2), and step 12 is the last step of the longest one. A validation bounce on a date field costs turns the scenario does not have.

The prototype gets this right — `prototypes/multi-event/index.html:246–251` pre-fills start, end, and timezone. The ticket does not say so.

**Amendment.** Make it binding in the AC: *"the create form pre-fills starts/ends/timezone with sensible defaults and can be submitted with only a name changed; no required field is empty on first paint."* Same reasoning applies to the copy checklist — it must be pre-checked and skippable, never a required step.

### M13 · The switcher's "same geometry, nothing jumps" claim needs re-deriving against the caption that replaced the link

§2.6: *"the current block … same geometry as today, so nothing jumps."* "Today" is now `<div class="event-context">` — a caption with no border, no hover state, and different padding from the `<a class="event-switcher">` the prototype's CSS (`prototypes/multi-event/index.html:50–56`) styles. Promoting it back to a `<button aria-expanded>` with a caret changes its box. DESIGN.md's first craft rule and CLAUDE.md's UI rule both make this a hard constraint, not a nicety.

**Amendment.** Ticket item 4 should say: reconcile `.event-context` (current) against `.event-switcher` (prototype) and state which wins; assert the sidebar's first-nav-row offset is unchanged before and after.

### M14 · The sidebar's external links are event-blind

`route-table.ts` ships `{ id: "event-site", path: "/agenda", external: true }` and `{ id: "portal", path: "/portal", external: true }`. The public agenda resolves its event from `?event=<slug>` (`public.routes.ts:18,45`; `publicQuery.event`) and falls back to a default. On event B, "Conference site" opens event A's public agenda. CFP-18's criterion is *"submissions, sessions and speakers belonging to one event do not appear inside another event"* and the judge may well click it.

**Amendment.** The switcher must rewrite event-scoped external links with the current event's slug — the design's own §2.4 rule ("links the product itself mints carry `?event=`") already covers this; it just is not in the ticket's scope list. Add it to item 4.

---

## MINOR

- **m1 · Wrong org literal.** §2.5 writes `WHERE org_id = 'org_demo'` twice. `org_demo` is the **legacy seven-row test fixture** (`src/lib/reset-demo/demo-fixture.ts:22`, comment: *"intentionally not used by reseedDemo"*). The shipped demo org is `SHIPPED_DEMO_ORGANIZATION_ID = ORG_ID = seedId("org","aie-ny")` = **`org_aie-ny`**. A delegator copying the design verbatim writes a sweep that deletes nothing and a `demo_mode` inheritance rule that never fires. Use the exported constant, never a literal.
- **m2 · Wrong citation for the org-wide owner.** §1.2 cites `mem_demo_organizer_org` at `demo-fixture.ts:114–125` — again the legacy fixture. The shipped seed's row comes from `organizationMembership(ctx, STAFF_PERSON_ID, "owner")` at `scripts/seed/evaluations.ts:37–50`, id `mem_per-aie-program-committee-org-owner`. The conclusion (the demo organizer can administer any event in the org) is correct; the evidence is not.
- **m3 · The forbidden-literal check already exists.** Ticket item 6 asks for a new check in `scripts/checks/`. `scripts/checks/check-shell-truth.mjs:10` already ships `FORBIDDEN_LITERAL = ["AIE","NYC","2026"].join(" ")` with a path allowlist. Extend that file with `evt_aie-ny-2026` rather than adding a second scanner.
- **m4 · Registry drift is a build concern only.** `cli/api-registry.json` is untracked since `e3cfce6`; `check:api` regenerates and compares in-process (`scripts/checks/check-api.mjs`). New routes still need `check:api` to pass; there is no committed file to remember to update.
- **m5 · No remap needed inside form JSON.** Stated so nobody builds one: `form_fields.condition` keys on `fieldKey` (`src/lib/form-conditions.ts:27–36`), and `form_fields.config` carries `source`/`minItems`, no ids. `routing_rules` is in the never-copies list, so its `when_json`/`then_json` are out of scope.
- **m6 · D1 limits are already settled, and they are not the constraint.** MRQ-56's verdict (`spikes/s3-d1-chunking/VERDICT.md`) measured the cap at **100 bound parameters per statement** (101 → `too many SQL variables`), not per batch. Per-row inserts are far under it. `db.batch()` is atomic — `reseedDemo` already commits a full multi-hundred-row seed in one batch (`reseed-demo.ts:320`) — so a realistic copy (a few hundred statements) has direct precedent. The honest caveat the ticket should state: the **read** phase (SELECT the source rows) is not inside the write transaction, so a concurrent edit to the source event during a copy yields a copy of a slightly-earlier state. That is acceptable; say it rather than implying transactionality the design cannot deliver.
- **m7 · Layering.** The only runtime constant for "the demo org" lives in `src/lib/reset-demo/demo-fixture.ts`, which imports from `scripts/seed/`. An API route importing the demo-org id from `reset-demo/` to decide `demo_mode` inheritance is a smell worth naming in the plan — consider a small shared constants module.
- **m8 · `loadAuthMe()` is a module-memoized promise** (`identity.tsx:34–47`) — anything the provider derives from `/auth/me` will not refresh on switch or after a reset-reload without care. `EVENT_NAME_CHANGED` (`identity.tsx:10`) is the existing rename channel; reuse it rather than inventing a second one.
- **m9 · `uq_embeds_slug` is global, not event-scoped** (`0001_init.sql:936`). Embeds are in the never-copies list, so this is inert today. Note it so a later "also copy embeds" idea does not collide across the whole table.
- **m10 · The forms set carries people data.** `forms` copies bring `form_admins` (a `person_id` list) and `forms.admin_notify_person_ids` (a JSON array of person ids), plus `forms.password_hash`. Person ids stay valid because people are org-scoped, but "structure only" and "committees deliberately don't copy … silently carrying reviewer authority across years is a scoping smell" sit awkwardly next to silently carrying form-notification authority. Reconcile the contract's own words — either state that form admins travel deliberately, or drop them.

---

## NOTE

- **n1 · CFP-18 does not require data in event B.** The YAML pass criterion is *"The second event's submissions/abstracts area is **empty** (or contains only its own records) rather than showing the first event's submissions"* (`specs/01-call-for-papers.yaml:368`). Empty-shell zeros are sufficient — the judge does not need to create a submission in event B, and the ticket should not spend build or turns making that possible. §1.8's empty-shell audit is the right amount of work.
- **n2 · CFP-17's evidence is a screenshot of both events together** (`:361`). The flow must let the judge re-open the popover *after* landing on the new event's dashboard and see both rows at once. Do not auto-dismiss the popover on the post-create navigation, and keep both rows above the fold at the popover's designed width (264px in the prototype).
- **n3 · The reset already deletes every demo-org API token and session.** `reseed-demo.ts:235–238` (`DELETE FROM api_tokens WHERE org_id = ? OR event_id = ?`) and `:231–234` (auth_sessions by org). Pre-existing, not a multi-event regression — but a judge or operator who mints a token, resets, then gets a 401 will read it as one. One line in the ticket saves that diagnosis.
- **n4 · Name the abort-on-switch expectation.** `key={eventId}` remounts the page tree but does not cancel in-flight fetches. `QuickSearch` (`activeRequestRef`) and the submissions list already carry AbortControllers; state that switching aborts outstanding requests rather than relying on the remount to make late responses harmless.
- **n5 · Board hygiene.** MRQ-131 ("People — the org-level speaker record…") already `depends_on` MRQ-129 — good. MRQ-129 has no outgoing links; after B1 is ruled on, link it to MRQ-105. The T-M ↔ T-O contract from `eval-response-tickets.md` §4 rule 8 ("created events must be reset-sweepable — named in both tickets") is satisfied on this side and has no ticketed counterpart.

---

## What I checked and found clean

Stated so the delegator does not re-audit them:

- **The 18-site enumeration is otherwise exactly right** — no eventId consumer hides in `src/jobs/`, `src/routes/` SSR pages, or the public routes. `landing.route.tsx` hardcodes the conference *name* in three places (`:110, :181, :204, :294`) but takes no event id; that is T-N1 residue, out of MRQ-129's scope.
- **`/conferences/new` will survive a hard reload.** `wrangler.jsonc` `assets.not_found_handling: "single-page-application"`. It needs a `route-table.ts` entry for the shell's own matcher, not server work.
- **§1.8's empty-shell audit holds.** `event_settings` genuinely has no row for a new event and every reader tolerates it — most importantly `allowlistFor` returns an empty set (`consumer.ts:125–130`), which means suppress-all on a `demo_mode = 1` event. Verified.
- **§1.2's authorization claim holds in substance.** Org-wide memberships grant staff roles on every event in the org, reviewer memberships never inherit cross-event (`scope-resolution.ts:62–75`, schema CHECK at `0001_init.sql:159`), and `tokenEventAllowed` is already multi-event aware (`:105–109`).
- **The composite-FK story is real.** `tracks`/`buildings` carry `UNIQUE (id, event_id)` and `rooms` references the pair (`0001_init.sql:56, 69, 85`), `reviewer_track_scopes` likewise (`:498`). Fresh ids plus a rooms→buildings remap is the correct and sufficient handling for the venues set.
- **`file_comments` is already in `WIPE_ORDER`** on main — the reset is current with the new migrations; only the scoping predicate changes.
