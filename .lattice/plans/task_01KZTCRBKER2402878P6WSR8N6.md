# MRQ-106: Wave 0: eval free wins and truthful notes

Wave-0 sweep, ships first. Six items from `sequence/eval-response-tickets.md` §T-Z, plus register
rows 51–52 and the free-wins list. No schema, no new subsystem.

Working against `github/main @ 23a06b0`. Worktree `Marquee-worktrees/mrq-106-wave0-sweep`.

---

## Item 1 — VERIFY the headshot upload on live — **DONE, PASS** (gate result)

**Result: the live public CFP headshot upload works.** Reported to the Orchestrator before any
other work, as the ticket requires.

Evidence (real browser session, c11 browser surface, live site — not localhost):

- Live build is `709f9ca7`; `git merge-base --is-ancestor 1fc2e2e 709f9ca` → true, so the fix
  (`1fc2e2e`, MRQ-92) is deployed.
- Navigated `https://marquee.stage11.dev/f/cfp`, filled title / speaker name / speaker email
  (`ensureDraft()` hard-requires an address), then injected a **real 256×256 PNG** (2175 bytes,
  canvas-generated, not a stub) into `#public-headshot` via `DataTransfer` + a bubbling `change`
  event — the same path a human file-picker takes.
- After the round trip the field reads **`Saved file: mrq106-probe.png`** with class `has-file`,
  and the crop preview rendered.
- That label is proof, not decoration: `PublicForm.tsx:385` calls `setAnswer(field.key, {attachmentId…})`
  — the only thing that sets `existing` — and it is reached only after **sign → R2 PUT → complete**
  all resolve (`PublicForm.tsx:373-383`). Any failure in that chain lands in the `catch` and shows a
  page error instead. No page error appeared.
- Screenshot: `docs/evidence/mrq-106/live-headshot-upload.png`.

Nothing downstream is blocked. CFP-S2's 43 turns and CFP-S3's 20 turns on this field are recovered.

## Item 2 — truthful `submissionNotes` + a generator with teeth

**The problem, precisely.** `src/index.ts:163` is `app.all("*", … ASSETS.fetch(…))`, so *every*
unmatched path returns HTTP 200 with the SPA shell. `/site`, `/settings/webhooks`, and `/comms` all
answer 200 while being nothing. A probe cannot catch this; only generation from the route sources
can. Hand-maintained notes have now lied twice (register row 52).

**Generator — `scripts/checks/check-routes.mjs`**, two sources, no hand-maintained list:

1. **SPA routes**: `import` `src/ui/shell/route-table.ts` directly (Node ≥22.18 strips types; the
   repo already does this for `scripts/seed/index.ts`). The file has no runtime imports, so it loads
   clean.
2. **Public/organizer split**: parse the `isPublicPage` initializer out of `src/ui/app.tsx` and
   rebuild it as a predicate — `=== "X"` → exact, `.startsWith("X")` → prefix, `/re/.test(…)` →
   regex. If the shape of that expression ever changes so the parse yields nothing, the script
   **fails loudly** rather than silently emitting a wrong split.
3. **Server-rendered page routes**: scan `src/routes/*.route.tsx` for `.get("<path>")` registrations
   (`/`, `/agenda`, `/s/:slug`, `/p/:slug`, `/f/:slug`, `/embed/config`, `/embed/:slug`,
   `/:eventSlug/:kind/embed`). These are the pages that exist *outside* the SPA.

Emits `docs/ROUTES.md`, whose body includes a fenced `ROUTES` block that is literally the text to
paste into an agent-facing description of the app. `--write` regenerates; bare run diffs and exits
non-zero on drift. Wired into `pr-gate.mjs` as `route map` and exposed as `npm run check:routes`.

**Then fix the notes in place** in `/Users/atin/Projects/Stage11/deployments/Marquee/.eval-kit/evalconfig.json`
(gitignored third-party, edited in the primary checkout only, never committed, never read *into* the
repo). Corrections: drop `/site` (does not exist — the public conference site is `/agenda`); drop
`/settings/webhooks` (does not exist); `/comms` → `/communications` in both the ROUTES block and the
MAIL paragraph; move `/agenda` to the public list and name `/agenda-builder` as the organizer's
builder; add `/embed/config`, `/delivery-health`, `/submissions/new`, `/board`, `/settings/venues`,
`/settings/tasks`, `/co-speaker`.

**One more lie I must fix, because item 6 would otherwise make it worse:** the MULTI-EVENT paragraph
claims "the sidebar shows a 'Conference switcher' affordance, but it opens a modal that says 'Not
installed'". There is no modal — `Sidebar.tsx:11` is a plain `/dashboard` link. Item 6 relabels it;
the note must describe what item 6 ships, or I would be shipping a fresh falsehood.

## Item 3 — sidebar rows

`src/ui/shell/route-table.ts`:

- **Embeds → `/embed/config`.** `embed.route.tsx:69` serves it server-side, and `app.tsx`'s
  `startsWith("/embed/")` marks it public — so the row **must** carry `external: true`, or the
  sidebar's client-side push would land the SPA on a route it does not render and draw the "not
  installed" empty state. This is the cross-cutting trap #3 in miniature: a discovery affordance
  onto a broken flow scores worse than no affordance. `external: true` navigates for real, to the
  builder that already works.
- **`sidebar: true` on `/submissions`** ("Abstracts & sessions") — two w3 rubric items say "the
  organizer's submissions list" and it currently has no link at all (register row 51).
- **`/submissions/new`** gets a sidebar row ("+ Add session") — the row exists in the table already
  but is not in the sidebar.

Group placement: `submissions` and `submission-new` belong at the head of `pipeline` (they are the
list and its create action, not "System"); `embeds` joins `modules` next to the other outward-facing
surfaces.

## Item 4 — restore `Agenda data ↗`

Removed at `2915df9` (MRQ-94). Restore one anchor in `src/ui/public/agenda/PublicAgendaPage.tsx`'s
header actions: `<a class="public-button" href={`/api/v1/public/agenda?${eventQuery}`}>Agenda data ↗</a>`.
File-ownership rule 5 gives `PublicAgendaPage.tsx` to T-I; this is one line in the header, named by
T-Z item 4 and by T-K step 2 — I take it and note the shared file in the completion comment.

## Item 5 — `?status=accepted` escape hatch

`SubmissionsPage.tsx`. `accepted` is a *pipeline stage* (excludes records with open tasks);
`accepted_any` is the stored fact. An agent that types `?status=accepted` on a conference with ~150
accepted talks currently sees zero rows and no way out.

When `status === "accepted"` **and** the envelope total is 0, fetch the `accepted_any` count
(one `per_page=1` request, fired only in that dead-end state) and render inside the existing
empty-state row: `0 in Ready to place · N accepted overall` + a **View all accepted** control that
swaps the param to `status=accepted_any`.

**Elements never jump:** the note's slot is reserved the moment the dead-end state renders, so the
async count arriving does not shift the row; the number is `tabular`. If the count comes back 0 or
the request fails, the slot stays reserved and empty — no promise the data does not support.

## Item 6 — de-dress the fake event switcher

`Sidebar.tsx:11` renders `class="event-switcher"` — a bordered, hover-highlighted, two-line control
that reads as a picker — around a plain `/dashboard` link. Nothing switches. Fix honestly: keep the
conference name visible (it is genuinely useful context), drop the control affordance. Render it as
a non-interactive `<div class="event-context">` with the same `Conference / <name>` shape, restyled
flat: no hover state, no border-as-button. Add `.event-context` to `components.css` and to the two
responsive rules that currently hide `.event-switcher`. When T-M lands a real switcher it replaces
this element with a real control, which is exactly the right seam.

Not a label like "(single conference)" — a caption explaining that a control is fake is worse than
not drawing the control. The honest version simply is not a control.

---

## Verification

- Targeted vitest on touched files only (fleet load rule: **never** the full `npm test` outside the gate).
- `node scripts/checks/check-routes.mjs` — clean, then deliberately drift `route-table.ts` and
  confirm it fails.
- Local runtime (`npx vite dev`) driven in the c11 browser: sidebar rows navigate, `/embed/config`
  loads its builder, `?status=accepted` dead end shows the escape and the swap works, agenda feed
  link resolves, event switcher no longer reads as a control.
- `npm run pr-gate -- --ticket MRQ-106` after an `uptime` load check (< 24 on the 1-min figure).

## Files

| File | Item |
|---|---|
| `scripts/checks/check-routes.mjs` (new) | 2 |
| `docs/ROUTES.md` (new, generated) | 2 |
| `package.json`, `scripts/checks/pr-gate.mjs` | 2 |
| `src/ui/shell/route-table.ts` | 3 |
| `src/ui/public/agenda/PublicAgendaPage.tsx` | 4 |
| `src/ui/submissions/SubmissionsPage.tsx` | 5 |
| `src/ui/shell/Sidebar.tsx`, `src/styles/components.css` | 6 |
| `tests/…` + `tests/ac-claims/MRQ-106.json` | all |
| `.eval-kit/evalconfig.json` (primary checkout, **never committed**) | 2 |

## Rubric IDs touched

EMB-15 (w3, embeds area discoverable), the two w3 items naming "the organizer's submissions list"
(register row 51), CFP-02/03/04 turn recovery via the verified upload, and the AIA area protected by
truthful routes (register row 52).

---

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Self-review inline (COMMON permits it; this is a six-item sweep of small, independent edits, and a
spawned reviewer over an unwritten diff would add latency without adding eyes). Four findings, all
resolved here; the diff still goes to a spawned reviewer.

1. **Sidebar group placement was wrong.** The `pipeline` group is a numbered ladder (icons `1`–`7`).
   Dropping "Abstracts & sessions" and "+ Add session" into it breaks that sequence visually for
   every organizer, forever, to satisfy a rubric line. **Resolution:** both rows go in `home`,
   beside "Program home" and "Program board" — which is what they are: top-level entrances, not
   lifecycle stages. Icons `▤` and `+`.

2. **`tests/unit/route-table.test.ts` encodes the sidebar order as a CONTRACT against the binding
   prototype.** Adding three rows breaks it. **Resolution:** update the expected order and treat it
   as a deliberate, named deviation from prototype-fidelity — the prototype has no Embeds area and
   no submissions-list link, and `DESIGN.md` cannot have anticipated the discoverability finding.
   Reported as **deviate-with-flag** in the completion comment; I do not edit `DESIGN.md`.

3. **`tests/node/mrq-99-organizer-copy.test.mjs:12` pins `<a class="event-switcher" href="/dashboard"`.**
   Item 6 removes exactly that. **Resolution:** preserve the test's real intent — MRQ-99 removed a
   dead-end overlay — by keeping the `unavailable(` / `unavailable = useCallback` negative
   assertions and re-pointing the positive one at the honest non-interactive element. The dead end
   stays dead; it does not come back as a link either.

4. **The `accepted_any` count needs a bound.** An unconditional second request on every
   `/submissions` render would tax the list this project treats speed as a feature of (R7).
   **Resolution:** the request fires only in the exact dead-end state (`status === "accepted"` and
   total 0), at `per_page=1`, once per entry into that state.
