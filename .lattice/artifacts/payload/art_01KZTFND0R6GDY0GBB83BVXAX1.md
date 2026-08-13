# Code Review: MRQ-113 — Portal invite control and speakers CSV

Branch reviewed: `mrq-113-invite-csv` @ `454ef81` (worktree `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-113-invite-csv`)

## 1. Verdict

**FAIL (implementation-level)**

## 2. Summary

Both halves of the ticket work in isolation — the organizer-authenticated invite route mints demo-safe magic links, stamps `participations.invited_at`, and writes outbox rows; the importer and its UI now accept a speakers-only manifest with an optional `external_ref`. The six new tests pass (`vitest run tests/integration/api/speaker-invites.MRQ-113.test.ts tests/integration/api/sessionize-import.AC-110-113.test.ts` → 6 passed, 2.65s).

The blocking finding is that the two halves do not compose, and the ticket said they must: **a speakers-only import produces a person who is invisible on every speaker surface and cannot be invited.** I verified this empirically against the real Worker (throwaway probe test, since removed): import run `200`, person row created, `memberships = 0`, `participations = 0`, `POST /speakers/invite` → **`404`**, onboarding snapshot does not contain the imported speaker. The ticket's explicit requirement — "Importer-created speakers must land visible" — is unmet, and the ticket's own new invite control is the surface that proves it. Secondary: the A-5 auth-boundary contract test is now silently bypassed by a rename, and bulk invite breaks at >100 selected speakers on a board that renders every speaker unpaginated.

## 3. Issues

**[CRITICAL] src/lib/sessionize-import.ts:454-525 (`importSpeaker`) — Speakers-only imports create orphaned people: not on the roster, not on onboarding, not invitable**

`importSpeaker` writes a `people` row and nothing else — no `memberships(role='speaker')`, and in speakers-only mode there are no sessions, so no `participations` either. Every speaker-facing surface reads one of those two tables:

- the new invite route (`src/routes/speaker-invites.routes.ts:50-64`) requires `memberships.role='speaker'` OR a participation on an event submission;
- the onboarding board and drawer (`src/routes/onboarding.queries.ts:394-397`, `:558-561`) select `FROM memberships … WHERE role = 'speaker'`.

Observed end-to-end on the branch: after a successful speakers-only import, inviting the created person returns `404 one or more speakers do not belong to this conference`, and the person never appears on `/onboarding` — which is the only surface carrying the new invite control. So the judge path "Import speakers → Invite to portal" dead-ends, and the ticket's stated requirement is not met.

The plan deferred this to MRQ-111, but MRQ-111's D1 does not cover it: its person source is `memberships ∪ participations`, and its plan asserts the UNION guarantees visibility "even via a creation path this ticket does not own (the Sessionize importer)" — an assumption that is false precisely for the speakers-only path MRQ-113 just created. Nobody owns the gap, and it was created here.

**Fix:** In `importSpeaker`, write a guarded event membership for the imported person — `INSERT INTO memberships (…, role) SELECT …, 'speaker' WHERE NOT EXISTS (SELECT 1 FROM memberships WHERE event_id = ? AND person_id = ? AND role = 'speaker')` — matching MRQ-111's guarded-bridge shape so the two writers converge rather than conflict. Note the coupling: `cleanupImportedPerson` (`src/lib/sessionize-import.ts:784-792`) refuses to delete a person while any membership row references them, so batch undo must delete the import-created membership first or the existing AC-110/AC-113 undo assertion (`people` row gone after undo) regresses. Add a test that asserts the imported speaker is invitable and appears in the onboarding snapshot — the current test asserts only that the `people` row exists, which is why the gap survived.

**[MAJOR] src/lib/auth/magic-links.ts:66-73 — `mintPortalMagicLink` is a byte-identical alias whose only effect is to evade the A-5 enumerated-writer guard**

`mintMagicLink` and `mintPortalMagicLink` both `return mintLink(db, input)` with the same arguments; there is no behavioral difference. `tests/node/auth-boundary.test.mjs:45,59-62` enumerates magic-link minting call sites by AST identifier name and asserts the exact file list `["src/routes/auth.routes.ts", "src/routes/public-form.routes.ts"]`. Because the new route calls the alias, a third minting site now exists and the guard still passes green. The plan's Cycle-1 note records this as a resolution ("routing organizer invites through the shared `mintPortalMagicLink` helper"), but the shared thing being routed through is the same function under a second name — the contract test no longer describes reality, and the next magic-link writer can be added the same way.

**Fix:** Delete `mintPortalMagicLink`, call `mintMagicLink` directly from `speaker-invites.routes.ts`, and add `"src/routes/speaker-invites.routes.ts"` to the enumerated list in `tests/node/auth-boundary.test.mjs:59-62`. That keeps the guard honest and documents the new writer where an auditor will look for it.

**[MAJOR] src/routes/speaker-invites.routes.ts:11 + src/ui/onboarding/OnboardingPage.tsx:288 — "Select all" on a real conference exceeds the 100-id cap and fails the whole invite with a raw validation error**

`person_ids` is capped at 100; the onboarding query has no `LIMIT` (`src/routes/onboarding.queries.ts`), so every accepted speaker renders and the header checkbox ("Select all visible speakers") can select them all. AIE NYC 2026 is well past 100 speakers. The UI passes the full selection straight through, so select-all → `400` → "Invitation failed: <zod message>", with nothing invited and no guidance. The route is also all-or-nothing on a single bad id (`:64`), so there is no partial-success reporting either — contrary to the plan's own self-review ("A partial invite response is honest only if each returned result identifies queued/duplicate state").

**Fix:** Chunk the selection client-side into ≤100-id requests and aggregate the results into the existing result slot, or raise the cap and batch server-side. Either way, surface a specific message ("Invite up to 100 speakers at a time — N selected") instead of a schema error.

**[MAJOR] src/routes/speaker-invites.routes.ts:75-110 — Fully sequential per-speaker writes; ~5 D1/queue round-trips × N, with no batching and no partial-failure record**

Each speaker costs a magic-link insert, an outbox idempotency lookup + insert, a queue send, and a `participations` UPDATE, all awaited serially. At the 100-id cap that is several hundred sequential subrequests in one request — slow enough to be a defect under R7, and close enough to Workers' subrequest ceiling to be worth caring about. Worse, a throw mid-loop (`:76-110`) surfaces a 500 while the first k speakers have already been invited and stamped, and the response reports none of them.

**Fix:** Batch the per-speaker statements with `env.DB.batch()` (used elsewhere in the codebase) and/or collect per-person `{queued|failed}` results instead of throwing, returning them in the existing `invites` array so the UI can report exactly who was invited.

**[MINOR] src/ui/import/SessionizeImportPage.tsx:137 — "Import speakers" button on the import page navigates to the import page**

`AppShell.tsx:122,165` renders `SessionizeImportPage` only at `/import`, so this header action is a no-op self-link. It also collides with the sidebar entry that was just renamed to the same label, so the operator sees "Import speakers" twice on a screen titled "Sessionize import".

**Fix:** Drop the action from this page (the onboarding entry point at `OnboardingPage.tsx:288` is the one the ticket asked for), and either retitle the page to "Import speakers" or leave the sidebar label as it was so page title and nav label agree.

**[MINOR] src/routes/speaker-invites.routes.ts:114 — Success copy claims "the demo-safe outbox" on live conferences**

The message is emitted unconditionally, but `src/jobs/mail/consumer.ts:147-150` only suppresses when `events.demo_mode = 1`; on a live conference the queue really does hand the message to the provider. The per-invite line ("delivery remains provider-controlled") is accurate; the headline is not.

**Fix:** Branch the message on `event.demo_mode`, e.g. "queued in the demo-safe outbox" vs "queued for delivery".

**[MINOR] src/routes/speaker-invites.routes.ts:19,107 — `outbox_inserted` is hard-coded `true` and can never report a duplicate**

The field is documented in the schema as the queued/duplicate fact, but `enqueueAuthMail` (`src/lib/auth/auth-mail.ts:17-42`) discards the `inserted` flag that `enqueueOutbox` returns, and `entityId` is the freshly minted `link.id`, so the idempotency key is unique on every call by construction. The field is decorative and mildly misleading — the OnboardingPage send path (`SendResponse.outbox_rows[].inserted`) sets the expectation that it means something.

**Fix:** Either thread `EnqueuedOutbox.inserted` through `enqueueAuthMail` and return the real value, or drop the field from the response schema.

**[MINOR] src/ui/onboarding/OnboardingPage.tsx:132 — Drawer invite result is neither height-reserved nor announced**

The page-level slot (`:289`) does this correctly: a persistent `.onboarding-invite-result-slot` with `min-height: 38px` and a live region that exists before it updates. The drawer version renders the `aria-live="polite"` container only after success — a live region inserted at the same time as its content is unreliably announced — and its appearance pushes the surrounding drawer content down, against the project's no-jumping-elements rule.

**Fix:** Mirror the page pattern: render a persistent, reserved-height `aria-live` container inside the drawer section and fill it on success/error.

**[MINOR] src/ui/onboarding/OnboardingPage.tsx:267-279 — Board is not refreshed after a successful invite**

`invited_at` and the new outbox row are written, but the snapshot is not refetched, so "Last contact" and the drawer's message history keep showing pre-invite state until a manual reload. The operator's own action appears not to have happened.

**Fix:** Re-run the snapshot fetch (and the drawer detail fetch) after a successful invite.

**[MINOR] tests/integration/api/speaker-invites.MRQ-113.test.ts:24-33 — The happy-path test invites twice and asserts the doubled artifacts; the demo-only branch is untested**

The endpoint is called once for the status assertion and again for the body, then the test asserts `outbox = 4` and `magic_links = 4`. Those constants encode the double call rather than per-invite behavior, so a regression that emitted two rows per invite would still pass. Separately, the fixture creates a `demo_mode = 0` event but never invites against it, so nothing verifies that `magic_link` is withheld outside demo mode — the one branch of this route where the wrong answer leaks a credential into an API response.

**Fix:** Call once, capture the response, assert 2 outbox rows and 2 magic links; add a case that invites a speaker on the non-demo event and asserts `magic_link` is absent while the outbox row is still written.

**[MINOR] tests/node/portal-invite-import.MRQ-113.test.mjs:16-24 — Source-regex assertions on exact code literals**

`assert.match(page, /const requiredSpeakers = \["name", "email"\]/)` and friends assert the literal text of an implementation line. They break on reformatting and pass on a control that renders but is wired to nothing. The repo does use source-shaped contract tests elsewhere, but those assert route paths, policies, and structural invariants — not the spelling of a local variable.

**Fix:** Keep the route/policy assertions (`:26-32`, which are genuine boundary contracts); replace the literal-line checks with the behavioral coverage that already exists in the integration tests, or with a check that survives formatting.

**[TRIVIAL] src/routes/speaker-invites.routes.ts:78 — Unreachable branch.** The `if (!speaker) throw ApiError.notFound("speaker not found")` inside the loop cannot fire: the length check at `:63-65` already guarantees every deduped id resolved. Drop it, or restructure to iterate `speakers.results` directly.

**[TRIVIAL] src/routes/speaker-invites.routes.ts:75 — `const invites = []` relies on evolving-array inference.** Give it the `z.infer<typeof inviteResult>[]` type so the response shape is checked at the push site rather than only at the `context.json` boundary.

## 4. Positive Observations

- **The authorization boundary is right.** The route uses `grants: ["program:write"]`, and the router resolves grants against the `eventId` path param via event membership (`src/api/router.ts:165-187`), so cross-org access is refused before the handler runs; the handler then re-scopes by `p.org_id` and requires event membership/participation. Public email lookup is correctly not used as authorization, exactly as the plan's self-review demanded. The negative test covering `401` unauthenticated and `404` cross-event with a before/after outbox count is a good shape — it proves refusal *without writes*, not just refusal.
- **`json_each(?)` over a bound JSON array** is the right call for a variable-length id set on D1 — no dynamic placeholder string, no injection surface, and it matches the pattern already used in `onboarding.queries.ts:412`.
- **The importer changes are minimal and non-destructive.** `sessions_csv` becomes optional through a single consistent `?? ""` at each read site; `readImportManifest` keeps a distinct error for a malformed sessions CSV versus a missing speakers CSV; the manifest omits the key entirely rather than storing an empty string, which keeps old manifests round-tripping. Existing sessions imports, idempotent matching, audit retention, and undo all still pass.
- **The speakers-only import test earns its keep** by asserting the full loop — upload preview shows zero session rows, `external_ref` is reported missing but not blocking, the run creates exactly one person, and batch undo removes them again.
- **The page-level invite result slot** reserves its height (`onboarding.css: .onboarding-invite-result-slot { min-height: 38px }`) and is a persistent `aria-live` region — the correct treatment under the no-jumping-elements rule, and the drawer should copy it.
- **The UI copy is honest about what is durable**: "outbox row … recorded; delivery remains provider-controlled" claims exactly the fact the system has, which is the right instinct for the manual-half evidence this ticket protects.
