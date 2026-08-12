# Plan Review: MRQ-130 — "Hand this to your agent": copyable agent briefs

Reviewer: plan-review agent (Claude)
Reviewed against: task MRQ-130 (`task_01KZV8XBXS7SAFWM57Z99JSNSE`), the live tree at
`/Users/atin/Projects/Stage11/deployments/Marquee`, MRQ-131
(`task_01KZV8YEGMR0EERJRFJ6A5B4BK`), `DESIGN.md`, `prototypes/crm/index.html`.

## 1. Verdict

**FAIL (plan-level)**

The gaps are narrow and cheap to close — this is a revision, not a redesign — but two of
them land exactly on failure conditions the ticket states in its own words (a brief that
is not paste-ready; a surface whose existing affordances are not actually inventoried),
and one drops a listed surface with no mechanism behind the handoff.

## 2. Summary

I reviewed the four-surface plan against the ticket, the binding prototype, and the actual
source of the four screens it edits. The plan is unusually well-grounded — its stack
claims check out (`tests/unit` really is the Worker-free project, `preact-render-to-string`
is already a dependency, `pr-gate --ticket` is really required, `/api/openapi.json` is the
real constant, `/settings/api` really is where tokens are minted), and the
modal-not-panel argument for staying additive is sound. The key concerns are that the
ticket's required clipboard fallback is absent from the plan entirely, the Onboarding
control inventory the additive guarantee rests on is wrong, and the fifth surface is
handed to MRQ-131 with no mechanism and no board record.

## 3. Issues

**[MAJOR] Design contract / Test plan — the clipboard fallback the ticket requires is missing**
The ticket's SHAPE paragraph is explicit: "Clipboard via `navigator.clipboard` with a
visible confirmation; a **select-all fallback where it is unavailable**." The plan never
mentions `navigator.clipboard`, a rejected permission, a non-secure context, or any
fallback; the only copy-related line is the label swap under "Elements never jump," and no
test in the Test plan exercises copying at all. On four screens whose whole point is
"copy this text," a silent copy failure with a "Copied" label is the worst available
outcome.
**Recommendation:** State the copy handler explicitly: `await navigator.clipboard.writeText(...)`
inside try/catch; on success swap the label to "Copied" and announce via the `aria-live`
region already planned; on failure (or when `navigator.clipboard` is absent) select the
brief text programmatically (`Range`/`Selection` over the `<pre>`, which needs
`tabIndex={-1}`) and swap the hint to a select-all instruction. Add two tests that stub
`navigator.clipboard` present/absent. `src/ui/embeds/EmbedPage.tsx:138` already implements
the "Copy → Copied → revert" half of this and is the pattern to mirror.

**[MAJOR] Placement — the Onboarding control inventory is wrong, and the regression test is authored from it**
The plan says the Onboarding trigger is "appended to `PageHeader actions` after Import
speakers / Invite to portal / Send reminder. All three remain."
`src/ui/onboarding/OnboardingPage.tsx:242` has exactly **one** header action — `Send
reminder (N)` — and the strings "Import speakers" and "Invite to portal" do not appear
anywhere in the file. This matters more than a stale sentence: the plan's strongest
safeguard is a source-contract test asserting each surface "still contains every control
it had before … asserted by name," and that assertion list would be written from an
inventory that does not match the file. Three named-but-absent controls either fail the
suite immediately or, if the author reconciles by deleting them from the list, quietly
weaken the guard. (The other three inventories do check out: Forms has Duplicate / + New
form / the lifecycle button at `FormsPage.tsx:323`; Agenda has the conflicts button at
`AgendaPage.tsx:628`; Comms has the banner text and `.comms-policy` at
`CommsScreen.tsx:304-308`.)
**Recommendation:** Re-read all four files and record the real control inventory per
surface in the plan, then author the by-name assertions from the file rather than from
memory. Note also that Forms and Agenda render `PageHeader` in several branches
(loading / error / empty / main) — say which branch gets the trigger.

**[MAJOR] Scope — the fifth surface is delegated to MRQ-131 with no mechanism and no board record**
Dropping People → import is defensible: MRQ-131's own description says its import step is
"instructions-first per the prototype and **MRQ-130's brief pattern**, PLUS a working
file-drop," so the split was intended upstream. But the plan's only bridge is that the
component is "exported in a shape MRQ-131 can consume," and that bridge cannot carry
weight: both tickets are explicitly *do not merge before the competition freeze clears*,
and both run in separate worktrees off `github/main`. MRQ-131 cannot import an unmerged
file, so the likely outcomes are two implementations of the same panel or a conflict at
merge time. Separately, `relationships_out` is empty on both tasks, so a reviewer opening
MRQ-130 sees a ticket that names five surfaces and a PR that ships four, with nothing on
the board explaining why.
**Recommendation:** Keep the People-import brief **copy string** in
`src/ui/shell/agent-briefs.ts` in this ticket — it touches no People/CRM route, so the
zero-conflict promise holds, and it lands the one surface the ticket says to reproduce
one-to-one from the prototype. Declare MRQ-130 the source of truth for the component,
state that whichever PR lands second rebases onto the other, and record the split as a
board relationship or a comment on both tickets before implementation starts.

**[MAJOR] Brief content — the endpoints and undo handles are asserted but never verified**
Every brief names an endpoint and a response field, and the ticket makes accuracy a pass
condition ("a brief that omits auth sends the operator's agent into a 401" — a brief that
names a wrong path or a field the API does not return fails the same way). The plan has no
step that checks either against the running route registry. What I could verify is mixed:
`outbox_ids` is real (`CommsScreen.tsx:64`, matching `/api/v1/events/{eventId}/comms/send`);
`form_id` and the draft-until-published lifecycle are real (`forms/{formId}/publish`);
but the Agenda handle is described as "agenda item ids and **their version**," and
`agenda.routes.ts:332,366` implements concurrency as `versionOf: (item) => ({ id, updatedAt })`
— an ETag/`If-Match` contract, not a `version` field an agent can read off a response.
The Onboarding surface has **no send endpoint of its own**: `OnboardingPage.tsx:141,153`
posts to `/comms/preview` and `/comms/send`, and portal invites live at
`/api/v1/events/{eventId}/submissions/{submissionId}/invites` — so "the endpoint for the
onboarding brief" is a decision the plan has not made.
**Recommendation:** Name the exact path for each of the four briefs in the plan, and add a
test asserting every path a brief mentions exists in the assembled OpenAPI document (or at
minimum matches the route-template constants these pages already declare, e.g.
`AGENDA_ITEMS_ROUTE` at `AgendaPage.tsx:23`). Reword the Agenda handle as the
ETag/`If-Match` mechanism it actually is.

**[MINOR] Files — the modal should reuse the existing dialog primitive, not hand-roll one**
`src/ui/shell/OverlayHosts.tsx` exports `useDialogLifecycle` (Escape-to-close, Tab focus
trap, body scroll lock, focus restore) and `OverlayHost`; `QuickSearch.tsx:30` is the
precedent for a standalone dialog using it. The plan introduces `AgentBriefLauncher`
(button + modal) without naming either, which invites a fresh dialog that silently lacks
Escape or focus trapping on four screens.
**Recommendation:** State that `AgentBriefLauncher` builds on `useDialogLifecycle` (or
`OverlayHost`) and follows the `class="modal"` / `role="dialog"` / `aria-modal` shape
already in use.

**[MINOR] Test plan — the distinctness assertion as specified is close to vacuous**
"The four brief bodies are pairwise distinct beyond the shared paragraph" passes on string
inequality, which any four texts satisfy — it does not catch the failure the ticket names
("a generic brief with the nouns swapped is a fail"). The Communications and Onboarding
briefs are the pair most at risk of collapsing: both are chase jobs, both resolve to
`/comms/send`, and both report `outbox_ids`.
**Recommendation:** Assert per-surface required tokens (the surface's own nouns and its
endpoint) plus a bound on shared-line overlap between any two briefs. In the copy itself,
separate the two jobs sharply — Communications is audience filter → template → send at
scale; Onboarding is per-speaker task state → portal invite + the task-specific nudge.

**[MINOR] Files — no `tests/ac-claims/MRQ-130.json`, and the choice is not stated**
`pr-gate` runs `trace:ac --scope=merged --ticket=MRQ-130`, which emits a
`missing-current-ticket-manifest` warning when no claims file exists
(`scripts/checks/trace-ac.mjs:37-40`). It is a warning, not a gate failure, and recent
practice has drifted — 56 claims files exist, none for any MRQ-1xx ticket.
**Recommendation:** Either add `tests/ac-claims/MRQ-130.json` (`owns: []`,
`exercises: []`, one note — this is post-deadline scope with no EVALUATION criterion) or
state in the plan that the manifest is deliberately skipped, so review does not re-raise it.

**[MINOR] Placement — the Communications anchor is a status banner, not an action row**
`CommsScreen` has no `PageHeader`; `.comms-banner` is the "Demo-safe outbox" status strip.
Appending after `.comms-policy` (which keeps `margin-left:auto`) is genuinely additive, but
it puts an action inside a status element and diverges from the other three surfaces.
**Recommendation:** Keep it if it reads well, but call it out as a deliberate exception and
make it something the browser validation pass explicitly looks at.

**[MINOR] Files — `eventId` is already defined per page; don't re-declare it in the shell**
`AgendaPage.tsx:20` and `OnboardingPage.tsx:9` each carry
`DEFAULT_EVENT_ID = "evt_aie-ny-2026"`, and `AppShell.tsx:175` hardcodes the same value.
**Recommendation:** State that each surface passes its existing constant into
`agentBrief(surface, { origin, eventId })`; the new module introduces no fifth copy of the id.

## 4. Positive Observations

- **The stack claims are real, not assumed.** `tests/unit` genuinely is the Worker-free
  Vitest project (`vitest.node.config.ts`), `preact-render-to-string@^6.7.0` is already a
  dependency so "no new dependencies" holds, `pr-gate.mjs:7` really does require
  `--ticket MRQ-N`, `OPENAPI_JSON_PATH` really is `/api/openapi.json`, and API tokens
  really are minted at `/settings/api`. A plan whose checkable claims check out is rare.
- **The additive rule is engineered, not promised.** A modal instead of an always-open
  panel removes vertical pressure as a mechanism rather than an intention, and the
  source-contract test that asserts pre-existing controls by name is the right shape of
  guard — it makes a future "delete one to make room" edit fail the suite. Fix the
  inventory it is built from and this becomes the plan's strongest feature.
- **The design contract is traced to the binding prototype at line level** —
  `.agentbrief` at `prototypes/crm/index.html:321-325` and `modalImport()` from ~946 —
  including the details that are easy to lose: `1.65` mono line-height on the recessed
  surface, the full-width Copy button, the endpoint as a muted `.subtlecode` span inside
  the hint rather than a second code block.
- **"Elements never jump" is handled at the cause,** not patched after: full-width button
  so the label swap cannot resize it, confirmation by label swap plus `aria-live` rather
  than inserted or removed nodes.
- **The per-surface undo-handle table is exactly the right instinct** — it is the ticket's
  fourth requirement made concrete per surface instead of restated. It needs verification
  against the API (issue above), not rethinking.
- **The no-exclamation-mark test is correctly grounded** in `DESIGN.md:24`, and turning a
  voice rule into an assertion is a good habit for copy that ships.
