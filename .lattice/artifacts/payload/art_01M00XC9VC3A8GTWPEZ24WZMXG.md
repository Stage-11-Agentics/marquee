# Plan Review: MRQ-202 — Attendee schedule prototype v0.3

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed (and, per the working tree, largely already has — see Issue 1).

### 2. Summary

The plan is a verbatim restatement of the task description, with only a title line added. Normally that would be a red flag, but this ticket is unusual: the task description *is* an implementation plan — it names both files, gives exact copy strings, per-fix acceptance criteria, §7 amendment text, an explicit out-of-scope list, and a step-by-step validation drive. For a self-contained prototype + design-doc ticket, restating that contract is adequate; there is no architectural decision left for a plan to make. The one thing the plan fails to note is the state of the world: the work appears to have already landed on `main` as commit `405ccdf0` ("attendee schedule v0.3 — MRQ-202 rulings"), with the §7 "Round-2 review rulings" subheading present in `sequence/attendee-schedule-design.md` (line 178) and the prototype badge reading v0.3.

### 3. Issues

**[MAJOR] Whole plan — Does not acknowledge that the work may already exist at HEAD**
Commit `405ccdf0` on `main` already delivers "attendee schedule v0.3 — MRQ-202 rulings", the design doc already carries the "Round-2 review rulings (Atin, 2026-08-14 · MRQ-202)" subheading, and the prototype badge and header comment already read v0.3. A worktree cut from `github/main` will inherit all of this. An implementer following this plan literally, without checking current state, risks double-application: re-appending the §7 amendments (duplicate subheading), bumping v0.3 → v0.4, or "re-fixing" copy that is already in its ruled form.
**Recommendation:** The implementation pass must open with a state check: diff the current `index.html` and design doc against each of the seven fixes and the three §7 amendment bullets, treat anything already present as done, and apply only what is genuinely missing. If everything is present, the pass collapses to the validation drive (which is still worth running — the commit landing does not prove the behaviors in the VALIDATION section actually hold).

**[MINOR] Whole plan — Verbatim copy adds no implementation mapping**
The plan does not locate any fix in the file: which render function draws the star rail and meta chips, where the demand-board bars are computed, where the STARS seed data and org stats live, or the ordering between fix #5 (adds a "via agents" figure) and fix #6 (whose arithmetic must fold that figure in). For a ~single-file prototype this is survivable — the file is self-contained and greppable — but it means the plan carries zero evidence the planner read the current code, which is exactly what a plan stage is for.
**Recommendation:** Accept as-is for this ticket given its prescriptive contract, but note for the workflow: a plan that adds even a short "where each fix lands + apply order (#5 before #6)" section would have caught Issue 1 automatically, because writing it requires opening the file.

**[MINOR] Fix #6 — The arithmetic is multi-constrained and the plan doesn't spell out the solve**
Fix #6 must simultaneously: make the org stars stat equal the demand-board sum, preserve two sub-threshold sessions and one over-capacity room, keep the mini-table identity (3 shown + 2,057 more = 1,847 imported + 213 claimed), and fold in the new "via agents" figure from #5. These constraints interact — rebalancing STARS to hit the stat can accidentally lift a seeded sub-threshold session over the threshold or flatten the over-capacity room.
**Recommendation:** Verify all four constraints together after the numbers are touched (a quick sum in the console or a scratch check), not one at a time; the validation drive as written only visually checks the over-capacity bar, not the reconciliation.

**[MINOR] VALIDATION — Server availability and toggle-state restore are assumed, not stated**
The drive targets `http://127.0.0.1:8123/attendee-schedule/index.html` but the plan doesn't say how that server gets started (the "or equivalent" escape hatch covers it, barely). Also, the drive flips the public-counts org toggle "both ways" and then clears the three localStorage keys — the clearing correctly restores the cold-start default (counts ON via the seed), but only if the clear happens *after* all toggling; done mid-drive, the operator's next cold start could inherit a counts-OFF state.
**Recommendation:** Serve the `prototypes/` directory with any static server on 8123 (e.g. `python3 -m http.server 8123` from `prototypes/`), and make the localStorage clear the strictly-final step of the drive, as the task's ordering already implies.

### 4. Positive Observations

- **The contract is genuinely self-contained.** Exact copy strings ("Unlinked — your email and picks are removed…", "Organizer view (demo) ↗", the For-agents disclosure line), verbatim §7 amendment text, and per-fix acceptance make the implementation nearly mechanical — the right shape for a rulings-batch ticket where the decisions were already made in operator dialogue.
- **The out-of-scope list is explicit and cites its authority** (operator rulings, same session). That prevents exactly the scope creep a "polish batch" ticket invites — an implementer tempted to "fix" the threshold zeros or the mock dates has a named ruling telling them not to.
- **The validation section is a real drive, not a checkbox** — it exercises the five user-visible behaviors the fixes claim (count placement, unlink confirmation, over-capacity bar, toggle round-trip, Resend/Sent stability) and ends by resetting state for the operator's own cold-start drive. That last step shows respect for the next person at the keyboard.
- **"Elements never jump" is carried through every UI fix** (reserved count space, reserved claim-row height, fixed-width quiet buttons), consistently applying the project-wide UI ruling rather than re-litigating it per element.
