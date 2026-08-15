# Plan Review: MRQ-211 — Activity: one append-only log, three lenses

> **Note on inputs:** the plan embedded in the review prompt was a stale snapshot (a verbatim copy of the task description). This review is of the actual plan on disk, `.lattice/plans/task_01M00YN2N3JXBDA5VQWXT6PCPY.md`, which is a full plan. Every factual claim in it was verified against the working tree (`main`).

### 1. Verdict

**FAIL (plan-level)** — one major internal contradiction in the core schema change must be resolved before implementation. It is a surgical fix (one migration step and one query predicate); everything else in the plan stands and is verified-accurate. Revise and proceed.

### 2. Summary

The plan is grounded, tightly scoped, and almost entirely verified against reality: the `NOT NULL` constraint on `audit_log.event_id` is real (`migrations/0001_init.sql:702`), the rebuild-pattern precedent (0007/0008/0009/0011) is real, the writer inventory matches what exists on `main` exactly, and the seam design correctly anticipates MRQ-207/MRQ-212 (both still `backlog`). The one significant flaw: the combination of "backfill `org_id` onto all existing rows" and "the org lens is `org_id = ?`, not a hardcoded action list" produces a lens that contradicts both the binding prototype and itself over time.

### 3. Issues

**[MAJOR] "The one schema change" + "The named seam" — the backfill turns the org admin lens into a firehose, then makes it incoherent over time**

The plan backfills `org_id` from each row's event onto *all* existing audit rows "so history predating the column is not stranded outside the org lens," and defines the org lens as `WHERE org_id = ?` with explicitly no action filter. But the existing audit history is submission mutations, agenda moves, form edits — the heavily-instrumented event-scoped writers. There is no org-admin history to rescue; the entire premise of the "Writers instrumented" section is that the admin writers *don't record yet*. The binding design says the opposite of a firehose: prototype v1.15's `#org/activity` header reads "This is the admin lens — seats, invites, tokens, defaults," and its seeded log contains only invites, tokens, defaults, seats, ownership, and the instance claim.

Worse, the design is temporally incoherent: only *seam* writes set `org_id` going forward, so the lens would show every pre-migration submission edit but no post-migration ones — a log whose inclusion rule depends on when the row was written.

The backfill is also unnecessary for the `CHECK (event_id IS NOT NULL OR org_id IS NOT NULL)` constraint — every existing row already has `event_id`.

**Recommendation:** Drop the backfill entirely. Let `org_id` be set only by seam writes (plus `event_id` when the action is also conference-scoped, as the plan already says). The lens stays `org_id = ?`, keeps the "MRQ-207 adds an action tomorrow and it appears" property, and matches the prototype exactly — because only admin actions ever carry `org_id`. This also shrinks the migration: the table rebuild no longer needs an UPDATE pass over the largest append-only table in the schema.

**[MINOR] "The one schema change" — the `COLUMNS` change ripples beyond `src/lib/audit.ts`, and the plan doesn't name the blast radius**

Adding `org_id` to the shared `COLUMNS` list changes the column count from 11 to 12. `auditStatementFromSelect` callers embed raw SELECTs that must return "the eleven audit columns in the same order" (audit.ts's own contract) — `src/routes/submission-record.routes.ts:1431` and `src/routes/agenda.routes.ts:291` will hard-error at runtime if not updated in lockstep. Separately, whether `AuditEntry.orgId` is required or optional decides whether ~11 caller files across `src/routes/` and `src/jobs/` need touching.

**Recommendation:** Name both `auditStatementFromSelect` call sites in the plan, and state the type decision: `orgId?: string | null` (optional, defaulting null) keeps the existing event-scoped callers untouched and confines the diff to the seam.

**[MINOR] "The three lenses" §3 — the task enumerates seven submission-timeline moments; the plan maps none of them**

The task lists submitted, routed, reviewed, decided, reversed, re-accepted, mail sent. The plan says "missing moments are instrumented rather than synthesised where the writer exists on `main`" without auditing which of the seven are currently recorded by `recordHistoryFor`/audit writers and which are the gaps (e.g. "routed" and "mail sent" plausibly live in comms/cascade code paths, not ContentHistory). An unenumerated gap here fails silently — the timeline just won't show the moment, and no test will miss what was never listed.

**Recommendation:** Add a seven-row moment→writer table mirroring the "Writers instrumented" table: for each task-named moment, the writer on `main` that records it, or the explicit note that it lands with a parallel ticket.

**[MINOR] "Tests" — R7 budgets are asserted by the task but only the suite budget appears in the plan**

The task requires R7 budgets per lens; the plan addresses query shape (indexes, ULID paging) and the 45 s suite budget, but no verification step that the lens endpoints themselves are fast (the repo has `check:speed`, one of only two wall-clock-red checks).

**Recommendation:** One sentence: either the lens list endpoints join the existing `check:speed` coverage, or state why the indexed-query argument suffices without a new perf assertion.

### 4. Positive Observations

- **The plan argues from verified reality, not memory.** Every load-bearing claim checked out: the `NOT NULL` FK that forces the migration, `resolveOrganization`/`exchangeInstanceLink` in `src/lib/auth/instance-claim.ts`, the invite/removal/token writers exactly where the table says, `idx_audit_entity_created` supporting the person-subject convention, and the rebuild precedent in 0007/0008/0009/0011. A reviewer could implement from this document without re-deriving the codebase.
- **The seam is genuinely well designed.** The statement-variant (`orgActivityStatement`) preserves the project's "audit in the same transaction or not at all" discipline; `ORG_ACTIVITY_ACTIONS` as constants prevents spelling drift; `describeOrgActivity`'s humanised fallback is exactly what lets MRQ-207/212 add actions before this file learns them. The member-removal instrumentation "inside the existing batch, carrying removed roles + revoked sessions" answers the task's "with what was revoked" precisely.
- **Parallel-ticket discipline is right.** Instrument what exists on `main`, leave the seam named in the PR and in comments on 207/212 (both confirmed still `backlog`), ship the org lens as a standalone route with no sidebar row for 207 to mount later — exactly the contingency the task ordered.
- **No parallel storage anywhere.** Every lens is a query; the submission lens extends `src/lib/history.ts` rather than minting a second timeline table; the person feed keeps its assembled shape (`people.routes.ts:336`). This is the ruling ("one substrate projected three ways, never three logs") taken seriously, not just quoted.
- **The `CHECK (event_id IS NOT NULL OR org_id IS NOT NULL)` constraint** is a nice touch: it makes the unreachable row impossible rather than merely unlikely, and the plan's test list includes the guard.
