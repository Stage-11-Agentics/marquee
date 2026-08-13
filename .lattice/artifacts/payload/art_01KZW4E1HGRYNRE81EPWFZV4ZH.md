# Code Review: MRQ-153 — "the organizer sees the speaker Marquee already knows"

## 0. Scope note (read this first)

**The diff supplied in the review prompt is against the wrong base.** It contains ~30 files of
other tickets' merged work (MRQ-138, MRQ-141, MRQ-143, MRQ-150, MRQ-154, MRQ-158, CNT-12, the
`sequence/submission/index.html` page, the evaluation-committee batch, the publication-control
rewrite) and reads partly in reverse. None of that is MRQ-153.

I reviewed the actual ticket delta instead:

- Worktree: `deployments/Marquee-worktrees/v2-4-speaker-identity`, branch `v2-4-speaker-identity`
- Commits: `815ed760` (show speaker identity across organizer surfaces), `a09fa494` (label rejected speaker previews)
- Merge base with `github/main`: `acc19c8a`
- 11 files, +394 / −21

Also worth flagging for the board: **PR #147 carrying `815ed760` is already MERGED to `main`**
(main tip `c2c17a80`). PR #150 is still open on the same branch with the follow-up commit. So the
critical finding below is *already shipped on main*, not sitting in an unmerged PR.

Verification I ran on the branch: `tsc --noEmit` clean; the three touched test files pass
(18 tests, 3.0s); `npm run pr-gate` **passes** (75.6s of a 120s budget, trace-ac 0 uncovered).

---

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and (a) and (b) are built well. (c) — "open portal as this speaker" — is built
in a way that has a real authorization hole, signs the organizer out of their own seat, and does
not reliably open in the browser. The approach (reuse the magic-link machinery) is right; this
implementation of it is not.

## 2. Summary

Reviewed the SpeakerAvatar image path, the organizer headshot presign + attach path, and the new
`portal-preview` route with its record-header control. (a) and (b) are careful, idiomatic work that
reuses the existing `person_headshot` policy, the presign/local-shim/complete chain, and the
`resolveHeadshot` ready-and-ownership guard on the speaker PATCH — the roster and the record both
light up from one component change, exactly as the plan promised. The key finding is (c): the
portal-preview endpoint mints a *speaker login credential* but is gated at `program:read`
(ops-level, and satisfiable by a read-only scoped API token), which is a lower bar than the
`program:write` required to merely *email* the same kind of link; and once exchanged, the link
replaces the organizer's own `mq_session` cookie browser-wide, so "viewing as" is really
"signed in as."

## 3. Issues

---

**[CRITICAL] src/routes/speaker-invites.routes.ts:133 — a read-only principal can mint a speaker login session**

The route policy declares `auth: { kind: "grants", grants: ["program:read"] }` and the handler
enforces `authHasRole(auth, "ops", eventId)` (line 139). Per `scope-resolution.ts:90-101`, `ops`
maps to a minimum grant of `program:read`, and `GRANTS_BY_ROLE.ops` does **not** include
`program:write`. So the set of principals that can call this includes:

- an `ops` seat, which cannot even PATCH a speaker record (`speakers.routes.ts:359` requires `program:write`);
- **any API token scoped to `program:read` only** — the read-only reporting/agent token.

Calling it returns `{"url": "…/api/v1/auth/exchange?token=…"}`. Exchanging that URL mints a full
speaker session (`auth.routes.ts:280-286`), which can write the speaker's profile, upload files,
complete onboarding tasks, and confirm or decline participation. That is a straight read→write
escalation across the token scope boundary, and it is silent.

The inconsistency is visible inside this very file: `inviteSpeakers` (line 41), which only *emails*
a portal link, requires `program:write`. Handing the caller the raw credential is gated lower than
mailing it. The `rateLimit: { bucket: "read" }` on the same line compounds it — a credential-minting
POST is metered on the 600/min read bucket rather than the write bucket.

**Fix:** raise the declared policy to `grants: ["program:write"]` and `rateLimit: { bucket: "write" }`,
and raise the in-handler check to `authHasRole(auth, "program_lead", eventId)` so it matches both
the sign route (`uploads.routes.ts:852`) and the speaker PATCH. Consider also refusing token auth
outright (`auth.kind !== "session"` → 403): impersonation is a human organizer's action at a
browser, and there is no legitimate machine caller for it.

---

**[MAJOR] src/routes/speaker-invites.routes.ts:161-167 — the preview replaces the organizer's own session; "viewing as" is signed-in-as**

The minted link points at `/api/v1/auth/exchange`, which calls
`setSessionCookie(context, session.id, …)` (`auth.routes.ts:285`). `mq_session` is a single
`path: "/"` cookie (`src/lib/cookies.ts:6-11`). Opening the preview in a new tab of the same
browser therefore overwrites the organizer's session cookie **for the whole origin**. The organizer
returns to their admin tab as the speaker: the SPA's next call 401/403s and bounces them to
`/signin`. Their previous session row is never revoked, just no longer presented — it is simply lost
to them.

That is the opposite of a preview, and the banner ("Viewing as speaker · organizer preview") makes a
promise the mechanism does not keep. The task's own VERIFY step — click through an Accepted and a
Rejected speaker — costs the organizer their seat twice. In an eval/demo context, a judge who clicks
this control is ejected from the organizer walkthrough.

**Fix:** the least-invasive version is to make the preview explicitly disposable and say so: return
the URL, and have the control open it with clear copy ("opens a speaker session — you'll be signed
out of the organizer seat; sign back in at /signin"), plus a one-click way back. The correct version
is a scoped preview that does not touch `mq_session` — e.g. a second, short-lived cookie name
(`mq_preview`) that the auth middleware honours only on `/portal` and only when a real organizer
session also exists, so both identities coexist and closing the tab ends the preview. Either way,
the current silent swap should not ship as-is.

---

**[MAJOR] src/ui/speakers/SpeakerRecord.tsx:162-178 — the pre-opened tab is dead code; the real open happens after an await**

```ts
const previewWindow = window.open("about:blank", "_blank", "noopener,noreferrer");
…
if (previewWindow) previewWindow.location.href = body.url;
else window.open(body.url, "_blank", "noopener,noreferrer");
```

Per the HTML spec, `window.open` with `noopener` in the features string **returns null** while still
opening the tab. So in every modern browser `previewWindow` is `null`:

- a stray `about:blank` tab is opened on every click and never closed (`previewWindow?.close()` at
  line 178 is a no-op on the error path too);
- the actual navigation falls to the `else` branch, which runs *after* an `await` — outside the
  synchronous gesture handler. Safari blocks that outright; Chrome allows it only while transient
  activation survives (~5s), so a slow mint silently does nothing.

Net effect: at minimum an orphan blank tab every time, and in Safari the control appears to do
nothing while having already minted a live 15-minute speaker login link server-side.

**Fix:** pre-open without `noopener` so you get the handle, then sever the opener yourself:

```ts
const previewWindow = window.open("about:blank", "_blank");
if (previewWindow) previewWindow.opener = null;
…
if (previewWindow) previewWindow.location.href = body.url;
```

and on failure `previewWindow?.close()` now actually closes it. Alternatively drop the pre-open and
render the minted URL as a real `<a target="_blank" rel="noopener noreferrer">` the organizer
clicks — no popup heuristics involved at all.

---

**[MAJOR] src/routes/speaker-invites.routes.ts:157-168 — impersonation leaves no audit trail**

The handler mints a session-granting credential for another person and writes nothing to the audit
log. The codebase has `writeAudit`/`auditStatement` (`src/lib/audit.ts`) and uses it for far less
consequential record actions; the product explicitly sells "attributed history." As built, there is
no way to answer "who opened whose portal, and when" — and given the CRITICAL above, no way to
detect the escalation after the fact either. The one-line test assertion that `participations.invited_at`
is unchanged is good (it proves the preview doesn't masquerade as an invite), but silence in the
audit log is not the same as harmlessness.

**Fix:** write an audit row (actor, target person, event, action `speaker.portal_preview`) in the
same request, before returning the URL.

---

**[MINOR] src/routes/speaker-invites.routes.ts:141-156 / src/routes/uploads.routes.ts:837-851 — the "is this person a speaker on this event" query is now copy-pasted three times**

The same ~15-line `memberships OR participations` eligibility SQL now appears in
`previewSpeakerPortal`, in `signOrganizerHeadshot`, and (in an `IN (json_each(...))` variant) in
`inviteSpeakers` at line 53. Three copies of one authorization predicate is three places to forget
when the speaker model changes.

**Fix:** extract `isEventSpeaker(db, eventId, personId): Promise<string | null>` into
`src/routes/speakers.queries.ts` (or a small `lib/auth/speaker-scope.ts`) and call it from all three.

---

**[MINOR] src/ui/speakers/SpeakerRecord.tsx:148 — the client size limit is a hardcoded literal, not the server's constant**

`maxBytes: 10 * 1024 * 1024` duplicates `HEADSHOT_MAX_BYTES` from `src/lib/r2/policy.ts:16`. The
accept list `["jpg","jpeg","png","webp"]` likewise restates `IMAGE_RULES`. When the policy changes,
the client silently disagrees with the server and users get a generic presign rejection instead of
the fast local message this call exists to produce.

**Fix:** `import { HEADSHOT_MAX_BYTES } from "../../lib/r2/policy"` and derive the accept list from
`IMAGE_RULES` (the portal's task-upload path already takes its limits from server-supplied
`task.payload.max_bytes` — same instinct).

---

**[MINOR] src/ui/speakers/SpeakerAvatar.tsx:44-45 — the aria-label claims a headshot that isn't there**

`aria-label={`${name} headshot`}` with `role="img"` is applied unconditionally, including on the
initials fallback — so a screen reader announces "Priya Raman headshot" for a speaker who has never
uploaded one, immediately followed by the visible name and email in the same row. The previous
`aria-hidden="true"` was correct for the roster precisely because the name is right there. This is a
small untruth in a codebase whose philosophy is built on not telling them.

**Fix:** label conditionally — `role="img"` + `aria-label={`${name} headshot`}` when an image is
actually rendering, `aria-hidden="true"` when it falls back to initials.

---

**[MINOR] src/ui/speakers/SpeakerRecord.tsx:236 — the header button relabels to a shorter string and shifts Close**

`{previewBusy ? "Opening…" : "Open portal as this speaker →"}` changes the button's width mid-flight,
which moves the Close button beside it. This repo already fights that battle explicitly — see
`SpeakerStatusBadge` ("Fixed width and a constant label length band") and `.speaker-save-state`
("Reserved so 'Saved' appearing never nudges the button beside it") — and it's a standing global UI
rule.

**Fix:** give the button a `min-width` in `speakers.css` sized to the long label, or keep the label
constant and show the busy state with `disabled` + a spinner glyph.

---

**[MINOR] src/ui/onboarding/OnboardingPage.tsx:95-105 — the second avatar renderer survived**

The plan's stated design is "SpeakerAvatar … the roster AND the record both get it from this one
change, by design of that component." Onboarding still carries its own local `headshotUrl()` and
`SpeakerAvatar` — now character-for-character the same logic as the new shared one. It works, but
"the one avatar renderer for organizer-side speaker surfaces" (the component's own doc comment) is
now false for the third organizer-side speaker surface.

**Fix:** import `SpeakerAvatar` / `speakerHeadshotUrl` from `src/ui/speakers/SpeakerAvatar` in
OnboardingPage and delete the local copies (the class-name difference can be a `class` prop).

---

**[MINOR] src/ui/portal/PortalPage.tsx:824, 889 — the banner says "speaker" on the submitter portal, and any speaker can self-apply it**

The submitter seat renders "Viewing as **speaker** · organizer preview" — but a submitter is
precisely someone who may never become a speaker (the follow-up commit exists to cover the *rejected*
case). Separately, `viewing_as` is read straight from `window.location.search` with no corroboration,
so a real speaker handed a URL with `?viewing_as=speaker` sees an "organizer preview" banner on their
own portal. Cosmetic — no data crosses — but confusing in the one place this product tries hardest to
be plain.

**Fix:** word the banner from the seat (`Viewing as this submitter` / `Viewing as this speaker`), and
have the portal snapshot carry a `viewing_as` flag from the session's `role_hint` rather than
trusting the query string. `mintPortalMagicLink` could set `role_hint` at exchange time the way
`cospeaker_profile` already does (`auth.routes.ts:270-279`), which would also give the server a
durable record that this session was a preview.

---

**[MINOR] tests — the organizer upload path is tested at both ends but not through the middle**

`speaker-files.MRQ-138.test.ts` covers the presign (403 for a speaker, 200 + pending row for an
organizer) and the attach (PATCH with an already-`storeUpload`-ed attachment), which is good
coverage of the two guards. But nothing exercises sign → local PUT → `/api/v1/me/uploads/{id}/complete`
as one chain, which is the path the UI actually walks and the one that depends on `handleComplete`
being token-gated rather than identity-gated (`uploads.routes.ts:524`, `auth: { kind: "public" }`).
That's the seam most likely to break under a future auth tightening, and the test that would catch it
is a few lines given the shim is already wired into `runtimeEnv()`.

Likewise there is no test asserting *who* may call `portal-preview` — the one preview test uses an
organizer session only. A `program:read`-token case would have surfaced the CRITICAL above.

**Fix:** add a `CONTRACT · MRQ-153` test walking the full upload chain, and one asserting a
read-scoped principal is refused the portal preview.

---

## 4. Positive Observations

- **(a) and (b) are genuinely good.** `SpeakerAvatar` follows the onboarding pattern exactly as the
  plan asked, and because the roster and the record both draw through it, one 20-line component
  change lights up both surfaces — the design bet in the ticket paid off literally.
- **Reuse over reinvention on the upload path.** `signOrganizerHeadshot` uses the existing
  `person_headshot` policy, `insertPendingAttachment`, `objectKeyFor`, `signUpload`, the same
  completion-token HMAC shape, and the same delete-on-signing-failure cleanup. The attach side rides
  the pre-existing `resolveHeadshot` guard in the speaker PATCH, so ready-state and
  owner-must-be-this-person are enforced by machinery that was already trusted — no second policy to
  drift.
- **The cache-busting `?v=<attachmentId>`** is the right call and makes the "admin-upload replaces it
  after reload" VERIFY step actually work against the `private, max-age=300` served headers.
- **The preview test asserts a negative that matters** — `participations.invited_at` unchanged before
  and after — proving the preview doesn't quietly count as an invitation. That's the kind of
  assertion most authors skip.
- **The image-error fallback is properly reset on `src` change** (`useEffect(() => setFailed(false), [src])`),
  so replacing a broken headshot with a good one recovers without a remount. Easy to get wrong.
- **The object-URL lifecycle is handled** — revoked on replacement, on save, and on unmount.
- **Craft carried through to CSS**: `.speaker-avatar img { object-fit: cover }`, the reserved
  96×96 preview box, and the flex-wrap header actions all match the surrounding Flight Deck idiom.
- **The gate is green and honest**: types clean, `pr-gate` passes at 75.6s of 120s, trace-ac reports
  0 uncovered, and the new tests carry `CONTRACT · MRQ-153` titles per convention.
