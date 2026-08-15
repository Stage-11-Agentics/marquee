# Code Review: MRQ-168 — Speaker-uploaded files reachable by permanent unauthenticated links

**Note on inputs:** the diff embedded in the review prompt (edits to `sequence/auto-eval/prompts/coordinator.md` and `implementer.md`) does not match this ticket — those files add a `--cwd` footgun fix to the auto-eval harness and are unrelated to media links. I located the actual MRQ-168 work instead: branch `mrq-168-media-links`, commit `4d4730c7` ("fix(media): bound and revoke uploaded file links"), which is open as PR #189 ("Fix permanent unauthenticated media links"). This review covers that commit/PR, not the diff pasted into the prompt.

## 1. Verdict

**FAIL (implementation-level)** — The signing/expiry mechanism and the shape of the fix are sound and well-tested. But the revocation check for `person_headshot` attachments — one of the two examples named in the ticket's own problem statement — never inspects the owning submission's status, so a speaker whose sole submission is rejected or withdrawn (the ordinary way a person's involvement with a conference ends) keeps a live, re-mintable media link indefinitely. This is inconsistent with how the same function handles `submission_file`, is not covered by any test, and leaves acceptance criterion #2 unmet for that owner type.

## 2. Summary

Reviewed commit `4d4730c7` (PR #189) against MRQ-168's plan and acceptance criteria. The implementation replaces stable capability URLs with 15-minute HMAC-signed URLs (`src/lib/r2/media-links.ts`), re-verifies signature + expiry + a fresh DB-backed "is this attachment still owned by an active relationship" check on every fetch, updates `link_policy` and OpenAPI text to be truthful, and preserves origin isolation, `Content-Disposition: attachment`, and `nosniff`. Full test suite (215 tests) and `tsc --noEmit` are clean, and the three new MRQ-168 contract tests pass. The one substantive gap is the `person_headshot` branch of `mediaAttachmentIsActive`, detailed below.

## 3. Issues

```
**[MAJOR] src/lib/r2/media-links.ts:111-138 — Headshot revocation check ignores submission status, so a rejected/withdrawn speaker's headshot link stays live**
The `person_headshot` branch determines "active" purely from
`participations.confirmation_status <> 'declined'`; it never inspects
`submissions.status`. Compare this to the `submission_file` branch three cases
below it (line 140-145), which correctly does
`submission.status !== "withdrawn" && submission.status !== "rejected"`.

Concretely: `writeAcceptanceReversal` (src/jobs/cascade/decisions.ts:707-750)
only ever updates `submissions.status`; it never touches
`participations.confirmation_status` (grep confirms no writer sets
confirmation_status anywhere in the reversal path). So when an organizer
rejects or withdraws a speaker's only submission at an event — the single
most common way a person's involvement with a conference actually ends — the
speaker's headshot capability link is never invalidated: `active` stays true
forever because `confirmation_status` was never touched, and a fresh
signed URL keeps being minted on every read (`listVersionsFor` /
`getOnboardingSpeaker` / `listSpeakerFiles`).

This directly contradicts the ticket's own framing ("Removing the person from
the event... does nothing to a URL already in someone's hand" was the
motivating defect) and acceptance criterion #2 ("Revoking a person's
participation... invalidates outstanding links"). It is also the one owner
type from the ticket's headline example ("a speaker's headshot, a signed
contract, an uploaded slide deck") with zero test coverage in
`tests/integration/api/media-links.MRQ-168.test.ts` — the only revocation
path actually exercised there is a direct
`UPDATE participations SET confirmation_status = 'declined'` on a
`task_upload`, not a submission rejection/withdrawal, and not headshots at
all.

(The `task_upload` branch, lines 92-109, has a narrower version of the same
gap: the default reversal path cancels tasks — which does invalidate the link
via the pre-existing `cancelled_at` check — but if the organizer chooses
"retain" for tasks during reversal, `task.cancelled_at` stays null and the
same status-blind `confirmation_status` check applies. That one is closer to
an intentional organizer override; the headshot case has no such escape
hatch.)

**Fix:** Add a `submission.status NOT IN ('withdrawn', 'rejected')` condition
to both EXISTS subqueries in the `person_headshot` branch, matching the
`submission_file` branch's semantics. Add a regression test: reject/withdraw
a speaker's sole submission via the reversal flow, then assert their
headshot's media URL 404s.
```

No other correctness, security, or performance issues found. Details below are quality/coverage notes, not blockers.

```
**[MINOR] src/lib/r2/media-links.ts:19-27 vs src/routes/uploads.routes.ts:52-61 — HMAC signing helper duplicated instead of reused**
`media-links.ts` reimplements `crypto.subtle.importKey`/`sign`/hex-encode as
`hmacKey`/`hex` rather than reusing `uploads.routes.ts`'s existing `hmacHex`.
The two aren't identical (media-links.ts additionally needs `verify` key
usage and a `bytesFromHex` decoder), so a straight import wasn't possible as
written, but the raw import/sign/hex-encode boilerplate is now duplicated
across two files that both sign with `UPLOAD_TOKEN_SECRET`.
**Fix:** Not blocking — worth a follow-up to extract a shared
`{ sign, verify }` HMAC helper (e.g. in `src/lib/r2/`) that both modules use,
so the two signing schemes (`local-put:...`, `${attachmentId}:...`,
`media:...`) share one primitive instead of three call sites reimplementing
Web Crypto boilerplate.
```

```
**[MINOR] tests/integration/api/media-links.MRQ-168.test.ts — revocation test only exercises the task_upload branch**
`mediaAttachmentIsActive` has five branches (`task_upload`, `person_headshot`,
`submission_file`, `draft_file`, the `event_logo`/`import_file` fallback);
only `task_upload` is driven through an actual HTTP round-trip. This is the
same gap as the MAJOR finding above, generalized: the other four branches'
SQL has no regression coverage at all, so a future edit to any of them (or a
future new owner type) has no test net.
**Fix:** Once the MAJOR fix lands, add a parametrized or per-branch case for
`person_headshot` (submission rejection) at minimum, since it's named
explicitly in the ticket.
```

## 4. Positive Observations

- The core signing design is clean and correct: `messageFor` binds the signature to both the object key and its expiry, `verifyMediaUrl` bounds `expiresAt` from both sides (rejects already-expired *and* implausibly-far-future values), and `crypto.subtle.verify` is used for signature comparison rather than a manual string compare — no timing-attack surface introduced.
- Reusing `UPLOAD_TOKEN_SECRET` (already used elsewhere in `uploads.routes.ts` for upload-completion tokens) rather than introducing a new secret is reasonable, and the `media:` message prefix keeps it domain-separated from the other HMAC uses of the same key (`local-put:...`, `${attachmentId}:...`) — no cross-purpose forgery risk.
- Separate-origin isolation (`isMediaHost`) and the signature/expiry check are ordered before the DB lookup in `handleMedia`, avoiding a DB round-trip for obviously-invalid requests — reasonable defense-in-depth and a sensible ordering choice.
- `link_policy` and both OpenAPI descriptions (`files.routes.ts`, `speakers.routes.ts`) were updated to state the truth ("short-lived signed capability... expires after 15 minutes... invalidated when its attachment or owning participation is revoked"), and a test (`media-links.MRQ-168.test.ts`, third case) actually asserts against the live OpenAPI document rather than trusting the route source — a good honesty check given this codebase's stated rule that link_policy fields must describe what is actually true.
- `serveInlineImageObject` (the already-authenticated inline-headshot path) was correctly left untouched, matching the plan's "acceptable alternative... for the narrow inline-headshot case already argued for."
- Every call site of the now-`async` `publicMediaUrl` and the newly-threaded `mediaSigningSecret` parameter was updated consistently; `npx tsc --noEmit` is clean and the full suite (215 tests, including three new MRQ-168 contract tests and updates to `files-library.MRQ-115`, `speaker-files.MRQ-138`, and `uploads-routes` tests) passes in 39s, under the 45s budget.
- The MRQ-168 test for expiry (`media-links.MRQ-168.test.ts`, first case) avoids a real sleep/wall-clock race by minting an already-expired token directly — good practice for keeping the suite fast and non-flaky.
