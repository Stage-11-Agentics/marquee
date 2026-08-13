# Plan Review — MRQ-129 "Multi-event, end to end"

**Reviewer:** `agent:review-mrq-129-plan`, 2026-08-12.
**Reviewed against:** the worktree `Marquee-worktrees/mrq-129-multi-event @ 2da16c4` (= `mrq-105-cold-start` tip), `sequence/mrq-129-audit.md`, `sequence/multi-event-design.md`, `prototypes/multi-event/index.html`, and the ticket description. Every code citation below was read in this pass, not inherited from the plan or the audit.

---

## 1. Verdict

**FAIL (plan-level)** — return to `in_planning` for a short revision.

This is close. The plan is unusually well-grounded and closes 24 of the audit's 26 findings with correct, verified rulings. It fails on three points where the plan asserts two things that cannot both be true, and each of them sits on the most expensive surface in the ticket: the 18-file prop migration, the switcher that CFP-17 is scored from, and the URL contract. These are paragraph-sized amendments, not a re-plan.

---

## 2. Summary

I reviewed the MRQ-129 implementation plan against the ticket, the pre-implementation audit, and the live code on the branch it will be cut from. The plan's archaeology is accurate — I independently confirmed the 18 hardcoded `evt_aie-ny-2026` sites (19 grep hits, minus the `src/lib/ids.ts:6` doc comment), the `ShellEntry` seam in `src/ui/app.tsx`, `requireOrgAdmin`'s org-wide gate, `principalHasGrant`'s `eventId === undefined → false`, `committee_id`'s plain nullability, `PRAGMA table_info` precedent in both runtime and test code, and that `DELETE_PLANS` skips unplanned tables entirely (`plan ? [...] : []`) so a table-by-table walk is genuinely required.

The key concern is that §6 (the switcher) directly contradicts two shipped tests — one of them MRQ-105's own AC-280, on the very branch this stacks on — and the plan does not mention them; and that §5's "`eventId: string` required on 15 page components" and "children render immediately, `eventId` is `null` until resolved" cannot both hold without a stated rule for the loading window.

---

## 3. Issues

**[CRITICAL] §6 (UI · the switcher) — Two shipped tests explicitly forbid exactly what §6 builds, and the plan does not mention either**

`tests/unit/cold-start-screens.AC-280.test.ts:48–50` asserts, on this branch:

```ts
expect(sidebarSource).toContain('<div class="event-context"><small>Conference</small>');
expect(sidebarSource).not.toContain("event-switcher");
expect(sidebarSource).not.toMatch(/<a[^>]*class="event-context"/);
```

and `tests/node/mrq-99-organizer-copy.test.mjs:16–17` asserts the same pair. §6 turns that node into `<button class="event-context event-switcher" aria-expanded aria-haspopup="listbox">` — which fails both, immediately, on `npm run pr-gate`.

This is not a stale test to delete. AC-280's comment states the intent: *"It was once a link back to the page you were already on — a control that promised a switch nothing could perform, and **a judge recorded it as a defect**."* The guard exists to prevent a *fake* switcher. MRQ-129 ships a real one, so the guard's premise changes — but AC-280 belongs to MRQ-105, which is in flight, and silently deleting another ticket's acceptance assertion is the exact failure mode that assertion was written to prevent. A delegator who meets a red test mid-build at 2am will delete the three lines and move on.

**Recommendation:** Add an explicit sub-section to §6: name both files and both assertions, state that AC-280's guard is *re-ruled, not removed*, and specify the replacement assertions — the control must carry `aria-expanded`, `aria-haspopup="listbox"`, and a popover with more than one row (i.e. it proves a real switch exists, the inverse of the old proof). Flag in the PR body that AC-280's test is amended and why, and `lattice comment` it on MRQ-105 so its delegator is not surprised by a changed test on their own branch.

---

**[CRITICAL] §5 (Event context) — "`eventId: string` required" and "`eventId` is `null` until resolved" are mutually exclusive, and 18 files depend on which wins**

§5 states both: every page component takes `eventId: string` **required** ("the typechecker then proves no page can render unscoped"), and the provider "**never blocks rendering** — children render immediately; `eventId` is `null` until resolved."

There is no stated rule for what `AppShell` passes to `DashboardPage`/`ReviewerPage`/`SubmissionsPage` during the boot window. The three plausible resolutions have very different costs, and the delegator will pick one under time pressure across 18 files:

- pass `eventId!` / `?? ""` — defeats the entire typechecker argument the migration is justified by, in one keystroke, 18 times;
- widen the prop to `string | null` — same, more honestly;
- gate the routed subtree on `status !== "loading"` — preserves the invariant but *is* blocking, contradicting the sentence above it.

This also collides with the seat routes. §5 says "`/portal`, `/co-speaker`, `/handoff` must work for a seat with zero events" and "the seat routes are untouched" — but `ReviewerPage` is in the required-prop list *and* is one of `AppShell`'s early returns, so it is both a seat surface and a migrated component. What a reviewer with zero readable events renders is undefined.

**Recommendation:** State the boot contract as one rule. The version that keeps the typechecker argument intact and stays honest about §5's own wording: the *admin* routed subtree renders a skeleton (not a spinner-over-nothing — the shell chrome stays) until `status !== "loading"`, so `eventId` is `string` by construction wherever a migrated component mounts; the seat routes (`/portal`, `/co-speaker`, `/handoff`) render before resolution because they take their scope from the seat token, not from the provider. Then say explicitly which of the 15 migrated components are reachable from a seat route and what each receives at zero events. `ReviewerPage` is the one that needs an answer written down.

---

**[MAJOR] §5 / §6 — `?event=` means an id in the admin shell and a slug on the public routes**

§5's precedence chain accepts `?event=` and validates the candidate against ids returned by `GET /events`. §6 has the sidebar rewrite external links with the current event's **slug**, matching `public.routes.ts:18,45` where `publicQuery.event` is a slug. So the same query parameter carries two different key spaces on two surfaces of the same product, and the failure is silent: paste an admin `?event=<id>` URL onto `/agenda` and you get the default event; paste a public `?event=<slug>` into the shell and the candidate fails validation and falls through to whatever localStorage last held. A judge moving between the switcher and "Conference site" is exactly the person who does this.

**Recommendation:** Make the admin resolver accept **either** an id or a slug — resolve against both fields of the fetched list, since it already has name, slug and id in hand. One extra `||` in the validator removes the whole class. State it in §5's precedence rule. (The alternative — a distinct param name for the shell — is cleaner but costs a second URL vocabulary; the id-or-slug resolver is the cheaper correct answer.)

---

**[MAJOR] §9 (Teeth) — Two stated acceptance criteria have no corresponding test**

The ticket's AC names two properties the teeth list does not reach:

1. *"Reset leaves no created event behind, in D1 **and in R2**."* §9 lists "the org-sweep reset removing a created event" — D1 only. §4 correctly designs `deleteDemoOrgObjects`, so the code is planned; the assertion is not. The Miniflare test env has the R2 binding, so `media.list({ prefix: "uploads/<newId>/" })` returning empty after a reset is a two-line assertion.
2. *"…with no `event_settings` row, its allowlist is the empty set so every `demo_safe` message is suppressed."* MRQ-105 already tests `demo_mode` inheritance (`cold-start.AC-275-286.test.ts:311`, AC-279) — that half is covered. The **suppression** half is not tested anywhere, and audit M3 asked specifically for it *with the `always_live` carve-out stated in the test's comment so nobody "fixes" it later*. An AC asserting a safety property with no test is how the false version of this AC survived into the design in the first place.

**Recommendation:** Add both to §9's integration list. For the second, assert on a created event with no `event_settings` row that a `demo_safe` message is suppressed, and put the `consumer.ts:155` `always_live` short-circuit in the test comment verbatim.

---

**[MAJOR] Scope — the plan is a very large single pass, and one of its costs is unbudgeted**

Two new endpoints, a copy engine plus manifest across 11 tables, a 48-entry reset rewrite with an R2 sweep, an oracle fix, a provider plus an 18-file prop migration, a popover, a ⌘K extension, a create-screen rebuild, CLI + regenerated SKILL, ~10 integration assertions, unit and node tests, `pr-gate`, and live browser validation.

The unbudgeted cost is the **blast radius of making `eventId` required**. The plan enumerates the 18 declaration sites but never mentions their call sites or the existing tests that touch them. I checked: most Marquee UI tests are source-text node tests rather than render tests, so the damage is smaller than it looks — but `tests/unit/reviewer-surface.AC-61-158-159.test.ts`, `tests/unit/cold-start-screens.AC-280.test.ts`, `tests/node/wave-0-sweep.MRQ-106.test.mjs` and several `tests/node/*-ui-contract` files read these files' source and assert on their shape, and `venue-writer.ts`'s change is a module API break with call sites in `VenuesPage` and `VenueMap`. None of that appears in the plan's build order.

**Recommendation:** Add a step to the build order between the provider and the UI work: "sweep call sites and source-text tests broken by the required-prop migration," and name `venue-writer`'s two call sites. Separately, state the fallback if the pass runs long — my read is that §7 (CLI + SKILL) is the only section whose absence costs no acceptance criterion (CFP-17/18 are both UI-scored), so it is the natural thing to split into a follow-up ticket rather than the thing to rush. Say so now, while it is a decision, rather than at hour eleven.

---

**[MINOR] §2 — the copy-plan endpoint is new API surface the ticket did not ask for**

`GET /api/v1/events/{eventId}/copy-plan` is well-justified — the checklist genuinely cannot show honest counts or lock prerequisites without it, and discovering a 422 after the organizer presses Create is worse. But it is a third endpoint on an already-large PR, with OpenAPI, `check:api`, and doc costs.

**Recommendation:** Keep it, but declare it in the PR body as a deliberate addition beyond the ticket's scope list with the one-sentence reason, so the reviewer is not deciding whether it was scope creep. Confirm `check:api` regeneration is in the build order (§9 mentions the CLI registry parity test but not `check:api`; `pr-gate` covers it, but the plan should not rely on discovering that).

**[MINOR] §4 — the entry count is wrong, which is weak evidence the walk was exhaustive**

The plan says "three of the **46** entries." `WIPE_ORDER` has **49** tables and `DELETE_PLANS` has **48** entries (only `mirror_state` is unplanned, which the plan correctly calls out). The three non-conforming entries the plan names are right as far as I checked, but a table-by-table walk that reports the wrong table count is exactly the claim a reviewer cannot take on faith.

**Recommendation:** Re-derive the count and state it as 49/48, or drop the number. Worth confirming in the same pass that the two `magic_links`/`auth_sessions` plans (which filter through `people WHERE org_id = ?`, already org-scoped) and every nested-subquery plan survive the rewrite unchanged — the rewrite rule as stated ("`WHERE event_id = ?` → `WHERE event_id IN (…)`") is textually correct for the nested forms like `webhook_deliveries`, but say so.

**[MINOR] §9 — `check-shell-truth.mjs` emits a single `forbidden_literal` field**

`scripts/checks/check-shell-truth.mjs:10,34` builds one literal and reports it as one scalar in the JSON result. Adding `evt_aie-ny-2026` changes the output shape. Also note the allowlist is `scripts/seed/**` + `**/*fixture*`, and `tests/` is not scanned at all — so the four existing test hits (`tests/node/readme.AC-160-162.test.mjs:18`, `tests/node/seed-spine.test.mjs:41,55,67`) need no allowlist entry, but a future move of that scanner over `tests/` would.

**Recommendation:** One line in §9 on the output-shape change (`forbidden_literals: [...]`), and a note that `tests/` is out of scan scope today so no allowlist growth is needed.

**[MINOR] §6 — the collapsed sidebar hides the trigger**

`src/styles/components.css:143,151` set `.event-context-row { display: none }` in two narrow/collapsed breakpoints. The geometry ruling in §6 is thorough about the expanded case and silent about these. A popover anchored to a hidden trigger is a defect the geometry test will not catch.

**Recommendation:** One sentence: at collapsed widths the switcher is unavailable (as the row already is) and ⌘K's "Switch to …" rows are the path — or state the alternative if it should remain reachable.

**[MINOR] Copy sets — `events.logo_key`, `events.accent`, `events.tagline` are not addressed**

The manifest covers 11 child tables. The event row itself is built from the request body, so a conference created "from existing" silently loses the source's branding. That is arguably correct (branding is a decision, like dates) but it is unstated, and §3.2's own standard is that every column gets a ruling.

**Recommendation:** One line in §3.2 stating that event-level branding does not travel and why, so it reads as a decision rather than an omission.

**[MINOR] Process — the three contract documents are uncommitted in the primary checkout**

The plan says so plainly, which is good. But it means the PR reviewer, the master validator, and any future reader cannot see the contract this PR is judged against. `sequence/mrq-129-audit.md`, `sequence/multi-event-design.md`, and `prototypes/multi-event/index.html` are all untracked on `main`.

**Recommendation:** Ask the orchestrator to commit all three to `main` before the PR opens (the board is already committed on purpose; these are the same class of artifact). Also `lattice link` MRQ-129 ↔ MRQ-105 per audit n5 — the plan states the stacking relationship in prose but the board still carries no edge.

---

## 4. Positive Observations

This is among the best-evidenced plans I have reviewed on this board, and several things in it deserve to be copied by other delegators.

- **It re-read the code rather than inheriting the design's archaeology.** The header claim — "every file:line below was re-read on this branch" — holds. I spot-checked the 18-site enumeration (exact), `principalHasGrant`'s `eventId === undefined` return (exact), `requireOrgAdmin`'s org-wide `program_lead` gate (exact), `committee_id`'s nullability (exact, no CHECK), `DELETE_PLANS`' skip-when-unplanned behavior (exact), and the CLI's singular `event` root (exact). The one number I found wrong is the 46/49 table count.
- **§3.1's two-sided rule is genuinely good engineering.** Discovery (`Object.keys(row)`) so a new column is never silently *dropped*, plus a manifest × `PRAGMA table_info` drift test so a new column is never silently *leaked* — that is a strictly better answer than either half alone, and it converts the next migration into a forced ruling at the only moment anyone can make one. The `PRAGMA table_info` approach is already proven in this codebase (`src/routes/submissions.queries.ts:491`, `tests/integration/cold-start.AC-275-286.test.ts:242`), so there is no feasibility risk.
- **§3.4 refuses the tempting wrong answer.** The audit offered "derive `due_offset_days` from `starts_on`" as an option; the plan checked `src/lib/task-due.ts:57` and found the offset is counted from *assignment*, not from conference start, and ruled that a derived offset would be "a fabricated number wearing a real column's name." That is the reasoning quality this repo's CHECK constraints demand.
- **It states its own caveats instead of implying them away.** The read-phase-outside-the-batch race (§3.5), R2/D1 non-atomicity (§4), the pre-existing token/session deletion that will look like a regression to a judge (§4) — each named rather than discovered later by someone else.
- **The scope boundary with MRQ-105 is handled correctly.** §0 enumerates what it extends and does not rebuild, with line numbers, and §7 flags the `renderSkill()` byte-equality collision proactively.
- **§10 exists.** Explicitly naming what is *not* mine — `.eval-kit/` as an operator handoff — is the section most plans omit and the one that prevents the most rework.

The three critical/major items above are all of the form "the plan states two things that cannot both be true," not "the plan missed a subsystem." A revision pass that writes down the boot contract, the AC-280 re-ruling, and the `?event=` key space should take well under an hour, and the rest of the plan can stand as written.
