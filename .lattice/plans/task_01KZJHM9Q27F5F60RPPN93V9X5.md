# MRQ-25: Calendar invites and the un-accept cascade

BUILDPLAN: M-24 (Tier B rank 2, US-47) + M-33 (Tier B rank 14, US-36) — Wave 2 (§5) · MERGED at mint (5 h + 5 h = 10 h, at the cap; same ICS module — M-33's calendar cancellation is literally M-24's `METHOD:CANCEL` path, and splitting them puts one `UID`/`SEQUENCE` lifecycle across two PRs. M-33's second dependency, M-19a, is a Wave 1 ticket and is green before this band opens.)

**M-24 — Calendar invites** *(written against S-2's verdict, which returned at D+2)* (5 h, ACs AC-95 – AC-97, deps M-11/S-2)
Scope (verbatim): ICS builder (`METHOD:REQUEST`, `ATTENDEE;RSVP=TRUE`, stable `UID`, `SEQUENCE`, `DTSTAMP`, `VTIMEZONE`+`TZID`, CRLF folding), `multipart/alternative` calendar part, `METHOD:CANCEL`, Add-to-Google and Add-to-Outlook links, `/i/{uid}.ics`, single-send path at ≤10/s.
Trap 14: the Resend **batch endpoint carries no attachments** — anything with an ICS goes single-send at ≤10/s. Both paths exist from M-11's first commit.
Amendment 11 fold (SPEC.md): ICS `LOCATION` renders "Room · Building" (AC-252).

**M-33 — Un-accept cascade** (5 h, ACs AC-121 – AC-124, deps M-24/M-19a)
Scope (verbatim): attributed reversal; agenda/public removal; dependent tasks/mail/invites choices; calendar cancellation.
AC-123: the reversal dialog enumerates portal tasks, scheduled emails, and calendar invites, each with cancel/retain, and honours the choice.

ACs (union): AC-95 – AC-97, AC-121 – AC-124 · **AC-252** (ICS `LOCATION`)
Hours: 10 (5 + 5)
Workflow: sub-agent-full (≥7 h combined)
Shared files: none — module-local ICS/cascade modules.
Deps: M-11, S-2, M-19a
Oracle: AC-95, AC-97, and AC-124 are settled by `oracle: smoke:ics` — Gmail (mandatory), Outlook, Apple Calendar must show Accept/Decline, a `SEQUENCE+1` must **replace** rather than duplicate, and a `CANCEL` must remove. Golden-file `test:` assertions run every build regardless.
Plan: filled in by delegator's plan phase

## Delegator plan — MRQ-25

### Baseline and binding decisions

- Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-25-calendar`; branch `mrq-25-calendar`.
- Phase-base checkpoint: `forgejo/master @ 394b63242f385baa4eec9ca570c4662d2e7dd843` after a clean rebase and `npm ci`.
- The S-2 verdict is intentionally treated as half-returned. The implementation will make no claim about Gmail, Outlook, or Apple Calendar rendering. It will implement RFC 5545/iTIP RFC 5546 wire semantics and put every client-only question in the PR's operator-oracle checklist.
- Normal invite and cancellation mail remains `demo_safe` through the existing outbox. No third `always_live` write site will be introduced.
- Plain mail keeps the Resend batch path. Any row carrying ICS uses the existing sequential single-send path, with the existing 100 ms pacing (at most 10 sends/second). The PR will name each call site's path.
- Request, update, and cancellation share one persisted UID and advance sequence `0 -> 1 -> 2`; cancellation is not a new event.
- Reversal extends `src/jobs/cascade/decisions.ts` and its sole `insertDecisions` writer. It will not add a second decision-writing path.

### Implementation stages

1. **Calendar wire and persistence.** Add a pure calendar module that builds request/update/cancel ICS with stable UID, sequence, DTSTAMP, ORGANIZER, the required attendee parameters, embedded `VTIMEZONE`/`TZID`, RFC-safe text escaping, UTF-8-aware 75-octet CRLF folding, and exact CRLF output. Use `roomDisplayLabel` for `LOCATION` so public ICS contains `Room · Building` and never operator-only access or AV fields. Add the Google and Outlook links plus the stable `/i/{uid}.ics` URL to the message material. Keep a MIME/multipart-alternative representation with exactly one `text/calendar; method=<METHOD>` part as a pure, byte-testable builder; the Resend transport continues to use the supported single-send attachment field.
2. **Invite/update/cancel orchestration.** Add the admin invite route as a `*.routes.ts` module so it is included by the generated API manifest/OpenAPI document. Load the event, submission/person, agenda timing, room, and building; atomically create or update `calendar_invites`; enqueue the request/update/cancel through the normal `demo_safe` outbox; and expose `GET /i/:uid.ics` from the application route stack to serve the latest persisted calendar body. Ensure resends and material updates increment the same row's sequence and cancellation increments it again while preserving UID.
3. **Reversal and task lifecycle.** Add the nullable task cancellation tombstone migration and update migration fixtures/schema verification plus active-task queries. In the existing cascade decision module, centralize idempotent task reconciliation/restoration, record-level reversal, audit, agenda/public removal, scheduled-mail suppression, and calendar cancellation. Cancel only open task rows (retain completed rows byte-for-byte); the retain branch leaves dependent rows untouched. Reacceptance clears cancellation on matching open tasks without changing due dates and uses the same reconciliation function for every acceptance path.
4. **Reversal API and UI.** Add a `*.routes.ts` reversal preview/action endpoint and wire the submission detail route to a real reversal dialog. The dialog will enumerate portal tasks, scheduled emails, and calendar invites with independent **Cancel open tasks**/**Keep tasks active**-style cancel/retain choices. The response and UI assertions will inspect row-level effects (retained rows remain retained; canceled rows are actually tombstoned/suppressed/canceled), not only control state.
5. **Evidence.** Add AC-tagged tests under `tests/` covering byte-level ICS, CRLF folding, MIME structure, location privacy, request/update/cancel UID-sequence triplet, single-vs-batch delivery, public ICS serving, reversal cancel/retain behavior, agenda removal, task tombstones/reconciliation, and idempotence. Add `tests/ac-claims/MRQ-25.json` for AC-95–AC-97, AC-121–AC-124, and AC-252. Tests will not assert unobserved client rendering.

### Review and validation gates

- Self-review the final diff inline, naming the exact HEAD and checking scope, SQL/transaction behavior, access control, route-manifest/OpenAPI reachability, no public operator data, UID/sequence reuse, and both Resend paths.
- Run the focused AC-tagged tests, `npm test`, `npm run check:api`, `npm run trace:ac -- --scope=all`, and `npm run pr-gate -- --ticket MRQ-25`. If a rebase occurs, run `npm ci` before interpreting test failures.
- Before opening the PR, push the first and every meaningful commit to Forgejo, fetch and verify exact branch HEAD, then create the PR against `master`.
- PR assumptions pending the S-2 oracle, each with rationale and falsifier: RFC iTIP same-UID/sequence+1 cancellation reconciles clients; the required attendee parameters and embedded New York VTIMEZONE produce RSVP controls; the Resend single-send calendar representation reaches clients as a calendar invite; the stable URL remains resolvable. The PR will separately list operator-only Gmail, Outlook, and Apple inbox checks for RSVP controls, in-place update/no duplicate, and cancellation removal.
