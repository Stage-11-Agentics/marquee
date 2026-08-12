# Plan Review: MRQ-99

## 1. Verdict

**FAIL (plan-level)**

The approach is right and every factual judgment call in it checks out against the
code. It fails on completeness, not on direction: the file list omits the two
components that consume the prop being removed, the verification story omits the
only command that typechecks, and two of the four gaps below would ship a wrong
thing *silently* — no compiler, no test, and no screenshot would catch them. The
revision is additive and should take minutes, not a replan.

## 2. Summary

Reviewed the delegator plan for MRQ-99 (conference-name dead end, decision-dialog
copy, `(optional)` convention) against the live tree at
`/Users/atin/Projects/Stage11/deployments/Marquee`. The plan's three judgment
calls are all verifiably correct — waitlist genuinely does not enqueue mail
(`src/jobs/cascade/decisions.ts:854`), the binding prototype already renders the
switcher as an anchor (`prototypes/pipeline/index.html:543`), and the ownership
boundary is respected. The key concern is scope completeness: `Sidebar` has **two**
consumers, `npm test` does not typecheck, and the same schema-voice/false-waitlist-
promise sentence lives one line above the dialog the plan rewrites.

## 3. Issues

**[CRITICAL] Approach step 1 — `Sidebar` has two consumers; the plan names neither**

`Sidebar` is rendered from `src/ui/shell/AppShell.tsx:133` *and*
`src/ui/health/DeliveryHealthShell.tsx:48`. Both pass `unavailable=`. Removing the
prop from the `Sidebar` signature is a strict-TSX excess-property error at both
call sites, and both files then hold an orphaned `unavailable` callback
(`AppShell.tsx:53`, `DeliveryHealthShell.tsx:32`) feeding an `OverlayHost`
(`AppShell.tsx:174`, `DeliveryHealthShell.tsx:76`) that nothing can ever populate
— the "Not installed" overlay becomes globally unreachable. The plan's "remove the
sidebar's dead-end callback wiring without changing the reusable overlay host"
does not say where that wiring ends, and `DeliveryHealthShell` is invisible in the
plan entirely.

`DeliveryHealthShell` matters on its own terms: its file header claims *"there is
no dead end on this screen,"* and today its sidebar carries the same dead-end
switcher.

**Recommendation:** Name the full file list explicitly — `Sidebar.tsx`,
`AppShell.tsx`, `DeliveryHealthShell.tsx` — and state the disposition of the now-
unreachable `unavailable` callbacks and their two `OverlayHost` mounts (delete the
callbacks; keep or drop `OverlayHost` — say which and why). `OverlayHosts.tsx`
itself should stay: `useDialogLifecycle` is imported by `QuickSearch.tsx:6`.

---

**[MAJOR] Approach step 4 — verification runs `npm test`, which does not typecheck**

`npm test` is `scripts/checks/run-test.mjs`: Vitest plus the `tests/node` files.
No `tsc`. The three typecheck projects live only in `scripts/checks/pr-gate.mjs:12-14`
(`tsconfig.json`, `tsconfig.client.json`, `tsconfig.test.json`) alongside the
production build. This ticket's one type-level change is exactly the prop-signature
edit in issue 1 — so the plan's verification skips the only step that can catch its
riskiest edit. The constraints cite a 120s *gate* budget, which implies the gate was
meant to run.

**Recommendation:** Add `npm run pr-gate` to step 4, after `npm test`, and report
both numbers in the PR.

---

**[MAJOR] Approach step 2 — the same false promise sits one line above the dialog**

`SubmissionRecordPage.tsx:157` — the Record action card itself, directly above the
Accept / Maybe / Reject buttons — reads:

> "Optional feedback is rendered into the same decision message and saved on the record."

Same schema voice ("rendered into", "the record"), and for the Maybe path the same
untruth the plan is fixing in the dialog: no decision message exists for a waitlist.
The plan scopes step 2 to the dialog `<p>` at line 158 and never mentions line 157.
Acceptance criterion 3 — *"the promise matches what the action actually does"* —
is not met while that sentence stands, and it appears in the same screenshot as the
fixed dialog, which makes the inconsistency the first thing the operator sees.

**Recommendation:** Bring `SubmissionRecordPage.tsx:157`'s `.subtle` span into scope
and make it action-neutral or accurate. It is the same file and the same component
the plan already owns — no boundary cost.

---

**[MAJOR] Approach step 5 — a literal `unavailable(` sweep returns exactly one site, the one being deleted**

`grep -rn "unavailable(" src/` yields a single call site: `Sidebar.tsx:11`. After
this ticket the inventory is empty. An empty list satisfies the acceptance
criterion's letter and gives the operator nothing, when what was asked for is *"if
any sit on the 11-step loop, say so loudly."*

The dead-end *class* is broader than the function name. Verified siblings:
- `AppShell.tsx:167-168` — the route fallback rendering *"This route's product
  module will replace the honest empty state below"* / *"{label} is ready for its
  module."* Same apology, different mechanism, and it is what `/settings/tasks`
  (`task-templates`, `route-table.ts:38`) resolves to today. Every sidebar-visible
  route has a real module, so this is off the 11-step loop — but that verdict
  belongs in the PR, stated, not left implied.
- The `scripts/checks/stub-command.mjs` npm scripts (`check:readme`, `check:mirror`,
  `smoke:mail`, `smoke:ics`, `check:skill-agent`) — the same "not implemented"
  pattern at the command layer.

**Recommendation:** Say in the plan that the literal `unavailable(` inventory is
expected to be empty after the change, and widen the sweep to "not landed yet"-class
affordances — the `AppShell` route fallback and the `OverlayHost` "Not installed"
header included — with a walkthrough-path verdict on each.

---

**[MINOR] Approach step 3 — the reviewer surface has three "optional" strings, and the plan converts one**

`ReviewerPage.tsx:403-405` carries: the visible `Optional scorecard · keys 1–5`
(403), `aria-label="Optional numeric score"` (404), the visible `Committee note`
label with placeholder `Optional context for the committee` (405), plus prose at
401 (*"independent of the optional scorecard"*). The plan's judgment call —
"labels themselves, not unrelated prose or placeholders" — leaves the aria-label
saying "Optional numeric score" while sighted users read "(optional)", i.e. the
mixed vocabulary survives for screen-reader users. And once the visible label says
`Committee note (optional)`, the placeholder "Optional context for the committee"
is saying it twice.

**Recommendation:** State the disposition of `aria-label="Optional numeric score"`
and the line-405 placeholder explicitly. An aria-label *is* a label; folding it into
the convention costs one string. Also pin the exact target text for 403 — the plan
writes `Scorecard (optional)` but the live string carries `· keys 1–5`.

---

**[MINOR] Ownership boundary — the bulk dialog is left speaking schema**

Taking only `SubmissionsPage.tsx:607` is correct per the ticket. But line 606 is
the bulk dialog's explanatory `<p>`: *"The same normalized feedback is saved on each
decision row and rendered through the standard conference email."* After this
ticket the record dialog speaks organizer and the bulk dialog one screen over
speaks schema — the exact defect being fixed, relocated. (Credit where due: line
606 already branches correctly on `notifies`, so unlike the record dialog it is at
least *true*.)

**Recommendation:** Do not widen the diff. Note it in the PR and in the Lattice
comment as a named follow-up so it is captured rather than rediscovered.

---

**[MINOR] Constraint check — "elements never jump" is lower-risk than it looks; verify anyway**

Assessed, and the plan's judgment call holds: `.sidebar` is `display: flex;
flex-direction: column` (`components.css:2`), so an `<a class="event-switcher">`
is a flex item and gets blockified — `width: calc(100% - 8px)` and the vertical
margins apply exactly as they do for the button. `tokens.css:62` sets
`a { color: inherit; text-decoration: none }`, so no link-blue or underline
appears, and both media-query hide rules (`:132`, `:140`) key off the class, not
the tag. The binding prototype already ships this as an anchor
(`prototypes/pipeline/index.html:543`), so the change moves *toward* prototype
parity.

**Recommendation:** No plan change needed. Capture the before/after sidebar
screenshot pair at the same viewport so the no-jump claim is evidenced rather than
argued, and spot-check the `/delivery-health` shell's sidebar too — it is a
separately mounted shell.

## 4. Positive Observations

- **The judgment calls are researched, not assumed.** "Waitlist does not enqueue
  mail" is exactly right — `decisions.ts:854` short-circuits `enqueueDecisionMail`
  for `waitlisted`, and `decisions.ts:836` even skips the email-validity guard for
  it. Dropping "and notify" from the record's waitlist button is correct *and*
  aligns it with `SubmissionsPage.tsx:78`, where the bulk waitlist confirm is
  already the bare `Waitlist` with `notifies: false`. The plan found the real
  contract instead of trusting the button label.
- **Action-specific dialog copy is a better fix than the ticket asked for.** The
  current `<p>` is one string shared by all three decisions, which is *why* it lies
  about waitlist. Branching it per action removes the defect's cause rather than
  rewording its symptom.
- **The test approach matches an existing house convention.** Source-contract
  assertions over the component file are precisely what
  `tests/node/reset-demo-ui.test.mjs:19` already does to the same `Sidebar.tsx`
  (`assert.doesNotMatch(sidebar, /unavailable\(["']Reset demo/)`). Asserting the
  *absence* of the removed call site follows established practice here.
- **The ownership boundary is read correctly and taken seriously** — one line from
  `SubmissionsPage.tsx`, a Lattice comment for the rebase, nothing touched in
  MRQ-97's or MRQ-98's territory.
- **Scope discipline is explicit.** Step 3 states what it is *not* changing
  (public-form metadata, form-config prose) and why. Naming the non-goals is what
  keeps a copy-consistency ticket from becoming a copy-audit ticket.
