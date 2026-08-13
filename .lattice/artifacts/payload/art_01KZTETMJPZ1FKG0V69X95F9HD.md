# Code Review — MRQ-113: Portal invite control and speakers CSV

Reviewed branch `mrq-113-invite-csv` @ `dd4c6d6` (worktree `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-113-invite-csv`).

> Suite not executed: one-minute load average was **178** at review time (project rule: wait below 24). All findings below are static plus one isolated Node execution of the real `parseCsv`/`csvRow` logic (Issue 1), which is deterministic and independent of machine load.

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the invite route is close to shippable, but the SPK-03 half does not work through the UI: the speakers-only import is blocked at the mapping step by an empty-CSV header artifact. That is the exact loop the ticket exists to deliver, and no test covers it because the UI coverage is source-regex only.

## 2. Summary

Reviewed the new organizer-authenticated invite route, the optional-`sessions_csv` importer changes, and the onboarding/import UI surfaces plus their tests. The invite route is well-scoped and matches the existing auth/outbox patterns closely (event-scoped grants, `entityId = link.id`, demo-only link disclosure), and the importer/manifest changes are clean and backward-compatible. The key finding: `parseCsv("")` returns `headers: [""]` — length 1 — so `SessionizeImportPage.tsx:84`'s `hasSessions` check is `true` for a speakers-only import, the required session fields register as missing, and the "Map, import, and review →" button stays disabled forever. Secondary findings: the auth-boundary contract test is defeated by a pass-through alias rather than amended, and the invite route reports two facts it never observed (`outbox_inserted: true`, "demo-safe outbox") while skipping the audit row every comparable organizer send writes.

## 3. Issues

**[CRITICAL] src/ui/import/SessionizeImportPage.tsx:84 — Speakers-only import is unreachable through the UI**

`parseCsv("")` pushes one empty row before shifting headers, so an absent sessions CSV yields `headers: [""]`, `rows: []`. Verified by executing the exact `csvRow`/`parseCsv` bodies from `src/lib/sessionize-import.ts:265-315` in isolation:

```
headers: [""] len: 1 rows: 0   →  hasSessions = true
```

Consequences for the speakers-only path this ticket adds:
- `hasSessions` is `true`, so `sessionPreview.missing` (which contains `external_ref`, `title`, `speaker_emails` — nothing can map against a single blank header) makes `hasMissing` `true`, and the primary button at line 148 is permanently `disabled`. There is no escape hatch: the mapping dropdowns are populated from `preview.headers`, whose only option is the blank column.
- The truthful note at line 147 (`sessionPreview.headers.length ? undefined : "No Sessions CSV supplied…"`) is gated on the same expression, so it never renders either.

The integration test passes because it drives the API directly (`/imports` → `/mapping` → `/run`), bypassing the gate; the Node test only greps source text. So the eval-kit fixture `speakers.csv` still cannot be imported by a judge clicking through the app — the failure mode the ticket was written to remove.

**Fix:** treat "no sessions CSV" as "no non-empty headers" in both places:
```ts
const hasSessions = Boolean(sessionPreview?.headers.some((header) => header.trim() !== ""));
```
and reuse the same predicate for the `MappingPanel` note on line 147. Better still, have `previewCsv` return `headers: []` for empty input (`parseCsv` could return `{headers: [], rows: []}` when `text.trim() === ""`), which fixes every consumer at once — but check `manifestPreview`/`mappedRows` callers if you take that route. Add a DOM-level or at minimum an API-shape assertion (`preview.sessions.headers` for a speakers-only upload) so this cannot regress silently.

---

**[MAJOR] src/lib/auth/magic-links.ts:66-73 — `mintPortalMagicLink` defeats the A-5 auth-boundary contract instead of amending it**

`mintPortalMagicLink` is a byte-for-byte pass-through to the same `mintLink`. Its only effect is on `tests/node/auth-boundary.test.mjs:59-62`, which asserts by AST that `mintMagicLink` call sites are exactly `auth.routes.ts` + `public-form.routes.ts` — i.e. that magic-link minting lives in a closed, reviewed set of files. This change adds a third minting call site (`speaker-invites.routes.ts:76`) while keeping the guard green by renaming the call. The plan's "Cycle 1 Resolutions" note describes this as "routing organizer invites through the shared `mintPortalMagicLink` helper over the canonical writer," but there is no separate writer to route over — the guard is measuring call sites, and the alias only hides one from it. A future reader of the contract test will believe there are two minting paths when there are three.

**Fix:** delete `mintPortalMagicLink`, call `mintMagicLink` directly in `speaker-invites.routes.ts`, and widen the contract explicitly:
```js
assert.deepEqual(magicMintCalls.map(({ file }) => file).sort(), [
  "src/routes/auth.routes.ts",
  "src/routes/public-form.routes.ts",
  "src/routes/speaker-invites.routes.ts",
]);
```
That is a reviewed widening of a security boundary, visible in the diff, which is what the guard is for.

---

**[MAJOR] src/routes/speaker-invites.routes.ts:107 — `outbox_inserted` is asserted, never observed**

`enqueueOutbox` returns `{ id, inserted, idempotencyKey }` (`src/jobs/mail/outbox.ts:27-30, 106-113`), and the comparable organizer send propagates it honestly (`src/routes/comms.routes.ts:717-731` maps `inserted: item.inserted` and counts `duplicate`). `enqueueAuthMail` drops the flag and returns only the id, and this route then hardcodes `outbox_inserted: true`. The field is a constant dressed as a fact — precisely the "report only durable facts" line the plan's self-review drew. It also means the plan's promised queued/duplicate distinction does not exist in the response.

**Fix:** either widen `enqueueAuthMail` to return `EnqueuedOutbox` (or `{ id, inserted }`) and pass the real value through, or drop the `outbox_inserted` field from the schema and the UI rather than shipping an always-true boolean.

---

**[MAJOR] src/routes/speaker-invites.routes.ts:114 — Success copy claims demo-safety for live conferences**

The message is unconditional: `"… queued in the demo-safe outbox."` But suppression is decided at delivery by `src/jobs/mail/consumer.ts:145-150` — `send_policy !== "always_live"` **and** `event.demo_mode === 1`. For a live conference (`demo_mode = 0`) the invite is really emailed, and the organizer is told the opposite. On a product whose philosophy is that the UI states only what is true, telling an operator a real send was demo-safe is the worst direction for this error to point.

**Fix:** branch on the event you already loaded:
```ts
message: event.demo_mode === 1
  ? `${invites.length} portal invitation${plural} queued in the demo-safe outbox.`
  : `${invites.length} portal invitation${plural} queued for delivery.`,
```

---

**[MAJOR] src/routes/speaker-invites.routes.ts:76-110 — No audit row for an organizer-initiated send that also mutates `participations`**

Each invite writes a `magic_links` row, an `outbox` row, and stamps `participations.invited_at` — durable speaker-record state — with no entry in the audit log. The analogous bulk send writes `submission.message_sent` audit statements with actor, request id, and outbox id (`src/routes/comms.routes.ts:732-753`), and `imports`/`portal`/`submission-record` routes follow the same convention. An organizer asking "who invited this speaker, and when?" has no answer.

**Fix:** collect `auditStatement(...)` rows (action e.g. `speaker.portal_invited`, entity `person`, `after: { outbox_id, magic_link_id, invited_at }`) and `await context.env.DB.batch(auditRows)` at the end, mirroring the comms path.

---

**[MAJOR] src/ui/import/SessionizeImportPage.tsx:137 — "Import speakers" header button navigates to the page it is already on**

`SessionizeImportPage` renders at `/import`; the new header action calls `navigate?.("/import")`. Clicking it does nothing — no navigation, no state reset, no feedback. The plan's discoverability requirement is already satisfied correctly by `OnboardingPage.tsx:288`, which is the speaker-facing surface; this second control is a dead affordance sitting next to a page still titled "Sessionize import" while the nav rail now says "Import speakers."

**Fix:** delete the action from this page (and reconcile the page title with the renamed route label, or leave the title and revert the rail rename — but the two should agree).

---

**[MAJOR] src/ui/onboarding/OnboardingPage.tsx:267-279 — Select-all can exceed the route's 100-id cap and surfaces a raw validation error**

`inviteBody` caps `person_ids` at 100 (`speaker-invites.routes.ts:11`), while the onboarding board returns rows unpaginated (no `LIMIT` in `src/routes/onboarding.queries.ts`) and `toggleAll` (line 257) selects every visible row in one click. At AIE-NYC scale that is one click to a 400, rendered as "Invitation failed: …" with no explanation of the cap or which speakers were affected.

**Fix:** chunk in `inviteSelected` (slices of 100, accumulate `invites`), or gate the control and say so: `Invite to portal (N)` disabled above the cap with copy naming it.

---

**[MINOR] src/routes/speaker-invites.routes.ts:75-110 — Sequential per-person writes; a mid-loop failure reports total failure after real sends**

Each iteration is ~4 sequential D1 round-trips plus a queue send (mint insert, outbox insert, queue, participations update) — up to ~400 statements for a 100-person batch, all serialized. More importantly, an error on person 60 throws a 500 while 59 invitations are already durably queued; the UI then says "Invitation failed," which is untrue for most of the batch. The plan explicitly called for per-person honest results.

**Fix:** wrap the per-person body in try/catch, record `{ person_id, status: "failed", reason }` in the results array, and return 200 with mixed outcomes (the UI already renders a per-item list). Batch the `participations` updates into a single `DB.batch` at the end to cut round-trips.

---

**[MINOR] src/routes/speaker-invites.routes.ts:112-118 — Response carrying raw magic-link tokens omits `Cache-Control: no-store`**

The existing magic-link route sets `context.header("Cache-Control", "no-store")` immediately before returning a body containing `magic_link` (`src/routes/auth.routes.ts:181-187`), and the router does not apply it globally (only `src/index.ts:111,130` set it, for `/health` and the validation hook). POST responses are rarely cached in practice, so this is hygiene rather than an active leak — but the deliberate precedent is one line away.

**Fix:** add `context.header("Cache-Control", "no-store");` before the `context.json(...)`.

---

**[MINOR] tests/node/portal-invite-import.MRQ-113.test.mjs:1-34 — Source-regex tests assert implementation text, not behavior**

Every assertion here is a regex over `.tsx`/`.ts` source (`/const requiredSpeakers = \["name", "email"\]/`, `/Sessions CSV <small>\(optional\)<\/small>/`). They pin the exact spelling of code that can be correct-looking and still broken — which is precisely what happened: all three tests pass against the branch, while the speakers-only import is unusable (Issue 1). They will also break on innocuous refactors (renaming a local, reordering an attribute). Note that `tests/node/auth-boundary.test.mjs` is a legitimate use of source inspection (it enforces a security *boundary* that no runtime test can express); asserting UI copy this way is not the same thing.

**Fix:** keep at most the route-policy assertions, and cover behavior instead — a component/DOM test that the primary button is enabled after a speakers-only upload, or an API-level assertion on `preview.sessions.headers`.

---

**[MINOR] tests/integration/api/speaker-invites.MRQ-113.test.ts:38-51 — The happy-path test invites twice to read one body, then asserts the doubled counts**

The first `expect(...).toBe(200)` discards its response and the endpoint is called again to read JSON, so the outbox/magic-link assertions land on `4` for a two-speaker invite. It works, but the `4` encodes an accident of test construction rather than an intended fact, and a reader cannot tell whether re-invitation is *supposed* to mint a second link. Repeat-invite semantics (new link each time, no outbox dedupe because `entityId = link.id` is fresh) are a real product decision and go untested as such.

**Fix:** call once, keep the response, assert `2`/`2`; add a separate test that names re-invitation behavior explicitly.

---

**[MINOR] src/routes/speaker-invites.routes.ts:42,48 — Redundant casts around already-validated input**

`context.req.valid("json") as z.infer<typeof inviteBody>` and `body.person_ids as string[]` re-assert types Zod has already produced. Casts here are noise, and if the schema ever changes they silence the error that would have caught it.

**Fix:** drop both casts.

## 4. Positive Observations

- **The invite route's resource boundary is right.** Authorization is the event membership/participation join, not the email lookup — the exact trap the plan's self-review flagged. Grants are event-scoped upstream (`src/api/router.ts:165-186`, `roleForEvent`), the `people` query is org-scoped via `event.org_id`, and the cross-event refusal is tested with a before/after outbox count proving no writes on rejection. That test is the best one in the diff.
- **`json_each(?)` for the bounded id set** is the correct D1 answer to dynamic `IN (...)` — parameterized, no placeholder-count classification needed, no injection surface.
- **The route mirrors the existing auth pattern faithfully** — `entityId: link.id` for outbox idempotency, `purpose: "login"` with `redirectTo: "/portal"`, demo-only link disclosure, queue enqueue after insert. Someone reading `auth.routes.ts:161-180` will recognize this immediately.
- **The importer changes are minimal and backward-compatible.** Optional `sessions_csv` threads through the manifest, R2 read-back, mapping normalization, and preview with `?? ""` at each boundary rather than a parallel code path, and `readImportManifest` keeps a distinct error for a malformed (as opposed to absent) sessions CSV. Existing sessions imports, idempotent matching, and undo are untouched.
- **The speakers-only integration test proves the full loop end to end** — upload → mapping → run → durable `people` row → undo removes it — including the `external_ref` mapping landing as `null`. That is the right shape of test for this change.
- **The UI reserves its result area.** `.onboarding-invite-result-slot { min-height: 38px }` plus the fixed-width header actions means the invite result appears without shifting the board — the house rule that elements never jump, honored without being asked.
- **Copy discipline in the drawer** — "Outbox row … recorded; delivery remains provider-controlled" claims exactly what the system knows and nothing more. The unconditional "demo-safe" in the API message (Issue 4) is the one place that slips.
