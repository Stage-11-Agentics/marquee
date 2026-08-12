# Code Review: MRQ-81 — public CFP submission blocked at the headshot field

## 0. Harness defect — the diff I was handed was not MRQ-81's

Before the review proper, something the orchestrator needs to know: the `### Diff`
section of `.lattice/tmp-prompts/review-bzkb1ja5/claude/prompt.md` (lines 202–449)
contains **the uncommitted working-tree diff of the main checkout**, not the
branch under review. It is `.lattice` board churn plus the nav/route-table change
from `20aa152 Stop advertising two modules this product does not have` — zero
lines of `src/ui/public/form/`, `src/routes/uploads.routes.ts`, or anything else
MRQ-81 owns.

A reviewer who trusted the prompt would have reviewed the wrong change and
reported on Airtable route removal. **If other reviews in this run were generated
the same way, their verdicts are about whatever was dirty in the main checkout at
capture time, not about their branches.** Worth checking the capture step before
trusting the rest of the batch.

I ignored the supplied diff and reviewed the real change:

- worktree `/Users/atin/Projects/Stage11/deployments/marquee-mrq81`
- branch `mrq-81-public-cfp-file-upload`, commits `051491e` + `8c614ac`
- diffed against `merge-base(github/main, HEAD)` — 12 files, +853/−39
- PR #30, open

(Secondary inconsistency, harmless: the prompt's `### Plan` section still says
branch `mrq-79-...` and "MRQ-79 OWNS" while the header says MRQ-81. `ids.json`
confirms they are distinct tasks. The delivered branch follows the header.)

---

## 1. Verdict

**PASS** — with one should-fix before the deploy validation (§3.1) and three
minor cleanups.

## 2. Summary

I reviewed the real MRQ-81 branch: a Turnstile lifecycle module, the public-form
component rewritten around explicit widget render, a server-side field-config
lookup for the public presign, an accept-list vocabulary fix in `r2/policy.ts`, a
flag-gated local upload shim, and 437 lines of new tests. The implementation goes
materially past the ticket — it found and fixed the actual first-order cause the
ticket had not identified (**`turnstile.render()` was never called, so no widget
ever existed and every gated round-trip 403'd, not just the upload**), and it
found the second-order cause the ticket also could not have seen (the presign
narrowed `draft_file` to `DOCUMENT_RULES`, so `headshot.png` was unsignable on
every public form). The ticket's own defect 1 is correctly reported as real but
unreachable, with evidence. Quality is high: the risky helper is extracted and
directly unit-tested, the Turnstile relaxation is narrow and principled, and the
local shim is off by default and refused when off.

**Key finding:** the client still demands a fresh Turnstile token at Submit even
on the exact path where this PR just taught the server not to require one — so
the last step of the walkthrough can stall 20s and refuse on a challenge the
server would have waived.

## 3. Issues

### 3.1

**[MAJOR] src/ui/public/form/PublicForm.tsx:376–380 — Submit gates on a token the server no longer requires, re-introducing a soft dead end at the last step**

`handlePublicSubmission` now waives Turnstile when the submission carries a
resume token that resolves to this form's own draft (`public-form.routes.ts:574–581`).
That is the whole point of the server-side half of the fix. But `submit()` was
not taught the same rule:

```ts
const token = await requestTurnstileToken();
if (turnstileRequired() && !token) {
  setPageError(SECURITY_CHECK_UNFINISHED);
  return;
}
```

There is no `state.resume_token` exemption. Every public submission reaches
Submit *with* a resume token (the draft was created to attach the headshot), so
the client is unconditionally gating on something the server has explicitly
decided it does not need.

**Failure scenario.** Deployed, managed sitekey. The submitter attaches the
headshot; `handleFile` finishes with `resetTurnstile()` (line 359). At Submit,
`requestTurnstileToken()` finds an empty token ref, resets the widget again, and
waits. Cloudflare escalates this solve to an interactive challenge — or the
`error-callback` fires (network blip, or the 110200-class domain refusal already
observed once in this branch's own validation) and clears the token. Twenty
seconds pass with the button reading "Saving…" and disabled, then Submit is
refused with "The security check did not finish." The person has filled in every
field and attached the file, and the server would have accepted the request on
the resume token alone. It is recoverable — the message names the fix and the
next press works once a token lands — but it is a gratuitous stall-and-refuse on
step 1 of the rubric, in the one place the server was just made tolerant.

Related, same root: the flow now resets the widget three times per submission
(draft create → presign → submit), which is three chances to be escalated where
the server needs at most one.

**Fix:** mirror the server's rule on the client. Something like:

```ts
const ridesDraftCheck = Boolean(state.resume_token && state.draft_id);
const token = ridesDraftCheck ? turnstileTokenRef.current || undefined : await requestTurnstileToken();
if (!ridesDraftCheck && turnstileRequired() && !token) { … }
```

Send whatever token is already in hand (harmless — the server ignores it on this
path), but never block on obtaining a new one when a resolving resume token is
present. Add a case to `public-upload-presign.MRQ-81.test.ts` asserting the
resumed-submission path succeeds with no token at all; the server side of that is
already tested, the client side is the gap.

### 3.2

**[MINOR] src/ui/public/form/PublicForm.tsx:426 — the crop-preview frame appears on the "Supporting material" field, promising something that field never promised**

```ts
const takesImage = acceptList.some((entry) => entry.startsWith("image/") || /^\.?(?:jpe?g|png|webp)$/i.test(entry));
```

The seeded CFP form has a second file field directly below the headshot
(`scripts/seed/event.ts:277`): `supporting_file`, label "Supporting material",
help text "Optional deck, paper, diagram, or sample bundle", accept
`["application/pdf", "image/png", "image/jpeg", "application/zip"]`. Because that
list contains image MIME types, `takesImage` is true, so the field renders a
96px crop box and the line **"Choose an image to see its crop preview here."**
And when the submitter does the expected thing and attaches a PDF deck,
`showLocalPreview` bails on the non-image type, so the box stays empty with that
same note sitting under it — which reads as a failure. If they attach a PNG
instead, the note becomes "Crop preview · the square the conference programme
shows", which is false: this is not the headshot.

This is on camera. The judge fills this exact form in step 1 of the walkthrough,
and the field immediately under the fixed one now shows an empty box asking for
an image on a field whose own help text asks for a deck.

**Fix:** gate the preview on the field's *purpose*, not on whether an image
happens to be permitted — either `acceptList.every(entry => entry.startsWith("image/"))`,
or drive it off the field key/config the way the label copy is driven. The
headshot's accept list is images-only, so `every` fixes this without touching
seed data (which MRQ-81 must not touch anyway).

Same line, lower stakes: the preview is painted before `ensureDraft()` and
survives an upload failure, so a failed attach leaves a thumbnail on screen. The
adjacent status line still reads "No file attached yet.", so the truth is present
— but consider clearing the preview in `handleFile`'s catch so the two never
disagree.

### 3.3

**[MINOR] src/routes/uploads.routes.ts:449 — `handleLocalPut` reads `status` and never uses it, so a completed attachment's bytes can be replaced without re-verification**

The SELECT pulls `status` into the row type and nothing branches on it. The
signed local PUT URL lives for ten minutes, which outlasts the completion call
that follows it by a wide margin, so within that window the same URL can
overwrite the object of an attachment already marked `ready` — and completion,
having already run, will not sniff the new bytes. The blast radius is a local dev
Worker with the shim explicitly enabled, so this is not a production exposure;
it's a guard the code already fetched the data for and then forgot to apply.

**Fix:** `if (row.status !== "pending") return uploadError(context, "conflict", "attachment is no longer accepting bytes");`

### 3.4

**[MINOR] src/lib/r2/policy.ts:96 — `narrowRules` still doesn't understand `image/*`, and failing that way is silent**

The vocabulary fix (`wanted.has(rule.extension) || wanted.has(rule.mime)`) is
exactly right for the two vocabularies in the tree today. But `accept: ["image/*"]`
is the single most idiomatic thing to write in an HTML file input, and it matches
neither branch — it narrows to an empty rule set and rejects every file, which is
*precisely* the silent, total-refusal signature this ticket spent a day
diagnosing. Nothing authored today hits it; the next person to add a form field
through an editing UI plausibly does.

**Fix:** handle the wildcard —

```ts
return base.filter((rule) =>
  wanted.has(rule.extension) || wanted.has(rule.mime) || wanted.has(`${rule.mime.split("/")[0]}/*`));
```

and, separately, consider making an accept list that narrows to *zero* rules
loud rather than quiet (throw, or fall back to base with a logged warning). An
empty rule set is never a coherent policy, and its current failure mode is
indistinguishable from the bug just fixed.

### 3.5

**[MINOR] src/ui/public/form/styles.ts:53 — the reserved error row is a fixed 60px, which a long message on a narrow viewport still overflows**

`.public-error { min-height: 60px; visibility: hidden }` reserves two lines at
12px/1.5 plus 24px padding. `SECURITY_CHECK_UNFINISHED` is 128 characters; in a
phone-width column it wraps to four or five lines (~90–110px), so the row grows
and everything below it moves — the jump the reservation exists to prevent,
surviving at exactly the width where it is most noticeable. `check:design` passes,
so this is not a contract violation, just an incomplete reservation.

**Fix:** either reserve by line count at the narrow breakpoint too (a media query
raising `min-height`), or shorten the longest messages to fit two lines at mobile
width. The 76px permanent gap this leaves above the form card on desktop is also
worth an operator eyeball — it is correct per ELEMENTS NEVER JUMP, but it is a
visible empty band on the page a judge opens first.

### 3.6

**[INFO] Scope — five files outside the declared ownership, all justified, none forbidden**

`src/lib/r2/policy.ts`, `wrangler.jsonc`, `README.md`, `cli/api-registry.json`,
and `tests/unit/r2/uploads-routes.test.ts` sit outside "MRQ-81 OWNS" but well
clear of "MUST NOT TOUCH". Each is load-bearing for the fix and each is declared
in the PR body with its reason. The `policy.ts` change is additive to
`draft_file`/`submission_file` and explicitly does *not* widen `task_upload`,
with a test pinning that (`public-form-upload.MRQ-81.test.ts:173`). The
`uploads-routes.test.ts` edit adds two schema tables and changes no assertion.
The `wrangler.jsonc` footprint is one var plus comment, per the split brokered
with the deploy agent. No action needed — recorded so the merge driver can see
the overlap surface at a glance.

## 4. Security note on the Turnstile relaxation — reviewed, and it holds

The ticket said "do not weaken the Turnstile gate to make the upload work," so
this deserves an explicit finding rather than silence.

`handlePublicSubmission` now skips `requireTurnstile` when `resumeToken &&
base.submission`. I traced the predicate: `base.submission` comes from
`loadPublicForm` → `findResumeSubmission(db, form.id, options.resumeToken)`
(`public-form.shared.ts:197`), which resolves **only** by resume token — never by
email, never by anything the caller can guess. So the skip requires a secret
bearer credential that resolves to a draft on this specific form.

The gate therefore still binds where it matters: creating a draft requires a
Turnstile solve, one draft yields one submission, and `POST /drafts` is
unchanged. An attacker cannot amplify a single solve into many submissions. The
position is identical to the one `PATCH /drafts/{token}` (autosave) already
takes, which I confirmed — `requireTurnstile` appears at exactly two call sites,
draft creation and submission. This is a coherent contract, not an erosion, and
it is tested in all four directions
(`public-upload-presign.MRQ-81.test.ts:155,173`).

The local shim is likewise sound: HMAC over `attachmentId:r2Key:expiresAt` keyed
on `UPLOAD_TOKEN_SECRET`, ten-minute expiry, 404 unless `LOCAL_UPLOAD_SHIM === "1"`,
pinned `"0"` in `wrangler.jsonc`, refusal tested. It writes bytes and adjudicates
nothing — size and magic bytes remain the completion path's call, which deletes
on contradiction. §3.3 is the one guard it left on the floor.

The presign's field lookup is the right shape: the field key arrives from an
anonymous stranger and is resolved server-side against the form the draft belongs
to, so the caller names a slot and never the policy governing it, and an unknown
or non-`file` key is a 404. That closes a hole that was previously open by
accident (the `fieldKey` was accepted and then discarded).

## 5. Verification I ran myself

Not taken on trust from the PR body — executed in the worktree:

| Gate | Result |
|---|---|
| `tsc --noEmit` × 3 (`tsconfig.json`, `.client`, `.test`) | **pass**, exit 0 each |
| `npx vite build` | **pass** |
| `check:design` | **pass**, `findings: []` |
| `check:api` | **pass**, registry parity holds with the new `putLocalUpload` operation |
| `trace:ac` | **pass** (only the pre-existing `AC-16 felt` operator item uncovered) |
| Diff's own tests + the suites it touches | **66 passed / 0 failed** across `public-form-upload.MRQ-81`, `public-upload-presign.MRQ-81`, `r2/uploads-routes`, `r2/policy`, `r2/presign`, `public-form.AC-25-42-155-157-231-234`, `public-site`, `public-embed-widgets` |

Per the corrected fleet gate, no full `npm test` and no `pr-gate` — the PR body
says so, correctly.

I did not re-run the browser smoke; the PR body documents it in unusual detail
(own Worker on :8804, real seed, logged-out c11 browser, genuine 400×400 PNG,
zero uncaught console exceptions, then the full loop — accept → onboarding fired
2 tasks + 3 emails → scheduled to Metropolitan Ballroom Oct 13 16:30 → published
to the public site — walked from the newly created record rather than a seeded
one), which is exactly what verification steps 2–4 asked for and is the first
time that path has been run from a real submission. The additional run against a
production sitekey, correctly refused with 110200 on loopback, is a genuinely
good piece of evidence: it proves `render()` fires against a real key and that
the refusal degrades to a message instead of an exception. Its honest handoff of
"passing a real sitekey belongs to deploy validation on `marquee.stage11.dev`" is
the right call rather than a dodge.

## 6. Positive observations

- **The diagnosis went past the ticket and said so with evidence.** The ticket
  named three defects; the branch found that defect 1 is real but *unreachable*,
  because the draft POST 403s first — no widget was ever rendered, with any key,
  for anyone. Reporting "your diagnosis is correct and also not the thing that
  was killing you" with a console transcript, and fixing both, is the behaviour
  you want from a reviewer's counterpart.
- **The dangerous helper was extracted to be testable, not just fixed in place.**
  `src/ui/public/form/turnstile.ts` is 68 lines, has no React/Preact dependency,
  and is unit-tested for exactly the states that threw in production: no widget,
  stale widget id, script absent, mounted widget addressed by id. That is the
  difference between "the throw is gone" and "the throw cannot come back."
- **The `narrowRules` MIME/extension trap was spotted before it could disguise
  itself as a fix.** Passing the field config through without the vocabulary fix
  would have narrowed every image field to an empty rule set — the same total
  refusal, now with a plausible-looking config lookup in front of it. The PR
  calls this out explicitly and tests both vocabularies plus the
  extension-disagrees-with-MIME case.
- **The local shim is the right kind of scaffolding.** It exists because the
  ticket's own non-negotiable verification was otherwise impossible — no local
  checkout could ever complete an upload, which also means the walkthrough video
  could never have shown one. It is explicit rather than inferred (correctly
  citing why `wrangler dev` gives the Worker no local signal), off by default,
  refused when off, tested, documented beside `INSECURE_LOCAL_COOKIES`, and it
  changes no production code path.
- **Test hermeticity was self-caught.** Commit `8c614ac` exists because the
  author noticed the presign tests were passing off ambient `.dev.vars` R2
  credentials and would have failed in CI — and read the one passing case as the
  tell. Fixing that unprompted, with the reasoning written down, is worth more
  than the two tests it saved.
- **Two defects found while walking the loop were flagged, not fixed.** Duplicate
  speaker names on the public site and a file answer rendering as raw JSON on the
  submission record both live in MRQ-76/77 files. Respecting the ownership
  boundary while making sure the findings do not evaporate is exactly the
  discipline this fleet run depends on.
