# Plan Review: MRQ-168

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The "Plan" submitted for review is a verbatim copy of the Task Description — every sentence, including "Why it is worth building anyway" and the two-option "Shape of a fix," is repeated word-for-word with no elaboration. No plan-level work has actually happened: no file list, no committed approach (it still presents "preferred" vs. "acceptable alternative" as an open choice), no signing-key design, no TTL value, and no reconciliation between time-based expiry and event-based revocation, both of which the acceptance criteria require simultaneously. I verified the codebase claims in the task description are accurate (`publicMediaUrl`, `objectKeyFor`, `serveMediaObject`, `serveInlineImageObject`, `link_policy` all exist as described), but that only confirms the *problem statement* is grounded — it does nothing to establish that an implementable plan exists.

## 3. Issues

```
**[CRITICAL] Whole document — The "Plan" is not a plan, it is the task description copy-pasted**
Lines 76-133 of the submitted plan are character-for-character identical to the task
description at lines 14-71 (same headings, same prose, same "no rubric item covers it"
justification). A plan review is supposed to evaluate a translation of the task into
concrete implementation steps; there is nothing here to evaluate beyond the problem
statement itself. No files-to-change list, no chosen design, no sequencing, no test
plan, no rollout/migration notes for links already issued under the old scheme.
**Recommendation:** Return to planning. The plan must add, at minimum: (1) a committed
design (not two options), (2) the concrete file list below, (3) a TTL value and where it
lives, (4) a key-management answer, (5) how expiry and revocation-on-action are both
satisfied, (6) a test plan naming the test files/cases.
```

```
**[MAJOR] Shape of a fix — Time-based expiry and event-based revocation are two different
mechanisms, and the plan conflates them**
The acceptance criteria require both "a media URL obtained today stops working after a
bounded lifetime" (time-based) AND "revoking a person's participation... invalidates
outstanding links rather than leaving them live" (event-based, immediate). "Sign the path
with an expiry and verify at the edge" only satisfies the first. A signed URL with, say, a
15-minute TTL is still fully valid for those 15 minutes even if the participation is
revoked one second after the link is minted — the plan never states that the edge verifier
also re-checks current authorization/attachment state (not just signature validity) at
serve time. `serveMediaObject` (src/lib/r2/serve.ts:21) currently checks `row.status !==
"ready"` from a live DB read on every request, which is the right primitive for immediate
revocation — but the plan doesn't say the new signed-URL check preserves that live lookup,
and a naive HMAC-signature-only implementation would drop it (verify signature + expiry,
skip the DB read) and silently regress this half of the AC.
**Recommendation:** Plan must state explicitly: the edge handler validates the signature
AND still performs a live DB lookup against current attachment/participation state, so a
revoked link 404s even before its signature expires. Spell out what "revoked" reads from
(attachment row deleted/status changed? participation row checked per-request?).
```

```
**[MAJOR] Shape of a fix — No file list; two known call sites of `publicMediaUrl` aren't
identified**
`publicMediaUrl()` is called from exactly two places today:
- src/lib/files/versions.ts:198
- src/routes/uploads.routes.ts:563
Both need to change to mint signed URLs instead. The plan doesn't mention either. It also
doesn't name src/lib/r2/keys.ts (where `publicMediaUrl` itself lives and where a signing
variant would presumably be added), src/lib/r2/serve.ts (`serveMediaObject`, the edge
verifier that needs the signature+expiry check added), src/routes/uploads.routes.ts
(`handleMedia`, the route that currently just does `isMediaHost` + row lookup), or
src/routes/files.queries.ts:215 / files.routes.ts:32 (the `link_policy` field and OpenAPI
description text that the AC requires be updated to match new behavior).
**Recommendation:** Add an explicit "Files to change" section naming these six locations
and what changes in each.
```

```
**[MAJOR] Feasibility — The plan implies reusable signing infrastructure exists, but the
only signing code in the repo (src/lib/r2/presign.ts) solves a different problem and
explicitly forbids the target this task needs**
The task's "Shape of a fix" says "the pieces are already there." The only existing signing
code is `presign.ts`, which does SigV4 PUT-signing directly against Cloudflare's R2 S3 API
endpoint (`{account}.r2.cloudflarestorage.com`) for uploads — and its own comment calls out
"trap 9: a custom/media domain is never a valid signing target" for that module, with a
runtime check (line 59-63) that throws if the signed host isn't the R2 S3 endpoint. That
module cannot be reused or extended to sign GET URLs on `MEDIA_PUBLIC_ORIGIN` — it's a
different signing scheme (SigV4 vs. whatever HMAC scheme this task needs) against a
different origin, by design. An implementer following "the pieces are already there"
literally risks trying to bolt onto presign.ts and hitting its deliberate guard rail.
**Recommendation:** Plan should say clearly that a *new*, separate signing mechanism is
needed for the media-serving path (e.g., HMAC-signed query param verified in `handleMedia`),
distinct from presign.ts, and should not imply the upload-presigning code is reusable here.
```

```
**[MINOR] Shape of a fix — Two competing designs left as an open choice**
"Preferred: short-lived signed media URLs... Acceptable alternative: serve through the app
origin..." is a reasonable menu for a task description, but a plan is supposed to have
picked one. Leaving both live changes what files get touched, whether the media origin
isolation is kept or removed, and how the AC about "separate-origin isolation... preserved
in serve.ts" is even satisfiable (the alternative would move serving off the media origin
for at least some cases, in tension with that AC).
**Recommendation:** Commit to the "Preferred" signed-URL approach in the plan (it's also
the only one of the two that cleanly satisfies the "separate-origin isolation... preserved"
acceptance criterion), and drop the alternative or scope it out explicitly.
```

```
**[MINOR] Acceptance — "Bounded lifetime" has no value or config location**
No TTL is proposed. This affects both the UX (does a signed URL need to survive a page
render + a slow download, or just an instant redirect?) and the test ("proven by a test"
needs a concrete duration to assert against, e.g. via a fake clock).
**Recommendation:** Propose a TTL (e.g. matching or distinct from `PRESIGN_EXPIRY_SECONDS`
in presign.ts, currently 10 minutes) and state where it's configured (constant vs. env
binding).
```

```
**[MINOR] Acceptance — Files export "must either carry short-lived links or say plainly
that it carries none" is left unresolved**
This is a real product decision (does the CSV/export UX degrade to no-URL, or does it
carry links good for N minutes from generation time — which may already be stale by the
time a downstream reader opens the CSV?) with API-contract consequences (`link_policy`
value, OpenAPI text). The plan repeats the open question verbatim rather than answering it.
**Recommendation:** Decide and state: does the files export get short-lived links (and if
so, is a fresh mint-at-read acceptable given export generation timing), or does it drop
URLs from the export entirely and point callers to a per-file authenticated endpoint?
```

```
**[MINOR] Completeness — No test plan**
The AC requires two behaviors "proven by a test" (expiry, revocation-invalidates-link).
The plan doesn't name test files or scenarios. Existing test conventions for this area
(uploads.routes tests, r2/serve tests if any) should be identified so the implementer
extends the right suite rather than inventing a new one.
**Recommendation:** Add a short test-plan bullet naming the test file(s) to extend and the
scenarios to cover (expired signature → 404, valid signature but revoked participation/
deleted attachment → 404, valid signature within TTL and still authorized → 200).
```

## 4. Positive Observations

The task description itself (which the plan inherits) is well-grounded: every code
reference checked out exactly as described (`objectKeyFor`'s `crypto.randomUUID()`
entropy, `serveMediaObject`'s `Content-Disposition: attachment` + `nosniff`, the
`link_policy: "unauthenticated-capability-url"` field, the OpenAPI description text, and
`serveInlineImageObject`'s narrower already-authorized inline path). The framing correctly
distinguishes this from a "guessable URL" bug — it is a genuine no-expiry/no-revocation
capability-URL problem, correctly scoped as a privacy defect worth fixing without a rubric
item behind it. The acceptance criteria are concrete and testable in principle. None of
that, however, is planning work — it's the (accurate) problem statement the plan needed to
build on, and didn't.
