MERGED TO MAIN as #108 (main tip 97e0920f), operator-directed 2026-08-12. PR #104 landed MRQ-129 on mrq-105-cold-start first; #108 carried that plus MRQ-105's seven never-PR'd tail commits to main, reconciled against MRQ-131.

SHIPPED
- GET /api/v1/events (authenticated, answered per row — a collection route has no {eventId}, so a grants policy 403s everyone), GET /events/{id}/copy-plan, and the copy engine on POST /events: one db.batch, per-set receipt.
- Copy by DISCOVERED columns + a manifest<->PRAGMA table_info drift test, so a migration can neither silently drop a column nor silently leak one. Named null-outs: evaluation_rounds.committee_id, forms.opens_at/closes_at, evaluation_rounds.opens_at/closes_at; forced: forms closed, evaluation_plans draft; remapped: task_templates.form_id (missing from every version of the design's list). Templates with a fixed due_at are declined and counted — due_offset_days counts from assignment, not from the conference start, so a derived offset would be fabricated.
- Both conditional sets fire on the real seed, not hypothetically: CFP forms need formats+tracks (bound by name), form-kind templates need their forms. Illegal combinations are 422 naming the offender, never a 500 out of a rolled-back batch.
- Reset sweeps the demo ORG in D1 and R2 (mirror_outbox through its JSON payload; api_tokens/memberships event half widened; events by org_id).
- EventProvider in ShellEntry, not AppShell. Precedence with every candidate validated against the fetched list; ghosts cleared from both storages. 18 hardcoded sites swept to required eventId props; check-shell-truth guards the id beside the name.
- Switcher popover, Cmd-K rows, event-scoped external links, three-card create screen with the copy checklist; CLI event list / event create --from --copy; SKILL.md chapter.

THREE DEFECTS ONLY THE RUNNING ARTIFACT COULD SHOW
1. Module-scope AbortController in api-client.ts — workerd refuses constructor work in global scope, so the Worker did not start at all. Every test passed against it.
2. The popover was clipped by the sidebar's scroll container, losing exactly the chips and gauges CFP-17 is screenshotted for. Measured onto the viewport now.
3. The landing page carried a second copy of the age-ordered demo oracle, advertising a visitor's own empty conference as the demo. Both callers now share src/lib/demo-event.ts.

MERGE RECONCILIATION (MRQ-131 landed meanwhile): 38 conflicts across 15 files, every resolution keeping both tickets. Organization nav group stays above the conference boundary; People/Lists/sourcing answer BEFORE the conference guard because a person belongs to the org; both CLI families intact (45 commands); main's 0012 migration kept; SKILL.md and docs/ROUTES.md regenerated. One MRQ-131 assertion repointed — it located the conference boundary by an element that moved into EventSwitcher.tsx when it became a real control; the rule is unchanged.

VERIFIED ON THE MERGED TREE: pr-gate pass (37s/120s), suite 34s/45s, three typechecks clean, and the built artifact smoke-launched — boots, landing page names the seeded conference.

OPEN, NOT MINE: .eval-kit/evalconfig.json submissionNotes still tell the eval agent multi-event is not implemented and not to look for it. Gitignored third-party; CFP-17/18 stay not_found until an operator rewrites that paragraph and the ROUTES list.