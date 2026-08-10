# Plan Review: MRQ-3

### 1. Verdict

**FAIL (plan-level)**

### 2. Summary

This plan is unusually well-grounded — I verified it against the actual `migrations/0001_init.sql` schema, `src/db/schema.ts`, `src/lib/cookies.ts`, `wrangler.jsonc`, `src/index.ts`, `tests/setup.ts`, `tests/ac-claims/MRQ-6.json`, and the BUILDPLAN/SPEC/EVALUATION cross-references, and nearly every specific claim (unique indexes, CHECK constraints, queue/KV bindings, cron list, cookie helper, `check:design`, the `reset:demo` stub) checks out exactly as described. The core design (race-free magic-link consumption, fail-closed demo gating, atomic `db.batch()` reseed, single mirror-reconcile enqueue) is sound and correctly cites the guardrails it serves. Two concrete gaps are significant enough to send back: the plan's test list never asserts AC-230/G12's explicit **≤20s observable-restore budget**, a named audit requirement this ticket owns outright (A-11), and the scope-resolution design doesn't say how `roleFor(eventId)` should treat **org-wide (`event_id IS NULL`) membership rows**, which the schema explicitly supports for every role except `reviewer` and which directly gates the reset-demo/demo-login authorization this ticket's audit (A-5) is built to prove.

### 3. Issues

```
**[MAJOR] Design decision #4 (Scope resolution) — org-wide membership rows aren't accounted for**
`memberships` supports event-scoped AND org-wide rows for every role except `reviewer`
(`uq_memberships_org ON memberships(org_id, person_id, role) WHERE event_id IS NULL` in
migrations/0001_init.sql:758-760). The plan's scope-resolution description only specifies the
reviewer-specific per-event CHECK enforcement ("roleFor(eventId) returns null for any other
event") and is silent on how an org-wide owner/program_lead/ops/speaker row should resolve
against a specific eventId. This isn't academic: it directly gates
`POST /api/v1/admin/reset-demo`'s "requires a session with owner/program_lead on that event"
check (design decision #7) and the demo-login role mapping (#6) — both guardrail G6/A-5
surfaces this ticket's own audit targets. Left unspecified, an implementer could resolve it
either way with real fail-open/fail-closed consequences, and the demo-fixture module (#7)
that this same ticket writes needs to know which shape of membership row to create for it to
even authenticate correctly.
**Recommendation:** Add one sentence to design decision #4 stating whether `roleFor(eventId)`
queries `event_id = ? OR event_id IS NULL` (org-wide counts everywhere) or `event_id = ?` only
(org-wide rows are out of scope for this ticket, single-event-per-org is assumed for the demo
fixture) — and make the demo-fixture's membership rows (step 7) consistent with that choice.

**[MAJOR] Validation plan / Tests §10 — AC-230's ≤20s budget is untested**
SPEC.md §4.1 and guardrail G12 (SPEC.md:586) are explicit: "`npm run reset:demo` (and the
in-product button) ≤20 s ... AC-230's ≤20 s budget is about the observable restore, not a
single invocation" — and A-11 (this ticket's own audit) is literally named "Reset drill
(AC-230)". The plan's `reset-demo.test.ts` list (idempotence, exact counts, zero
`mirror_outbox` rows, one reconcile enqueue, 403 at demo_mode=0, job-poll-to-done) and the
curl-based validation plan never assert a wall-clock bound on the observable restore (job
enqueue → poll returns "done", or fixture-visible-in-reads). This is a named, testable
acceptance criterion for this exact ticket, not an implicit one.
**Recommendation:** Add a timing assertion to `reset-demo.test.ts` (start timer at POST,
stop at first poll returning `done` or at first read reflecting the reset fixture, assert
< 20s) and/or note it explicitly in the validation plan's curl sequence.
```

```
**[MODERATE] Deviation D1 / design decision #7 — "MRQ-14" is not the seed-generator ticket**
D1 and design decision #7 both say "the authoritative full-seed fingerprint remains MRQ-14's."
Per the Lattice task registry, MRQ-14 is `BUILDPLAN: M-13` — the uploads/presigned-R2-PUT
ticket — not the seed generator. BUILDPLAN's actual seed-generator tickets are M-04a/M-04b,
i.e. **MRQ-4** and **MRQ-5** ("`scripts/seed/` ... `reset:demo` calls it," BUILDPLAN.md:49).
This mislabel already exists in the pre-existing stub
(`"reset:demo": "node scripts/checks/stub-command.mjs reset:demo MRQ-14 ..."`), so the plan is
propagating a prior error rather than introducing a new one — but it's about to get baked into
this ticket's completion comment and design docs, which is exactly how a wrong pointer
compounds. Left uncorrected, whoever picks up "the authoritative full seed" later will go
looking at an uploads ticket and find nothing relevant.
**Recommendation:** Correct the citation to MRQ-4/MRQ-5 (M-04a/M-04b) in both D1 and design
decision #7, and consider noting the stub script's existing MRQ-14 reference is stale too.

**[MODERATE] AC-claims (§10) — AC-2's "owns" claim doesn't distinguish the e2e half**
EVALUATION.md's AC-2 definition (line 131) has two parts: a `test:` clause (403 + no cookie
at demo_mode=0 — squarely this ticket) and an `e2e:` clause (both demo entries clickable from
a fresh context, landing screen shows non-zero counts, no empty-state reachable — which needs
the landing page, `src/routes/landing.route.tsx`, owned by M-05b/MRQ-7 and outside this
ticket's file surface). The plan already applies exactly this owns/exercises split correctly
to AC-1 ("AC-1 is `felt`; its e2e belongs to M-05b's landing page") but claims AC-2 as fully
`owns` without the same qualification, even though AC-2 is listed under both M-03 and M-05b in
BUILDPLAN just like AC-1 was.
**Recommendation:** Either split AC-2 the same way as AC-1 (`owns` the `test:` fail-closed
assertion, `exercises` the `e2e:` walkthrough portion) or state explicitly in the completion
comment why full ownership is correct here despite the landing-page dependency.
```

### 4. Positive Observations

- Every concrete technical claim I could check against the codebase was accurate: `uq_magic_links_token_hash`, `uq_api_tokens_token_hash`, the `memberships` reviewer-only CHECK constraint, the four-queue/KV/D1 bindings, the three existing crons (none touching reset), `setSessionCookie`'s no-`Domain` cookie options, the `LOCAL_VALIDATION_TOKEN`/`x-marquee-local-validation` pattern from MRQ-1's skeleton, `tests/ac-claims/*.json`'s actual schema, and the `check:design` script — this plan was clearly written against the real repo state, not from memory.
- The magic-link consumption design (atomic `UPDATE ... WHERE used_at IS NULL AND expires_at > ?` checked via `meta.changes`) is exactly the race-free pattern the single-use requirement needs, and the same-origin `redirect_to` restriction correctly closes an open-redirect vector nobody asked for but the SPEC implies.
- The fail-closed demo-mode gating (`POST /api/v1/auth/demo` and `POST /admin/reset-demo` both 403 with no cookie/session when `demo_mode != 1`) is described and tested exactly to G6/SPEC.md §4.1's letter, including the "no cookie set" half that's easy to drop.
- Deviation D4 (remote `npm run reset:demo` auth deferred to MRQ-57) is not just plausible — I confirmed MRQ-57 exists and is exactly the "no Cloudflare account this run" carve-out it's cited as. Good cross-ticket awareness.
- The reseed's single `db.batch()` transaction for AC-230's "never partially reset" requirement, plus the `suppress_mirror`/single-reconcile-enqueue design for §3.9, is the right shape for D1's transaction model and correctly avoids re-queuing the entire Airtable base.
