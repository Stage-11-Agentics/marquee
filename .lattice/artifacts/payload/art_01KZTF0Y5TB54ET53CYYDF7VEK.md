# Code Review: MRQ-106 — Wave 0: eval free wins and truthful notes

Reviewed at `ca0ecdc` in `Marquee-worktrees/mrq-106-wave0-sweep` (worktree clean, base `23a06b0`).

## 1. Verdict

**FAIL (implementation-level)**

The approach is right and most of the work is genuinely good. Two PR-gate checks are red on
this commit, both mechanical:

- `hermetic fast suite` — `tests/node/quick-search.AC-101-104.test.mjs` AC-101 fails.
- `merged AC trace` — `npm run trace:ac -- --scope=merged --ticket=MRQ-106` exits `fail` with
  8 `invalid-title-prefix` errors from this ticket's own new tests.

Neither is a design problem; both are ~15 minutes of work. Nothing here needs replanning.

## 2. Summary

Six-item sweep: a live-upload verification, a generated-and-gated route map, three sidebar
rows, a restored agenda feed link, an escape out of the `?status=accepted` dead end, and the
de-dressing of a fake event switcher. Craft is high — the generator is the right answer to the
`app.all("*")` 200-on-everything problem, the escape hatch respects "elements never jump," and
the switcher removal is honest rather than captioned. `npx tsc --noEmit` is clean,
`check:design` passes, `check:routes` passes, the unit half of Vitest is 280/280 green, and 128
of 129 node tests pass. **The one thing the ticket demanded loudest — the live headshot upload —
is genuinely working; I re-verified it independently against the live site** (details in issue
[MAJOR-1]). The blocker is that the gate was evidently not run to completion after the last
edits: two checks are red.

## 3. Issues

**[CRITICAL] tests/node/quick-search.AC-101-104.test.mjs:23 — the fast suite is red**

`src/ui/shell/route-table.ts` adds two new `external: true` rows (`embeds` at :39, `co-speaker`
at :50). AC-101 pins the exact set of external routes:

```
+   'co-speaker',
    'delivery-health',
+   'embeds',
    'event-site',
    'portal',
    'system-health'
```

`npm test` runs `tests/node/*.test.mjs` after Vitest (`scripts/checks/run-test.mjs:75-81`), so
this fails `npm test` and therefore the `hermetic fast suite` gate check. Both additions are
legitimate — a public server-rendered page and a speaker-seat page are correctly outside the
shared QuickSearch mount — so the contract's expectation is what needs to move, not the code.

**Fix:** update the two `deepEqual` expectations at :23 and :25 to
`["co-speaker", "delivery-health", "embeds", "event-site", "portal", "system-health"]` and
`[…, "reviewer", …]` respectively, with a one-line comment naming why each new row is outside
the admin shell. (The `admin.length === routeRows.length - external.length - 2` assertion at
:32 still holds; no other change needed.) Verified: with only that expectation updated, the
remaining 128 node tests pass.

---

**[CRITICAL] tests/unit/wave-0-sweep.MRQ-106.test.ts:6,19,30 · tests/node/wave-0-sweep.MRQ-106.test.mjs:8,15,30 · tests/unit/route-table.test.ts:22,29 — the AC trace gate is red**

`scripts/checks/trace-ac-core.mjs:46` requires every `test(…)`/`it(…)` title to begin with
`AC-<n> · ` (one or more) or `CONTRACT · `. All eight new test titles use `MRQ-106 · ` or no
prefix at all, so `trace:ac` reports `"status": "fail"` with 8 `invalid-title-prefix` errors —
the last check in `pr-gate.mjs`.

**Fix:** re-prefix all eight with `CONTRACT · `, following the convention this repo already
uses for ticket-scoped contracts (`tests/node/mrq-99-organizer-copy.test.mjs:9` is
`CONTRACT · MRQ-99 …`). E.g. `CONTRACT · MRQ-106 the route map is generated and gated, never
hand-written`. `tests/ac-claims/MRQ-106.json` needs no change — with `owns: []` the trace
reports `uncovered: 0` once the titles parse.

---

**[MAJOR] docs/evidence/mrq-106/live-headshot-upload.png — the committed evidence does not show what the plan cites it for**

The plan's item 1 says the screenshot shows the field reading `Saved file: mrq106-probe.png`
with class `has-file` and a rendered crop preview. It does not. The committed PNG is a viewport
crop showing a multi-select validation error, "Primary speaker name → Upload Probe", and
"Primary speaker email → mrq106-probe@example.com". The headshot field is not in frame. For the
ticket's one explicitly-gated claim ("report the result loudly"), the artifact of record has to
carry the proof.

**The claim itself is true.** I re-ran the whole chain against the live site independently,
outside a browser, and it works end to end:

- `/health` → `709f9ca7fd6a`; `git merge-base --is-ancestor 1fc2e2e 709f9ca` → true, so the
  MRQ-92 fix is deployed.
- `POST /api/v1/public/forms/cfp/drafts` → 201 with a resume token (Turnstile is exempt for
  this event, so no browser is required).
- `POST /api/v1/public/uploads/sign` (fieldKey `headshot`) → 200 with `attachmentId`, `putUrl`,
  `requiredHeaders`.
- Signed `PUT` of a real PNG to R2 → **200** (this is the CORS/signature step MRQ-92 fixed).
- `POST /api/v1/public/uploads/{id}/complete` → 200,
  `{"status":"ready","url":"https://media.marquee.stage11.dev/…","contentType":"image/png"}`.

So the item-1 gate holds, and the plan's inference from `PublicForm.tsx:385` is sound.

**Fix:** replace the PNG with one that actually frames the headshot field showing
`Saved file: …`, or drop the screenshot and cite the network-level evidence (sign → PUT →
complete status codes), which is the stronger artifact anyway.

*Housekeeping from both probes:* the delegator's run and mine each left a draft plus a stored
attachment on the live demo conference (mine: draft `628d04d2-a95f-467f-b718-53f3a811b260`,
attachment `d12d2ac7-0165-4557-b6d4-66449aa2701b`). Run `npm run reset:demo` before any eval
run so the graded build starts clean.

---

**[MAJOR] repo-wide — the ticket's "committed copy of truthful notes text" is only partly delivered**

The ticket says: *"put the generator + a committed copy of truthful notes text in the repo."*
The generator landed and `docs/ROUTES.md` commits the ROUTES block, but the rest of the
rewritten `submissionNotes` — the MULTI-EVENT paragraph (rewritten precisely because item 6
changes what is true there), the `/comms` → `/communications` MAIL fix, the reviewer-seat
limitation — exists only inside `.eval-kit/evalconfig.json`, which is gitignored third-party.
That text is careful, expensive work; if the kit is reinstalled or the machine changes, it is
gone and nothing in the repo can reconstruct it or review it.

I confirmed the live `.eval-kit/evalconfig.json` **is** correctly updated: `/site`,
`/comms`, and `/settings/webhooks` are gone, `/communications` and `/agenda-builder` are
present, and the switcher paragraph now reads "the sidebar prints the conference name as a
caption; it is deliberately not a control." So the work is done — it is just uncommitted.

**Fix:** add `docs/notes/eval-submission-notes.md` (or a fenced block in `sequence/EVAL-KIT.md`,
which already owns the "notes must be verified against the deployed build" lesson at :146)
holding the full notes text verbatim, and say in one line that it is the source copied into the
gitignored kit.

---

**[MINOR] .eval-kit/evalconfig.json (submissionNotes) — the notes claim to be generated, but are a hand-transcription that already differs from `docs/ROUTES.md`**

The notes now say the route list "is generated from the route sources (`docs/ROUTES.md`,
`npm run check:routes`), not written by hand." It was hand-transcribed, and it has already
drifted: it omits `/:eventSlug/:kind/embed` from the public list and `/delivery-health?view=system`
from the organizer list. Neither omission will hurt a grader, but a truthfulness document
asserting a provenance it does not have is the same class of defect the whole item exists to
kill — and the drift gate cannot see this file.

**Fix:** either soften to "derived from `docs/ROUTES.md`" (honest, costs nothing), or make
`check:routes` emit exactly the notes' block shape so the text can be pasted verbatim and
re-pasted after any route change.

---

**[MINOR] src/ui/submissions/SubmissionsPage.tsx:915-920 — the escape's copy over-claims when other filters are active**

`isAcceptedStageDeadEnd` fires on `status === "accepted" && total === 0` regardless of `q`,
`track`, `wave`, `format`, `task`, or `placement`. On `?status=accepted&q=zzz` the row asserts
"0 in Ready to place" and explains it as an onboarding-stage artifact, when the actual cause is
the search term; the count then reads "N accepted overall" while `acceptedAnyParams` has
correctly kept `q=zzz`, so N is not an overall figure. The click-through is consistent (that
was the right call), only the words are not.

**Fix:** either restrict the dead-end branch to the no-other-filters case and let the existing
"Clear filters" state handle the rest, or reword to "N accepted with these filters."

---

**[MINOR] src/ui/submissions/SubmissionsPage.tsx:920 — the count lands silently for screen readers**

The reserved slot is filled asynchronously with no `aria-live`, so a non-visual user who lands
on the dead end never hears that an escape appeared — and the button they could tab to was
`visibility: hidden` at the moment they arrived.

**Fix:** `aria-live="polite"` on the `.accepted-escape` span. One attribute; the visual
no-jump behavior is unaffected.

---

**[MINOR] src/ui/submissions/SubmissionsPage.tsx:915 and :930 — the empty-state row is duplicated wholesale**

The dead-end branch and the generic branch are two ~700-character JSX lines that differ only in
the middle. The generic line is now dead weight duplicated below a near-identical sibling, and
the next person to touch the empty state has to notice there are two.

**Fix:** compute the strings/actions above the `<tbody>` and render one `<tr class="state-row">`,
or extract an `EmptyStateRow` component taking `{title, copy, actions}`.

---

**[MINOR] src/ui/shell/route-table.ts:50 — `external: true` on `/co-speaker` overloads the flag**

`external` means "let the browser navigate; do not client-push." `/co-speaker` is rendered by
the SPA itself (`AppShell.tsx:123` returns `<CoSpeakerPage />`), so the flag is being used here
to mean "not an admin-shell page" — which is what `isAdminRoute` consumes, and exactly what
broke the AC-101 contract. The row is not in the sidebar, so no navigation is affected today,
but the next reader will take the flag at its documented word.

**Fix:** keep it (defensible — it is a distinct seat) and add the reason to the comment at
:47-49, or drop `external` and let `isAdminRoute` grow an explicit seat test.

---

**[MINOR] scripts/checks/check-routes.mjs:65-67, 79-84 — two parse heuristics that can fail in opposite directions**

`expression.split("||").length` as the clause count means a future `isPublicPage` written with
a `&&`, or with a `||` inside a string literal, throws and hard-fails the gate on a legal edit.
That is the intended fail-loud direction and I would keep it — but it should say so in the
error text (it currently blames "the expression's shape changed," which is right but reads as a
bug report rather than an instruction). Conversely, `serverPageRoutes` accepts any
`.get("/…")` anywhere in a `*.route.tsx` file, so a non-Hono `.get("/…")` call would silently
invent a route in the map — the exact failure mode this command exists to prevent, in the one
direction it is not defended against.

**Fix:** append "— update `scripts/checks/check-routes.mjs` alongside it" to the throw message,
and anchor the page-route regex to the app builder it is reading (e.g. require the receiver to
be the module's route object) so an unrelated `.get(` cannot contribute a path.

## 4. Positive Observations

- **The generator is the right instrument for the problem.** The diagnosis in the header
  comment — `app.all("*")` means every unmatched path answers 200 with the SPA shell, so no
  probe can distinguish a real route from a fictional one — is exactly why the hand-written
  list lied twice, and generation-from-source is the only fix that holds. Wiring it into
  `pr-gate.mjs` as `route map` is what makes it durable rather than a one-time cleanup. I ran
  it: `{"status":"pass","spaRoutes":29,"serverPages":8}`, and its output matches the real
  serving paths (all page modules mount at `/` in `src/index.ts:134-138`, so no prefix skew).
- **`external: true` on the Embeds row is the detail that makes item 3 worth shipping.** A
  sidebar link that client-pushes to `/embed/config` would draw the shell's empty state over a
  working server-rendered builder — a discovery affordance onto a broken flow, worse than no
  link. The route-table comment says so, and `tests/unit/route-table.test.ts:22` pins it.
- **Item 6 refused the easy version.** A "(single conference)" caption explaining that a control
  is fake would have been worse than the fake control; rendering a non-interactive
  `.event-context` and restyling it flat is the honest answer, and updating both responsive
  hide rules means it does not reappear at 1000px and 760px. No `event-switcher` reference
  survives anywhere in `src/`.
- **The no-jump work on the escape hatch is real, not asserted.** The slot is reserved with
  `min-height`, the button is `visibility: hidden` rather than unmounted (also keeping it out of
  the tab order until it means something), and the count is `tabular-nums` — and
  `tests/node/wave-0-sweep.MRQ-106.test.mjs:15` pins all three so the next refactor cannot
  quietly undo it.
- **`acceptedAnyParams` deletes `page`.** Page 3 of the stage-filtered result set would have
  landed the escape on an empty page — a second dead end at the end of the escape. Caught, and
  covered by a test that also verifies the input params are not mutated.
- **The count request is properly bounded:** fired only inside the dead-end state, `per_page=1`
  (valid; `src/api/list.ts:56` floors at 1), aborted on unmount, and a failure degrades to a
  silent empty slot rather than an error banner over a list that loaded fine.
- **Item 1 was treated as a gate, not a checkbox** — ancestry of `1fc2e2e` in the live build was
  checked before trusting the result, and the reasoning from `PublicForm.tsx:373-385` (only a
  fully-resolved sign → PUT → complete chain can set `existing`) is correct.
- Verified clean on this commit: `npx tsc --noEmit`, `npm run check:design`,
  `node scripts/checks/check-routes.mjs`, `npx vitest run tests/unit` (39 files / 280 tests),
  and 128/129 node tests.
