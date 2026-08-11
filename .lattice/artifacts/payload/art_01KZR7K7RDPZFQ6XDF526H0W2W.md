# MRQ-53 self-review

Reviewed commit: `1e238804c961ea4d5e856a434d9bbf87dcae0304` (branch HEAD)

Verdict: PASS (the audit diff is scoped, public-safe, and the required machine guard passes). Product findings below remain routed findings; this ticket intentionally does not fix the code it audits.

## Product findings

### FAIL-1 — reset restores the six-row demo stub, not the authoritative seeded demo

Owner: MRQ-3 / M-03. Source: `src/lib/reset-demo/reseed-demo.ts:1,73-83`, which deletes every table and inserts `demoFixtureRows`; `src/lib/reset-demo/demo-fixture.ts:1-5,21-101` defines only one event, two people, and two memberships. The authoritative local seed baseline was `evt_aie-ny-2026` with 1,000 submissions, 25 agenda items, 324 speaker tasks, 60 evaluations, 159 memberships, and 1,101 people.

Reproduction against the real local Wrangler Worker:

1. Start from the real `scripts/seed/index.ts` baseline. The measured full vector was: `submission_decisions=680, submission_answers=0, submission_tracks=1153, participations=1025, evaluations=60, comparisons=0, round_assignments=200, round_promotions=0, rubric_criteria=3, evaluation_rounds=2, evaluation_plans=1, committee_members=3, committees=1, reviewer_track_scopes=32, saved_views=0, audit_log=0, calendar_invites=0, speaker_tasks=324, task_templates=6, agenda_items=25, embeds=0, import_rows=0, imports=0, submissions=1000, form_admins=0, form_fields=19, forms=2, email_templates=0, outbox=0, routing_rules=0, waves=3, rooms=10, buildings=3, tracks=8, formats=4, magic_links=0, auth_sessions=0, api_tokens=0, memberships=159, people=1101, attachments=0, event_settings=0, mirror_outbox=0, mirror_state=0, events=1, organizations=1`.
2. Mutate through the real API paths: bulk accept 2 and reject 1, complete a speaker task, place and publish an agenda item, enqueue a reminder, create a saved view, run an import, create an API-token row for table coverage, promote a round, complete a valid attachment, and add a non-demo organization/event. Dirty vector deltas were decisions `680→683`, round promotions `0→1`, saved views `0→1`, audit log `0→7`, speaker tasks `324→328`, agenda items `25→26`, import rows `0→2`, imports `0→1`, outbox `0→4`, auth sessions `0→2`, API tokens `0→1`, people `1101→1102`, attachments `0→1`, events `1→2`, organizations `1→2`.
3. Run `npm run reset:demo`; it reported queued then done in 1.078s. The post-reset vector was zero for every reset-owned table except `memberships=2`, `people=2`, `events=1`, and `organizations=1`. The event was `evt_demo`, not `evt_aie-ny-2026`; the exact vector did not equal the baseline.
4. Run `npm run reset:demo` immediately again; it reported done in 1.056s and produced the same minimal vector. A new demo login succeeds, but it logs into `evt_demo` and the old organizer cookie returns HTTP 401. This is a dead end for the next judge and breaks the active judge's session.

### FAIL-2 — reset deletes attachment rows without deleting their R2 objects

Owner: MRQ-3 / M-03 reset lifecycle, with the object lifecycle boundary shared with MRQ-14 / M-13. Source: `src/lib/reset-demo/reseed-demo.ts:49,73-78` deletes `attachments` as D1 rows but performs no `MEDIA.delete`; `src/lib/reset-demo/reset-consumer.ts:24-29` only reseeds D1 and sends mirror reconcile.

Reproduction: sign and complete a valid 13,209,034-byte PDF task upload; the dirty vector records `attachments=1` and the R2 key is present. After each of the two resets, `attachments=0` while probing that same key reports present in both local R2 namespaces. The database no longer has an owner row, so the object is orphaned and can never be reached by the reset's D1 inventory.

### FAIL-3 — the global wipe removes tenants outside the demo event

Owner: MRQ-3 / M-03. Source: `src/lib/reset-demo/reseed-demo.ts:4-6,75` documents and performs a whole-database wipe; the route gate at `src/routes/admin-ops.routes.ts:53-68` only checks that any `demo_mode=1` event exists and does not scope deletion to that event or organization.

Reproduction: before reset insert `org_foreign` plus `evt_foreign` with `demo_mode=0`. The pre-reset query returns both `evt_aie-ny-2026` and `evt_foreign`; after each reset both the foreign event and foreign organization are gone. This is a destructive cross-tenant wipe whenever a demo event coexists with another tenant.

### FAIL-4 — the product Reset demo control is a dead path

Owner: MRQ-3 / M-03. Source: `src/ui/shell/Sidebar.tsx:17-20`; line 19 calls `unavailable(...)` and never calls the reset route.

Reproduction: log in as organizer in the rendered admin shell, find the sole `Reset demo` button, and click it. The browser request trace contains zero URLs matching `reset-demo`; the page instead shows `The reset endpoint lands with the seeded demo lifecycle.` and `This shell affordance is ready; its owning module has not landed yet.`

## Explicit non-findings and side-effect checks

- Dirty states created and compared: submission decisions, completed speaker task, agenda placement/publication, saved view, import/import rows, reminder/outbox, API-token row, round promotion, ready attachment, auth sessions, audit log, people, plus a foreign event/organization. Every migration-defined table was included in the count vector; zero-valued tables were still queried, not inferred from a total.
- No standalone webhook table exists in the current migration schema (`sqlite_master` query returned `[]`), so there was no webhook row to create. The schema guard below will catch a future webhook table if a migration adds one.
- After reset, `outbox=0` and `mirror_outbox=0`; the source path and existing integration assertion show one `mirror_reconcile` send after the D1 batch (`src/lib/reset-demo/reset-consumer.ts:24-29`, `tests/integration/reset-demo.test.ts:71-75`). The local poller observed the old public/dashboard state repeatedly, then the post-reset `agenda.sessions=0` and old dashboard cookie HTTP 401; no partial D1 vector was observed, but the new state was the wrong fixture.
- The real full seed check passed before the drill. The reset result itself proves that a subsequent seed gate would fail because the AIE event and all full-seed rows are gone.

## Audit artifacts and verification

- `tests/node/reset-wipe-order.test.mjs` parses every migration `CREATE TABLE`, rejects duplicates, and asserts exact set equality with `WIPE_ORDER`, keyed on table names rather than coordinates.
- `tests/ac-claims/MRQ-53.json` declares `owns: []` and records that MRQ-53 exercises AC-230 owned by MRQ-3.
- `npm test`: PASS; 33 files / 186 tests, 17.090s reported, under the 30s budget.
- `npm run trace:ac -- --ticket MRQ-53`: PASS; merged scope, 0 uncovered, 0 errors.
- The full local runtime drill ran against Wrangler/miniflare with the real seed and real command script. It is local evidence only; no deployed or production claim is made.
- No product code was fixed. Only the plan, the schema coverage guard, and the explicit AC-claim manifest are in the branch diff.
