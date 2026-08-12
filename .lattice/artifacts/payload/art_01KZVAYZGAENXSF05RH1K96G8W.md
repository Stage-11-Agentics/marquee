# Code Review — MRQ-130: "Hand this to your agent" (PR #95, branch `mrq-130-agent-briefs`)

Reviewed cold against the worktree at
`/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-130-agent-briefs`
(`b087980`, off `cd907d3`), the binding prototype, and the live API route
definitions.

## 1. Verdict

**PASS**

Four minor issues below — one of them a test that cannot fail for the reason it
was written — none of which block the PR. The PR is correctly marked *do not
merge* (post-deadline scope, human-gated behind the competition freeze, cf.
MRQ-105); nothing here changes that.

## 2. Summary

A shared presentational panel (`AgentBriefPanel`) plus a trigger/overlay
(`AgentBriefLauncher`), four per-surface briefs as pure copy, one stylesheet of
tokens only, and one fast unit file — 499 added lines, four existing files
touched by one added element each. I verified independently rather than taking
the PR's word: `npm run pr-gate -- --ticket MRQ-130` **passes** (32.0 s of a
120 s budget, fast suite hermetic and in budget), `tsc --noEmit` is clean, and
the ticket's own unit file is 13 tests in 160 ms.

The load-bearing content checks out against the real system, which is where a
ticket like this usually fails. All four endpoints named in the briefs exist
with the stated method (`POST …/forms`, `…/comms/send`, `…/agenda/items`,
`…/speakers/invite`); `/api/openapi.json` is real (`src/api/openapi.ts:26`);
`Settings → API tokens` matches the actual nav label (`route-table.ts:66`); the
chase brief's promised receipt — *selected / queued / duplicate / outbox_ids* —
maps field-for-field onto `sendResponse` (`comms.routes.ts:145-156`); the CFP
brief's "leave it as a draft … I want to delete that form_id" matches the
handler, which creates as `'draft'` and only permits delete while draft with no
responses (`forms.routes.ts:333, 437`); the agenda brief's version/If-Match
sentence is scoped correctly to *moves* — `updateAgendaItem` is `if-match`,
`placeAgendaItem` is not; the onboarding board the chase and portal briefs tell
the agent to read is a real endpoint, not a UI-only route
(`onboarding.routes.ts:19`). Panel fidelity to `prototypes/crm/index.html`
`modalImport()` is one-to-one, down to the `1.65` line-height, the
`width:100%; min-width:0` copy button inside the box, and the muted trailing
line carrying the endpoint as an inline span rather than a second code block.

## 3. Issues

**[MINOR] src/ui/agenda/AgendaPage.tsx — the additive guard for Agenda is vacuous**
`tests/unit/agent-briefs.MRQ-130.test.ts:783` pins Agenda's retained controls as
`["conflicts"]`, asserted by substring against the file's source text. That
string occurs many times in `AgendaPage.tsx` for reasons unrelated to the button
— `conflictsOpen`, `visibleConflictData`, `visibleVenueConflicts`, the notice
copy — so deleting the conflicts *button* to make room for the trigger would
leave this test green. That is precisely the failure the operator ruling of
2026-08-12 asked to be pinned, and Agenda is the one surface where the guard
does not hold. The other three files pin distinctive labels and are fine.
**Fix:** assert on something unique to the control, e.g.
`expect(content).toContain("setConflictsOpen(true)")` and
`expect(content).toMatch(/⚠ <span class="tabular">/)`, and consider adding
Agenda's other operable affordances (Publish, Review publication) to the list
the way the CFP row does.

**[MINOR] src/ui/shell/AgentBrief.tsx:47,50 — `<label for>` points at a `<pre>`, with a hard-coded id in a reusable component**
`for="agent-brief-text"` targets a `<pre>`, which is not a labelable element, so
the association is inert: clicking the label does nothing and assistive tech does
not read it as the block's name. The prototype's own `<label>` carries no `for`,
so this is an addition rather than a reproduction. The fixed `id` is the larger
half — the component is deliberately exported for MRQ-131 to render inside the
People → import modal, and any page that ends up with a panel and a launcher
mounted at once emits duplicate ids.
**Fix:** drop `for`, render the label as a `<span class="agent-brief-label">`
(matching the prototype), and name the block directly with
`aria-label={copy.label}` on the `<pre>`, or an `aria-labelledby` whose id is
generated per instance.

**[MINOR] src/ui/shell/AgentBrief.tsx:26-30,52 — the 2400 ms revert speaks through the live region**
The `aria-live="polite"` span *is* the button label, so the timed revert to
"Copy for your agent" is announced as if it were new information, and in the
clipboard-less path the "Selected — press ⌘C to copy" instruction is retracted
while the selection is still live and the operator may not yet have pressed the
key. The visual behaviour is right; only the announcement is noisy.
**Fix:** keep the visual label swap on the button and move the announcement to a
separate visually-hidden `aria-live` node that is populated on success and
cleared silently — or simply do not auto-revert the `"selected"` state, since the
panel unmounts with the modal anyway.

**[MINOR] Four surfaces — placement leads the action row where the plan said it would trail it**
The plan places the trigger *after* the existing actions on CFP, Agenda, and
Onboarding; the implementation prepends it (`<><AgentBriefLauncher …/><Button
…>`) on all three. Nothing is removed or disabled, and prepending arguably reads
better because `.head-actions` is `justify-content: flex-end`, so the primary
action stays anchored to the right edge. But the PR's additive table states
"nothing was removed, disabled, resized, or **reordered**", and the existing
buttons did shift.
**Fix:** cosmetic either way — append as planned, or leave it and correct the
one word in the PR body so the additive claim stays exactly true.

### Not issues, but worth carrying forward

- **`.head-actions` wraps at ~1145 px**, adding a header row on the densest
  screens. The PR discloses this honestly and it costs no control; the row
  already carries `flex-wrap: wrap`. If it bites in review, `small` on the CFP
  and Agenda triggers (Comms and Onboarding already pass it) buys the width back.
- **Cross-ticket reconciliation with MRQ-131.** MRQ-131's worktree currently
  inlines its own lookalike in `src/ui/people/PeopleModals.tsx:58-64`, and its
  brief opens `"Marquee is at this site"` — the placeholder this ticket
  explicitly forbids. That is MRQ-131's defect, not this PR's, but it is the
  fifth surface the ticket asked for, and the reconciliation onto
  `AgentBriefPanel` should be tracked before either lands.
- **CSS ordering holds by construction.** `.agent-brief-modal { width:
  min(620px,100%) }` overrides `.modal { width: min(540px,100%) }` only because
  `components.css` is imported at `app.tsx:4`, ahead of `AppShell` and therefore
  ahead of `agent-brief.css`. Same-specificity, order-dependent — fine today,
  and worth knowing if the entry's import order is ever rearranged.

## 4. Positive Observations

- **The copy was checked against the system, not written to sound plausible.**
  Every endpoint, response field, undo handle, and settings label in the four
  briefs resolves to something real. The chase brief's report-back list is the
  literal shape of `sendResponse`; the agenda brief asks for the version only on
  moves, which is exactly where `if-match` is enforced. This is the part of the
  ticket that would have failed silently, and it holds.
- **The distinctness test earns its place.** Filtering the shared contract
  paragraph and then asserting no two briefs share a sentence is a real guard
  against the generic-template failure the ticket calls out — a check that would
  be easy to fake with a word-count assertion and was not.
- **Prototype fidelity is genuine**, including the details that usually get lost:
  the button inside the recessed box, `min-width: 0; width: 100%` so the label
  swap cannot resize it, the endpoint as an inline muted span, `pre-wrap` rather
  than a scrolling terminal.
- **The clipboard fallback is a working path, not a dead button** — optional
  chaining for insecure origins, `.catch()` for a rejected write, and a
  select-all that leaves the operator one keystroke away.
- **Cost discipline:** pure copy module plus `preact-render-to-string` keeps the
  whole file at 160 ms with no Worker isolate, which is the right call in a repo
  with a 45 s suite budget and several agents building at once.
- **The token-only assertion** (no literal colors in the new stylesheet, checked
  by test rather than by eye) is the kind of check that keeps Night from
  drifting one component at a time.
