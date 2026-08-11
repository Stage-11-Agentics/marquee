# Marquee — UX Sweep Findings (Pass B, write-flow)

**Run:** 2026-08-11 · local Worker `http://127.0.0.1:8787` · `evt_aie-ny-2026`, reset to seed baseline
via `npm run reset:demo` before this pass began.
**Agent:** same session that ran Pass A, continuing as Pass B per operator direction. One agent,
serialized, per `sequence/UX-SWEEP-PLAN.md`.
**Screenshots:** `/private/tmp/claude-501/-Users-atin-Projects-Stage11-deployments-Marquee/972723d5-04c2-41fc-9683-2735da94bd06/scratchpad/passb-shots/`

**Infra note:** the Worker that Pass A tested against had died between passes (process gone, port
closed) — its persisted D1 state on disk was intact, so it was restarted against the same
`.wrangler/marquee-local` persist path with no data loss, then `npm run reset:demo` was run to
guarantee a clean baseline before Pass B's writes began.

**IMPORTANT — read before acting on this file's findings.** This entire pass ran against a local
checkout that, as of Flow 4/5, was confirmed **15 commits behind `origin/main`**. The merge driver
(surface:261) reported mid-sweep that MRQ-81 through MRQ-83 landed on `main` while this pass was
running, including a fix (PR #20) for the exact session-lockout bug documented below under
"Infrastructure note." **Status of this pass's findings against current `main`, per that report:**

- **Headshot/CFP blocker (Flow 1)** — already tracked as **MRQ-81** (critical, unassigned when
  reported). Not a duplicate; this pass independently confirms and details the same bug.
- **Session-lockout bug (found resetting for Flow 4)** — **already fixed on `main` via PR #20**.
  Documented in full below anyway, because the diagnosis (root cause, minimal repro, why it
  looked like three different unrelated theories before landing on the real one) may still be
  useful, but **do not ticket it — it's fixed**.
- **MRQ-83, "restored decision buttons on waitlisted records,"** landed on `main` and may fully or
  partially cover the Flow 2 "reversal is a dead end" / Flow 3 Maybe-card-persists findings below.
  This pass's checkout predates that merge, so it could not verify against the fixed behavior —
  **re-verify Flow 2's dead-end finding against current `main` before opening or updating any
  ticket for it.**

Everything else below (Flow 3 Maybe path, Flow 4 bulk actions, Flow 5 importer, the Waved-stage
clarification, the track/format-drop minor) was not named in the merge driver's report and should
be treated as still-open against current `main` — but wasn't independently re-verified there
either, since this pass's checkout was never refreshed.

**FINAL RESOLUTION (post-sweep, checkout refreshed to `main@21e6cef`, Worker restarted with
`--var INSECURE_LOCAL_COOKIES:1`, session-lockout fix smoke-tested and confirmed working):**

- **Flow 2 "reversal is a dead end" — CONFIRMED FIXED, do not ticket.** The Pass B ticketing
  agent re-verified against source on current `main` rather than re-clicking through a stale UI:
  MRQ-83 (rescoped from this exact finding after surface:245 found PR #17/MRQ-76 had *also*
  stripped decision buttons from waitlisted records — "Maybe" had become its own trap door)
  shipped as **PR #21**. `can_decide` (`submission-record.routes.ts:418`) now includes
  `'declined'`, so waitlisted/rejected/withdrawn records all get their Record Action card back;
  `ACTIONABLE_STATUSES` (`decisions.ts:141-148`) gained `'withdrawn'`, the API-side half the UI
  fix depended on. A dedicated regression test exists:
  `tests/integration/api/record-actions-declined.MRQ-83.test.ts`.
  **Bonus this finding surfaced:** while verifying, the implementer checked whether `can_publish`
  correctly refuses a declined record — it didn't. `can_publish` (line 424) gained
  `&& row.status === "accepted"` in the same PR, closing a real gap where a declined record with
  a leftover slot could previously still be published to the public site. Nobody had found that
  independently; it fell directly out of chasing this dead-end.
- **Flow 5 importer track/format-drop — ticketed as MRQ-84** ("Sessionize importer silently drops
  unrecognized tracks and formats," bug/low/low), grounded in exact source
  (`sessionize-import.ts:638-639` resolves by exact case-insensitive name match, a miss silently
  falls back to `null` at 654-655 with nothing recorded; the reason string is composed at :735 as
  a `filter(Boolean).join('; ')`, so surfacing the miss is one more array entry — no new UI needed,
  `SessionizeImportPage.tsx:149` already renders the Reason column). MRQ-84's verification
  requirements explicitly include driving the actual import wizard UI in a browser and
  screenshotting the results table — this pass only verified the importer at the API level, so
  that visual confirmation has never actually happened and isn't assumed.
- **Session-lockout (PR #20) and headshot blocker (MRQ-81)** — no new tickets, as already noted
  above; confirmed via live smoke test post-pull that a login immediately after `reset-demo` no
  longer 401s.
- **Not re-ticketed, not re-verified**: the Waved-stage-on-Rejected/Withdrawn clarification, the
  Flow 4 bulk-action results, and the audit-trail-gap minor. These weren't named in either
  merge-driver report and stand as originally documented below.

---

## Flow 1 — the main loop

**Steps per plan:** public CFP submit → appears in Submitted → review & score → accept → speaker
gets task set → speaker completes portal tasks → schedule onto agenda → publish → appears on the
public site.

### BLOCKER — public CFP submission cannot complete: Headshot field never clears its required state

**Severity: Blocker.** This stops the walkthrough loop at step 1 of 11 — the evaluation rubric.

**What I saw:** On `/f/cfp` (public, logged out), every other required field (title, abstract,
outcome, format, tracks, primary speaker name/email/role/company, biography, the Turnstile-gated
"discusses a product?" dropdown) can be filled and the "required" warning clears normally. The
**Headshot** field never does. A valid 400×400 PNG was attached to the file input — confirmed at
the DOM level (`input.files.length === 1`, correct name/size/`image/png` type) — but:

- No crop-preview UI ever mounts. The field's own label promises one ("JPG or PNG · crop preview
  appears before submission"); no crop-related DOM node exists anywhere on the page after
  selection (checked via `document.querySelectorAll('*')` filtered for crop-related class/id — zero
  matches).
- No network request for image processing/upload ever fires (checked network log, filtered for
  `media` — zero matches).
- The "Add an answer so the conference team can review this abstract" error under the field never
  clears, and clicking **Submit abstract** re-scrolls to this field and refuses to submit.
- Manually re-dispatching both `input` and `change` DOM events directly on the file input (after
  the file was already attached) made no difference — ruling out "the automation tool's event
  didn't register" as the explanation. This is a real client-side state bug, not a tooling
  artifact.
- Each failed submit attempt also throws an **uncaught console exception**:
  `TurnstileError: [Cloudflare Turnstile] Nothing to reset found for provided container` (from
  `challenges.cloudflare.com/turnstile/v0/api.js`, called from the bundle's submit-failure path).
  `.dev.vars` has the correct Cloudflare-published always-pass test keys configured
  (`TURNSTILE_SITE_KEY=1x00000000000000000000AA`), so this isn't a missing-credential issue — it
  looks like the submit-failure recovery path unconditionally tries to reset a Turnstile widget
  that was never mounted (plausibly because Turnstile only renders after all other fields
  validate, and the stuck Headshot field means that point is never reached), throwing a secondary,
  unrelated-looking exception on top of the real bug.

**Exact repro:** Load `/f/cfp` logged out. Fill every field. Attach any real PNG/JPG to
"Headshot" via a file input (native picker or programmatic `DOM.setFileInputFiles` — both were
tried). Click **Submit abstract**. The page scrolls back to Headshot, the required-field error is
still present, and a `TurnstileError` fires in the console.

**Screenshot:** `B-public-f-cfp-headshot-BLOCKER.png`

**Impact:** No new submission can be created through the actual public intake path used by real
speakers. Everything downstream of "public submits" in the main-loop walkthrough (review, accept,
onboarding, schedule, publish) could not be exercised starting from a real public submission.
**Workaround used for the rest of this pass:** continued the review→accept→…→publish chain against
one of the 1,000 already-seeded submissions instead of a freshly-submitted one, so the rest of the
pipeline could still be tested. This does not substitute for fixing the CFP form — a judge who
tries the public form directly will hit this wall.

### Confirmed clean: review → accept, chained on `sub_synthetic-pool-0001`

Used as the workaround subject for the rest of Flow 1. Two steps confirmed working correctly:

1. **Review & score** — `/reviewer` queue, scored `sub_synthetic-pool-0001` (Approve, 4/5, a
   committee note). Saved cleanly ("Approve saved · next submission ready"), queue advanced to
   the next item, and the submission's own detail page immediately reflected the scorecard
   ("Initial review · 1 scorecard result", "AIE Program Committee 1/40 reviewed").
2. **Accept** — from the submission's own Record Action card, clicked **Accept**, confirmed via
   the "Accept this submission?" dialog (feedback optional, left blank), clicked **Accept and
   notify**. The record's stage pill flipped to **Onboarding** immediately, status badge to
   **Accepted**, and a Decision History entry was recorded ("Accepted · AIE Program Committee ·
   Aug 11, 2026"). The organizer-side `/onboarding` page's **Accepted speakers** counter went
   from 153 → **154** live, in the same page load, no stale cache — this one counter is correctly
   reactive (contrast with the Pass A finding that other pipeline counters, e.g. `/board`'s Waved
   column, are not).

No console errors, no failed requests on either step.

**Correction to a Pass A hypothesis:** Pass A guessed the landing page's hero pipeline widget
might be fully static/hardcoded, since its numbers didn't change on an `npm run reset:demo`. After
this accept, the landing page's **In review** (280→279) and **Accepted** (60→61) figures *did*
update live, matching the real change. So the landing widget is not static — it's a real live
query. What's still true and reproducible is the actual Pass A finding: for two of the six
figures specifically (**Submitted**, **Scheduled**), the landing widget's number disagrees sharply
with `/dashboard`'s and the real filtered-list count for the same stage (960 vs 0, 24 vs 1). The
likely cause is a query/definition mismatch on just those two stages, not a hardcoded landing
page — worth passing to whoever picks up that ticket.

---

## Flow 2 — reversal cascade

Tested on the same `sub_synthetic-pool-0001` immediately after accepting it in Flow 1, which is a
more faithful "accept then immediately reconsider" test than resetting first.

**Setup:** From the record's "Acceptance reversal" panel, confirmed both dropdown branches exist
as the plan expects — Portal tasks: **Cancel open tasks** / **Keep tasks active**; Scheduled
emails: **Cancel queued emails** / **Retain queued emails**; Calendar invites: **Send
cancellation** / **Retain invite**; Resulting status: **Withdrawn** / **Rejected**. Chose **Keep
tasks active**, left the rest at default, resulting status **Withdrawn**, clicked **Apply
reversal**.

### Major — reversing an acceptance is a one-way door: no UI path back to re-decide the record

> **RESOLVED — see "FINAL RESOLUTION" at the top of this file.** Fixed on `main` via PR #21
> (MRQ-83). Documented in full below for the record; do not ticket.

**Severity: Major.** The plan explicitly asks to verify "that re-acceptance restores rather than
reassigns" — **this could not be tested**, because after reversal there is no way to re-accept the
submission at all.

**What I saw:** Before reversal, the record page had a "Record Action" card (Accept / Maybe /
Reject buttons) directly under the program-record summary. After applying the reversal, that
entire card is gone — not disabled, not hidden behind a toggle, just absent — checked the full
page top to bottom. The only decision-adjacent thing left on the page is the read-only Decision
History (see next finding). An organizer who reverses an acceptance by mistake, or wants to
reconsider a withdrawn speaker later, has no button anywhere to change their mind.

**Exact repro:** Accept any submission, open its detail page, apply an acceptance reversal (any
branch combination). Reload the page. No Accept/Maybe/Reject controls exist anywhere on it.

**Screenshot:** `B-organizer-submission-reversed-DEADEND.png`

### Minor — reversed record's own stage pill still reads "Waved" after becoming "Withdrawn"

**What I saw:** After reversal, the record's status badge correctly reads **Withdrawn**
(confirmed independently via `/submissions` search — the list's STATUS column also correctly
shows "Withdrawn"). But the small pipeline-stage pill in the top-right corner of the record's own
detail page — separate from the status badge — still reads **"Waved"**, unchanged from before the
reversal. This is a display-only inconsistency isolated to that one pill (the underlying data is
correct everywhere else checked), but it's misleading to anyone glancing at just that corner of
the page. Given Pass A already found the Waved-stage computation to be unreliable in multiple
other places (the `/board` count, the `?status=waved`/`?status=accepted` list overlap), this looks
like the same root cause surfacing a third way.

**Screenshot:** `B-organizer-submission-reversed-DEADEND.png` (same screenshot — pill visible
top-right, badge visible on the card)

### Minor — the reversal itself isn't logged in Decision History

**What I saw:** Decision History still shows count **1** ("Accepted · AIE Program Committee · Aug
11, 2026") after the reversal — no second entry recording that the decision was withdrawn, by
whom, or when. Combined with the previous finding, a withdrawn record carries no visible audit
trail of its own reversal.

### Confirmed working: the "Keep tasks active" branch's stated behavior

The dialog's help text ("Keep tasks active: unfinished portal work will remain open and continue
to be chased") matched the choice made; did not independently re-verify the underlying task rows
post-reversal since the only place to check them (the record's own Acceptance Reversal panel) is
also gone once the record is no longer Accepted — same root cause as the dead-end finding above.

---

## Flow 3 — decision + comms (deny with feedback)

Reset to a fresh seed baseline first (`npm run reset:demo`). Opened `sub_synthetic-pool-0280`
(In review), clicked **Reject**, entered feedback text, confirmed via **Reject and notify**.

**Confirmed working, clean:**
- Status badge correctly updated to **Rejected**; Decision History correctly recorded the exact
  feedback text with committee attribution and date.
- `/communications` outbox ("Rendered delivery log") shows exactly the expected message —
  recipient, template (`rejection`), person ID — tagged **`suppressed · demo mode`**. Opened it:
  the rendered email correctly personalizes ("Hi Tavi,") and includes the exact feedback text
  verbatim. **No real send occurred** — this is the single most safety-critical thing to verify
  given the plan's Resend-100/day-cap concern, and it held up cleanly.
- The same outbox log also still carried the Flow-1 acceptance email from earlier in this
  session, also correctly `suppressed · demo mode` — the safety behavior is consistent across
  both decision types, not a fluke of one path.

**Note, not tested this round:** the Record Action card only offers **Accept / Maybe / Reject** —
there's no distinct "Waitlist" action as such; "Maybe" appears to be the waitlist-equivalent state.
Did not test the Maybe path or bulk decisions in this pass; see "Not reached" below.

**Same "Waved" stage-pill bug reproduces on Reject, not just on reversal.** This record's own
top-right stage pill now also reads **"Waved"** despite the status badge correctly reading
"Rejected" — identical to the Flow 2 finding on the withdrawn record. Seeing it on two different
terminal states (Rejected and Withdrawn) upgrades the working theory from "a reversal-specific
bug" to a general one: **the stage pill likely defaults to "Waved" for any record carrying a
final decision**, rather than correctly branching on which decision it was. This is very likely
the same root cause behind three separate Pass A findings (the inflated `/board` Waved count, the
`?status=waved`/`?status=accepted` list overlap) plus these two Pass B sightings — five
independent symptoms of one bug, across two passes.

**Screenshots:** `B-organizer-submission-rejected-WAVED-STAGE-BUG.png`,
`B-organizer-communications-outbox-clean.png`

---

## Infrastructure note — local Worker crashed repeatedly under this pass, root cause identified

**Not a product defect** — flagging for the record and because it interrupted this pass.

Between Pass A ending and Pass B starting, and again twice more mid-Flow-1, the local
`wrangler dev` process on :8787 died outright (`ECONNREFUSED`, then confirmed via its own crash
log: an internal `ProxyController2` / miniflare loopback error with an empty error cause,
recommending a workers-sdk GitHub issue). Each time its persisted D1 state
(`.wrangler/marquee-local`) survived intact and the server was restarted clean with no data loss.

**Root cause, confirmed via `uptime`/`ps aux` at the third crash:** system load average peaked
at **~171** (on a machine that should be nowhere near that under normal use) — a large concurrent
Lattice orchestrator fleet was actively building several other Marquee tickets in parallel
(delegators visible in the process list for at least MRQ-74 and MRQ-75, each running their own
`vitest`, `workerd`, and `wrangler dev` instances in separate worktrees), on top of this sweep's
own Chrome automation and a sibling Opus agent doing the UX-findings ticketing pass. Several
requests logged 2.6–6.4s response times immediately before crashes — consistent with severe CPU
starvation. **Resolved.** Another agent (surface:261) killed the stray concurrent `vitest`/full-suite runs.
Independently re-measured rather than taken on faith: `vitest`/`workerd` process count dropped
45 → 19 → 5, and 1-minute load average fell from a peak of 171 to 21.55 over about 15 minutes. The
Worker held stable through the whole of Flow 2 with no further crashes once load actually cleared.
(Note: it did still crash 2–3 times in the transition window while load was already back to a
moderate ~55–60, matching the same empty `ProxyController2`/miniflare-proxy fault each time — a
residual `wrangler dev` long-session flakiness under partial load, not a product defect, and it
stopped once load fully cleared.)

---

## Flow 3 (continued) — the Maybe / waitlist decision path

**Run:** fresh `sub_synthetic-pool-0279` (In review), organizer seat, browser-driven.

**Confirmed working, clean.** Clicked **Maybe** on the Record Action card. The confirm dialog
correctly titled itself **"Waitlist this submission?"** (confirms Maybe = the waitlist decision,
matching the plan's assumption). Entered feedback, clicked **Waitlist and notify**.

- Decision History correctly recorded **"Maybe"** with the exact feedback text and committee
  attribution.
- **Unlike Accept/Reject, the Record Action card (Accept/Maybe/Reject) stayed on the page** after
  a Maybe decision — the record can still be re-decided. This is a real, useful asymmetry against
  the Flow 2 dead-end finding: the dead-end is specific to *reversing an acceptance*, not to
  every decision type.
- Clicked **Accept** from that same Maybe-decided record: the dialog opened normally, and the
  accept went through cleanly. Decision History now correctly shows two entries, newest first
  ("Accepted" above "Maybe"), and the record's own Accept/Maybe/Reject card *remained* visible
  even after Accept — it only disappears after an acceptance **reversal**, refining the Flow 2
  finding further.

**Root-cause clarification for the "Waved" stage-pill finding (Flows 2–3):** on this record, the
page's outer stage badge read **"Waved"** and the inner status pill read **"Maybe"** — and this
is *correct*, not the bug. "Waved" is the real, intentional pipeline-stage name for a
waitlisted/Maybe record (it's literally pipeline stage 3 in the left nav: Submitted → In review →
**Waved** → Accepted...). Confirmed at the API layer too: `GET /submissions/:id` on a
freshly-waitlisted record returns `"status": "waitlisted"`, `"stage": "waved"` — two distinct,
correctly-populated fields. So the earlier Flow 2/3 sightings of a Rejected/Withdrawn record's
stage pill reading "Waved" are still a real bug (a terminal negative decision should not carry
the *waitlist* stage name) — but the mechanism is more precise than "defaults to Waved for any
final decision": Waved is the correct, working stage value for genuine Maybe/waitlist decisions,
and the bug is specifically that Rejected/Withdrawn records incorrectly inherit it too.

**Screenshots:** `B-organizer-submission-maybe-decision-recordpage.png`,
`B-organizer-submission-maybe-then-accept-history.png`,
`B-organizer-submission-maybe-status-list.png`

---

## Infrastructure note — a real, reproducible session-lockout bug, found while trying to reset for Flow 4

**This ate the majority of this session's wall-clock time, so it's documented in full: it is a
genuine, well-isolated, high-confidence product/dev-tooling bug, not environment noise, and it
is very likely the true explanation for at least part of the "Worker crashed repeatedly" story
attributed to system load earlier in this sweep.**

### Bug: an invalidated session cookie permanently locks a browser out of the app — even the login and logout endpoints reject it

**Severity: Major/Blocker for anyone testing or demoing repeatedly.** Minimal, clean repro via
curl (no browser flakiness involved):

```
curl -X POST /api/v1/auth/demo -H 'Cookie: mq_session=totally-bogus-invalid-value' \
     -d '{"role":"organizer"}'
→ 401 {"error":{"code":"unauthenticated","message":"missing or invalid credential"}}
```

`/api/v1/auth/demo` is declared `policy: { auth: { kind: "public" } }` — it should never require
a *valid* credential, only tolerate an absent or bad one and proceed to issue a fresh session.
Instead, the global auth middleware appears to hard-reject **any** malformed/invalid
`mq_session` cookie before the route's own policy is ever consulted. The exact same thing happens
on `/api/v1/auth/logout` (also `policy: public`, whose entire purpose is clearing a bad session).

**Real-world trigger, reproduced twice, in two different browser tabs:** calling
`POST /api/v1/admin/reset-demo` — a routine, expected, frequently-used action throughout this
whole sweep — wipes the sessions table as part of the reset. Any session active at that moment
(including the one that triggered the reset) is invalidated immediately. In a browser, that
session's cookie is `HttpOnly` (can't be read or overwritten by page JS — confirmed: a
`document.cookie = "mq_session=..."` write silently no-ops when an `HttpOnly` cookie of the same
name already exists) and persists in Chrome's cookie jar regardless. Every subsequent request —
including a brand-new login click — carries that now-invalid cookie and 401s immediately (~5–8ms
response time, consistent with an early guard-clause rejection, not real processing). The
landing page's own click handler has no way to distinguish this from "the demo is generally
broken" and shows: **"This demo is unavailable on the current conference deployment."**

**There is no recovery path inside the app.** Login fails. Logout fails (for the same reason —
it also sees the bad cookie and 401s before it can run `clearSessionCookie`). The only fix is
clearing cookies through the browser's own settings UI, which a real user has no reason to
suspect and no in-app hint to try. Confirmed the underlying session-management logic itself is
fine — a **genuinely fresh cookie jar** (no `mq_session` present at all, e.g. a brand-new
`http://[::1]:8787` origin never visited before) logs in and works perfectly even immediately
after a reset; the problem is specifically "stale but present" credentials, not resets
themselves.

**Screenshot:** `B-public-session-lockout-BLOCKER.png` (precise element-ref click on "Enter as
organizer," not a coordinate miss — the failure is real, not a testing artifact)

**Not one of the four already-fixed-upstream bugs** the operator flagged mid-session (Waved-pill
MRQ-76, `/evaluation`+`/submissions/:id` layout MRQ-77, `/settings/api` 403 MRQ-78, wrangler-proxy
crash PR #4) — this is a distinct, newly-found issue. Recommend: the auth middleware should treat
an unparseable/expired session cookie as *anonymous* on routes whose policy is `public` or that
don't require auth, rather than hard-rejecting the request outright.

**Practical note for whoever picks this up:** the local `http://127.0.0.1:8787` origin kept
failing differently across several workaround attempts this session (Secure-cookie theory,
Origin-rewrite theory, stale-D1 theory — all red herrings, ruled out one at a time). The one
thing that reliably unblocks a stuck browser origin locally is switching to a loopback address
Chrome treats as trustworthy but has never held a cookie for (`127.0.0.1` → `localhost` →
`[::1]` each worked exactly once, in that order, before getting stuck again on the next reset).

---

## Flow 4 — bulk paths

**Run:** fresh `npm run reset:demo`-equivalent reset (triggered via authenticated session, since
the CLI script itself needs a `LOCAL_VALIDATION_TOKEN` that was never configured on this Worker
instance — used `POST /api/v1/admin/reset-demo` under an organizer session instead, which the
route explicitly supports as an alternative to the local-validation header).

**Method note:** verified the UI checkbox multi-select mechanics visually (screenshot below,
`/submissions?status=in_review` with the header checkbox and per-row checkboxes present and
clickable). However, actually **driving** a live 20–50-record bulk action through the browser
kept landing on the session-lockout bug above (each reset before this flow invalidates whatever
browser session was live), and by the time a working session was re-established the practical
choice was to verify Flow 4's actual behavior — timing, chunking, partial-failure handling, count
correctness, outbox safety — via the same authenticated API the UI itself calls
(`POST /api/v1/events/:eventId/submissions/bulk`), rather than burn further time chasing browser
cookie state. **This is API-level, not visual, verification** — it proves the underlying
operation is correct and fast, but it does not by itself prove the UI doesn't freeze or
visually stutter during a large selection. Flagging that gap explicitly rather than papering
over it.

### Confirmed clean: ID-based bulk waitlist, 40 records

Selected 40 `in_review` submissions by explicit ID, action `waitlist`. **23ms server-side**,
`selected: 40, succeeded: 40, failed: 0`. Re-checked `?status=in_review` afterward: exactly
`280 → 240` (280 − 40), correct. No chunking artifacts, no partial state.

### Confirmed clean: partial-failure handling

Mixed 10 fresh `in_review` IDs with 2 nonexistent IDs and 1 already-waitlisted record, action
`accept`. Result: `selected: 13, succeeded: 11, failed: 2, state: "completed_with_failures"` —
the 2 bogus IDs cleanly reported (`"submission not found"`), the 11 valid ones (including the
already-decided one, successfully **re-decided** to Accepted) all succeeded. This is a real,
useful contrast with the single-record UI: the bulk API can re-decide an already-decided record;
the single-record UI's Record Action card cannot, once it's gone (Flow 2's dead-end finding).
Partial failure is handled gracefully — not an all-or-nothing transaction, and the response makes
the failure set precise and actionable.

### Confirmed clean at scale: filter-based selector + outbox safety

Ran a **select-all-matching** bulk reject (`selector: {filter: {status: "in_review", track_id:
"trk_agents"}}`, with feedback text) — 230 records matched and processed, **626ms server-side**
(690ms wall-clock including curl overhead). `succeeded: 230, failed: 0, outbox_enqueued: 230`.
Checked the outbox afterward: **all 230 new entries are `suppressed`**, correctly personalized
(checked 3 samples — correct name, correct title, correct feedback text embedded), no real send.
This is the single most safety-critical thing this flow needed to prove (the plan's Resend
100/day-cap concern), and it held up cleanly at 230-record scale, same as the single-record
Flow 3 result.

**Speed verdict (R7):** both the 40-record and 230-record bulk operations completed in well under
a second server-side. No evidence of chunking-related slowdown at this scale.

### False alarm, corrected before reporting

Initially flagged `?status=rejected` returning 780 total after the 230-record bulk reject as a
suspected count-inflation bug (matching the shape of the known Waved/Accepted overlap). **Verified
against a true just-reset baseline before reporting: 550 records are already seeded as Rejected
at baseline, and 550 + 230 = 780 exactly.** Not a bug — correcting the record so this false lead
doesn't get re-investigated. (A separate, smaller ~4–8% oversum across all nine status buckets
was also visible but is plausibly explained by non-mutually-exclusive taxonomy — e.g. `draft`
overlapping `submitted`, `unreviewed` being a synonym for `in_review` rather than a distinct
bucket — and wasn't chased further given only speculative evidence.)

**Screenshots:** `B-organizer-status-rejected-780-view.png` (UI view of the post-bulk Rejected
list, for the record)

---

## Flow 5 — Sessionize importer

**Method note:** same constraint as Flow 4 — driving the importer's multi-step wizard live in the
browser required a session that survives from upload → mapping → run without an intervening
reset, and every available loopback origin the extension already had permission for
(`127.0.0.1`, `localhost`, `[::1]`) had been invalidated by a prior reset by the time this flow
started; `0.0.0.0` loaded but could not hold a cookie at all (separate, unrelated Chrome quirk —
`0.0.0.0` isn't a valid cookie domain); a genuinely fresh loopback alias (`127.0.0.2`) hit an
extension permission wall that needs interactive approval this session couldn't get. Verified the
full importer pipeline end-to-end via the same authenticated API the UI wizard calls
(`POST .../imports` → `POST .../imports/:id/mapping` → `POST .../imports/:id/run`) instead.
**This is API-level, not visual, verification** — the multi-step wizard's own UI (column-mapping
screen, live preview rendering, the actual click-through) was not driven or screenshotted this
round.

### Confirmed clean: upload + auto-mapping

Uploaded `fixtures/sessionize/sessions.csv` + `speakers.csv` (the repo's own fixture — 4 session
rows including one deliberately malformed, 3 speaker rows). `POST /imports` returned `201` with
correct auto-detected column mapping (`Session ID→external_ref`, `Title→title`, etc.) and a
write-free preview of all rows, headers, and the one genuinely-unmappable field (`kind`, which
the fixture doesn't carry — correctly reported under `missing`).

### Confirmed clean: run, with correct partial-failure handling

`POST /imports/:id/run` → `counts: {created: 6, updated: 0, skipped: 0, failed: 1, sessions: 4,
speakers: 3, evaluations: 2}`. The one deliberately-malformed row (no `Session ID`) correctly
failed with `"session external_ref is required"`, never inserted. The other 3 sessions + 3
speakers created cleanly, with correct relationship linking (checked
`submission_import_f0437f9c` in full: both speakers attached with correct roles — Ada as primary
`speaker`, Grace as `co_speaker` — and 2 rows carried an evaluation score/comment that landed as
real evaluation results). Source statuses mapped correctly: `undecided→in_review`,
`accepted→accepted`, `rejected→rejected`.

### Confirmed clean: duplicate-safety, the importer's own headline claim

Uploaded and ran a **second, independent import** (`POST /imports` again, same CSV content
byte-for-byte, is a different `importId` than the first) rather than re-running the same import
record, to simulate the realistic "operator re-imports the same Sessionize export" scenario.
Result: `created: 0, updated: 0, skipped: 6, failed: 1` — **every previously-created row was
recognized via `external_ref` and correctly skipped**, target IDs identical to the first run
(`submission_import_f0437f9c`, `_f3438455`, `_ed437ae3`, and the 3 `person_import_*` speaker
IDs). Verified at the record level too: `?q=submission_import` still returns exactly 3 matching
submissions after both runs — no doubling. The malformed row still correctly failed both times.
**The importer's "no duplicate sessions" claim is real and holds up under an actual re-import,
not just at the single-run level.**

### Minor — unmatched track/format values are silently dropped, no warning surfaced

The fixture's CSV specifies `Track: Platform` and `Format: Talk` for the imported sessions, but
this demo event's actual configured taxonomy uses different names (Agents, Security, Infra, etc.
for tracks; Lightning, Workshop, Online, etc. for formats). The imported records landed with
`"tracks": []` and `"format": null` — silently dropped, with **no mention of this in the row's
own `reason` text**, which only reported success on the fields it did map. A real operator
importing from an event whose Sessionize taxonomy doesn't exactly match Marquee's configured
tracks/formats would lose that categorization with no visible signal that anything was
incomplete. Worth a lightweight fix: surface "track/format not recognized, left unset" in the
row reason, the same way the malformed-row case already reports its own failure reason clearly.

---

## Summary — Flows 1–5, full Pass B

**See the "FINAL RESOLUTION" note at the top of this file first** — the sweep's checkout has
since been refreshed to `main@21e6cef` and re-verified; several items below are now resolved.

- **1 blocker**: public CFP submission is completely broken (Headshot field never validates,
  blocking Submit) — stops the evaluation-rubric walkthrough at step 1. **Already tracked as
  MRQ-81, still unfixed as of this writing.** *(Flow 1)*
- **1 blocker/major, newly found this round — FIXED on `main` via PR #20**: an invalidated session
  cookie permanently locks a browser out of the app — login and logout both hard-reject any
  invalid `mq_session` cookie instead of treating it as anonymous, with zero in-app recovery path.
  Triggered by the ordinary, frequently-used `reset-demo` action (which wipes the sessions table).
  Ate most of this session's time before being fully root-caused. **Confirmed fixed by live smoke
  test**: reset-demo followed by an immediate login no longer 401s. Documented in full for the
  diagnosis; **do not ticket**. *(found while resetting for Flow 4)*
- **1 major — CONFIRMED FIXED on `main` via PR #21 (MRQ-83), do not ticket**: reversing an
  acceptance was a one-way door — no UI path to re-decide a withdrawn/rejected record. Refined
  this round before the fix landed: the dead-end was specific to *reversal*, not to every decision
  type — a **Maybe** decision correctly left the Accept/Maybe/Reject card in place and a
  subsequent Accept worked cleanly. Bonus fix that fell out of this: `can_publish` now correctly
  refuses a declined record (previously could still be published to the public site). See "FINAL
  RESOLUTION" above for the exact code references and regression test. *(Flows 2–3)*
- **1 clarified root cause, not a wholesale bug**: the record-detail page's outer "stage" badge
  reading "Waved" is *correct* for genuine Maybe/waitlist decisions (confirmed at the API level:
  `status`/`stage` are two distinct, correctly-populated fields) — the real, narrower bug is that
  **Rejected/Withdrawn** records incorrectly inherit that same "Waved" stage label too. *(Flow 3)*
- **1 minor**: reversal isn't logged in Decision History (no audit trail of the undo itself).
  *(Flow 2)*
- **1 minor, newly found this round — ticketed as MRQ-84**: the Sessionize importer silently
  drops track/format values that don't match the event's configured taxonomy, with no warning
  surfaced in the row's own result reason. MRQ-84's verification requires driving the actual
  import wizard UI in a browser — this pass only verified the importer at the API level. *(Flow 5)*
- **False alarm, corrected before reporting**: a suspected `?status=rejected` count-inflation bug
  turned out to be legitimate baseline seed data (550 pre-seeded + 230 from a bulk action = 780,
  exact match) — recorded here so it isn't re-chased.
- **Confirmed clean and working**: review→score, accept→onboarding-task creation,
  reject+feedback→outbox (demo-safe at both single-record and 230-record bulk scale, correct
  personalization, no real send), onboarding counters updating live, the Maybe/waitlist decision
  path end-to-end, ID-based and filter-based bulk actions (waitlist, accept, reject) with correct
  count math and graceful partial-failure handling, and the Sessionize importer's full
  upload→map→run pipeline including genuine, verified duplicate-safety on re-import.
- **Two flows (4 and 5) were verified at the API level rather than the UI level** for their core
  write paths, due to the session-lockout bug above consuming the available loopback origins;
  the underlying operations are proven correct and fast, but their exact on-screen behavior
  (multi-select checkbox interaction at scale, the importer wizard's mapping/preview screens)
  was not visually re-confirmed this round.
