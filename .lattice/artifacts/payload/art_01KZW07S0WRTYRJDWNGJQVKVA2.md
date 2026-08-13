# Plan Review: MRQ-153 — V2-4: the organizer sees the speaker Marquee already knows

Reviewed against the tree at `Marquee-worktrees/v2-4-speaker-identity` @ `5441cf1c`
(current `github/main` tip, "MRQ-148: one-action assisted placement (#135)"), which already
contains MRQ-138's `SpeakerFilesPanel`.

---

### 1. Verdict

**FAIL (plan-level)**

---

### 2. Summary

The submitted plan is a **verbatim copy of the task description** — same headings, same sentences,
zero added content. It names no files, no API changes, no tests, no sequence, and no risks. That
alone would be grounds to return the ticket to `in_planning`, but the substantive problem is worse:
**all three of "GOOD LOOKS LIKE" (a), (b), and (c) hit concrete blockers in the current code that
the plan never mentions** — a component signature that lacks the two IDs the serve endpoint needs,
an upload route that hard-refuses any principal uploading on someone else's behalf, and an invite
endpoint that emails the speaker, stamps `invited_at`, withholds the link outside demo mode, and
whose exchange overwrites the organizer's own session cookie. The ~60 min estimate is only credible
if the implementer discovers all four of these at the keyboard.

---

### 3. Issues

**[CRITICAL] "GOOD LOOKS LIKE" (b) — the admin headshot upload is refused by the API as written; the plan proposes no server-side work**

`POST` presign on `src/routes/uploads.routes.ts:388` reads:

```ts
if (ownerId !== session.person_id) {
  return uploadError(context, "forbidden", "headshot does not belong to the authenticated principal");
}
```

and the non-co-speaker branch then requires the *session's own* `role = 'speaker'` membership
(`uploads.routes.ts:416`, "speaker membership is required for a headshot upload"). An organizer
session uploading a headshot for a different person is rejected twice over. The related attach
step, `resolveHeadshot` (`src/routes/speakers.routes.ts:151-155`), only validates an *already
ready* attachment owned by that person — it cannot mint one. So (b) is not a UI-only change; it
needs a new or widened server path, plus its authorization story (who may overwrite a speaker's
own photo, and is that audited?). The plan describes (b) as "the record gains an 'Upload headshot'
control," implying a front-end control against an endpoint that already works. It does not.

**Recommendation:** Decide and write down the server design before implementation. Two credible
options: (i) relax the `ownerType === "person_headshot"` branch to also admit a session holding
`program:write` on an event the target person is a speaker/participant of, deriving `eventId` from
that membership rather than the session's own; or (ii) add a distinct organizer-scoped presign
route under the events namespace. Name the chosen file, the policy grant, and the integration test
that proves an organizer *of another org* is still refused.

---

**[CRITICAL] "GOOD LOOKS LIKE" (c) — reusing the invite machinery for a preview sends the speaker an email, falsely marks them invited, returns no link outside demo mode, and logs the organizer out**

The plan says to use "the magic-link machinery invites already use." That machinery is
`POST /api/v1/events/{eventId}/speakers/invite` (`src/routes/speaker-invites.routes.ts:31`), and
per-person it does four things an organizer-only preview must not do:

1. `enqueueAuthMail` + `enqueueMailMessage` (`:96`) — **the speaker receives a sign-in email** every
   time the organizer clicks "Open portal as." Directly contrary to PHILOSOPHY's "respect the
   operator" and a live-conference embarrassment.
2. `UPDATE participations SET invited_at = ?` (`:98`) — **corrupts invite state**, so the roster
   now claims a speaker was invited because an organizer looked at their portal.
3. `magic_link` is returned **only when `event.demo_mode === 1`** (`:108`). On a real conference the
   organizer gets a response with no link at all — the feature silently does nothing.
4. The link is exchanged at `GET /api/v1/auth/exchange`, which mints a session for the *speaker* and
   calls `setSessionCookie` on the same cookie (`src/routes/auth.routes.ts:281-286`).
   **The organizer is signed out of their own admin session** and must sign back in. A `login`
   magic link is also single-use with a 15-minute TTL (`src/lib/auth/magic-links.ts:10`), so the
   preview is one-shot.

There is no existing view-as/impersonation concept anywhere in `src/` (grep for
`view as|viewing as|impersonat|act as` returns nothing relevant) — this is a new mechanism, not a
reuse, and it is the single largest piece of unplanned work in the ticket.

**Recommendation:** Specify the preview mechanism explicitly. The lowest-risk shape that satisfies
"organizer-only, clearly labelled as viewing-as" is a **read-only server-rendered preview** — an
organizer-authenticated route (`program:read`) that renders the portal for a given `personId`
without minting any speaker session, with a persistent "Viewing as {name} — read only" banner. If a
real session is genuinely wanted instead, the plan must state how the organizer's session survives
(separate cookie, or an explicit "return to organizer view" re-auth) and must not route through the
invite endpoint. Either way: say which route file, which policy grant, and what the banner says.

---

**[MAJOR] "GOOD LOOKS LIKE" (a) — `SpeakerAvatar`'s current signature cannot call the serve endpoint; both call sites change**

The plan asserts "the roster AND the record both get it from this one change, by design of that
component." That is true of the *rendering*, but the serve endpoint is
`GET /api/v1/events/{eventId}/people/{personId}/headshot` (`src/routes/uploads.routes.ts:953`;
onboarding builds it at `src/ui/onboarding/OnboardingPage.tsx:94-96`), and the shared component
today takes only `{ name, attachmentId, size }` (`src/ui/speakers/SpeakerAvatar.tsx:22-27`) — it has
neither `eventId` nor `personId`. Both call sites must be changed:
`SpeakersPage.tsx:225` (`row.id` is available; `eventId` is a prop on the page) and
`SpeakerRecord.tsx:146`. This is small, but it is exactly the kind of "one change" that turns into
three files plus a props threading question, and an unwritten plan doesn't surface it.

Two smaller correctness notes in the same change:
- The current wrapper is `aria-hidden="true"`. Onboarding's uses `role="img"` with
  `aria-label="{name} headshot"`. Decide which — the eval harness is snapshot-driven, and an
  `aria-hidden` headshot is invisible to it (relevant to CNT-10's `cannot_judge`).
- Cache-busting: onboarding appends `?v={attachmentId}`. The admin-upload VERIFY step
  ("admin-upload replaces it after reload") depends on this, or the browser serves the stale image.

**Recommendation:** State the new signature (`{ eventId, personId, name, attachmentId, size }`),
list the three files, keep the `?v=` cache-buster, and match onboarding's `role="img"` + `alt`.

---

**[MAJOR] VERIFY — "'Open portal as' shows … a Rejected speaker's own status cards" depends on a sibling ticket, not on this one**

`portal.routes.ts` gates on a `memberships` row with `role = 'speaker'` (`:322-325`, `:289`), and
only acceptance grants that row — the brief's own section 3 says so under CFP-05, and V2-5
("Submitting a proposal gives you a seat that shows it") is the ticket that fixes it. A *Rejected*
speaker therefore has no membership, so "Open portal as" on them will 404 no matter how well (c) is
built. This ticket's stated verification cannot pass on its own.

**Recommendation:** Either declare the dependency (V2-5 / MRQ-150 must land first, and the VERIFY
step is checked after both merge), or scope this ticket's VERIFY to an Accepted speaker plus an
explicit "Rejected speaker renders the honest empty state, not a 404" assertion owned by V2-5.
Coordinate with the `v2-5-submitter-seat` worktree before starting.

---

**[MAJOR] Whole plan — it is the ticket text, not a plan**

No files listed, no ordering, no test plan, no risk section, no statement of what is out of scope.
The three sub-goals (a)/(b)/(c) are independently shippable and of wildly different cost — (a) is
~20 minutes, (c) as specified is a new subsystem — yet the plan gives no sequence, so a builder who
runs out of time will likely land the hard, half-finished one. There is also no mention of tests,
in a repo whose convention is visible and consistent (`tests/unit/speaker-files-panel.MRQ-138.test.ts`,
`tests/integration/api/speaker-invites.MRQ-113.test.ts` — unit for the component, integration for
the route, each named for its ticket).

**Recommendation:** Rewrite as a plan: ordered steps (a → b → c, so partial completion still ships
value), the file list per step, the named test files, and an explicit non-goal list. Confirm
`npm run pr-gate` is the exit condition.

---

**[MINOR] COORDINATE — MRQ-138 already shipped a headshot surface on this record; the plan doesn't say how the new upload control relates to it**

`SpeakerFilesPanel` (merged, present in this tree) deliberately includes the profile photo — its
header comment says the panel "has to include the profile photo the library deliberately leaves
out." It renders through `FileVersions` and shows "No profile photo uploaded yet." So the record
will now have **two** headshot surfaces: the files panel and the new upload control in the header
region. The ticket's COORDINATE line warns against "a second file-rendering path" but the plan
repeats the warning without resolving it.

**Recommendation:** Choose one: put the "Upload headshot" control *inside* `SpeakerFilesPanel`
next to the profile-photo row (reuses the panel's reload path and keeps one surface), or state
explicitly why the header needs its own and how the two stay consistent after an upload.

---

**[MINOR] Source brief is unreachable from any worktree at the path the plan gives**

The plan opens with "Source: `.briefs/eval-gap-v2-human-lens.md` … Read that section for the full
human-problem framing before starting." That file does not exist in the repo, in any worktree, or
anywhere in git history. It lives at
`/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.briefs/eval-gap-v2-human-lens.md` —
i.e. `../.briefs/...` from inside a worktree. An implementer following the instruction literally
gets a file-not-found and proceeds without the framing.

**Recommendation:** Correct the path in the plan to the absolute one, or copy the brief into the
repo. (Section 3 of it is worth reading — it already pinpoints
`SpeakerAvatar.tsx:24 attachmentId: _attachmentId` as the root cause and confirms no view-as
affordance exists anywhere, which is more than the ticket summary conveys.)

---

**[MINOR] Third duplicate avatar implementation left unaddressed**

There are now three: `src/ui/speakers/SpeakerAvatar.tsx` (organizer), a private `SpeakerAvatar` in
`OnboardingPage.tsx:100`, and `PublicSpeakerAvatar` in `PublicAgendaPage.tsx:897` (public, via
`lib/public-headshots.ts` — legitimately different, since public headshots have their own serve
path). Once the organizer one renders images, it and onboarding's are the same component with
different class names.

**Recommendation:** Not required for this ticket, but say so explicitly — either "fold onboarding's
into the shared component (className prop)" as a step, or "out of scope, tracked separately." Silent
duplication is how this stub was created in the first place.

---

### 4. Positive Observations

The **ticket** behind this plan is excellent, and its quality is why the gaps above are findable at
all. It states a human problem in a human's words ("no way to see what the speaker is seeing when
they call confused") rather than a change request; it names the exact eval criteria it closes and,
notably, explains *why* `cannot_judge` is mandatory work rather than optional polish (excluded from
the denominator, so it blocks a perfect score) — that reasoning is the kind of thing that usually
gets lost between audit and builder. The COORDINATE line correctly anticipates MRQ-138 as adjacent
surface and warns against a second file-rendering path. The VERIFY line is concrete and
observable — portal-upload, admin-upload-replaces-after-reload, an Accepted *and* a Rejected
speaker — and it is precise enough that reviewing it against the source is what surfaced the
portal-membership dependency.

The sub-goal decomposition (a)/(b)/(c) is also genuinely good: three independently valuable slices
of one human problem, and (a) is correctly identified as the high-leverage one because the shared
component fixes two surfaces at once. The plan needs to inherit that structure as an *ordering*,
not just a list.

The underlying codebase is well set up for this work — the serve endpoint exists and is proven by
onboarding, `headshot_attachment_id` is already carried on every speaker payload, and the stub's own
comment names the ticket it was waiting on. Part (a) really is close to a one-change fix. It is
parts (b) and (c) that need a plan.
