# Code Review: MRQ-2 — Database schema, the whole init migration

Reviewed commit `824572c` ("MRQ-2: add complete D1 schema") in worktree
`Marquee-worktrees/mrq-2-schema`, three files, 2,394 insertions:
`migrations/0001_init.sql`, `src/db/schema.ts`, `scripts/schema-verify.mjs`.
The prompt's inline diff was truncated by Lattice at 5,000 lines before the two
primary files appeared, so the review was performed against the worktree tree
itself, plus `SPEC.md` §2.4/§3 and Amendments 10–12 as the authority.

**Verification actually executed (not read):**
- `tsc -p tsconfig.json` → exit 0.
- `node scripts/schema-verify.mjs` → `schema verification passed: 46 tables, 116 named indexes, 88 foreign keys, 2 triggers`. Second `migrations apply` proved the ledger does not replay. No stray artifacts; `git status` clean afterward.
- Independent adversarial probe of my own (`node:sqlite`, `PRAGMA foreign_keys=ON`, migration applied verbatim) to test cross-event authority, conditional defaults, and JSON/enum shape claims the committed verifier does not cover. Results are quoted in the findings below.

---

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the migration is 95% of the way there — 46 tables, complete
enums, correct partial-unique keys, working triggers, real FK enforcement proven
on local D1. Three defects need fixing, and the first one is the reason this
cannot merge as-is: **`0001_init.sql` is write-once by contract, and it ships a
`UNIQUE` constraint whose only purpose — enforcing AC-246's cross-event reviewer
authority — was never wired up.** After merge, that is a retrofit on a required
FK across dependent tickets, which is exactly the cost the ticket description
says this ticket exists to avoid.

## 2. Summary

The schema is careful, legible work: the full 46-table inventory matches SPEC §3
plus Amendment 11, every closed enum carries a `CHECK`, the round-aware
evaluation uniqueness and `(person, submission, role)` triple are right,
`outbox.send_policy` is byte-exact, Amendment 12's nullable `sha256` / `r2_etag`
lifecycle is enforced by a real constraint, and the type mirror's
default-column map is accurate table-by-table. The key finding is that the
migration's own cross-event enforcement technique — the composite
`(building_id, event_id) → buildings(id, event_id)` FK on `rooms` — was set up
for `tracks` too (`UNIQUE (id, event_id)` at line 56) and then never used, so
`reviewer_track_scopes` will accept a track belonging to a different event, and
the verifier probe that claims to prove otherwise passes vacuously against an
empty row set. Secondarily, SPEC's "`bypass_evaluation` default 1 when
`kind='session'`" survives only as a SQL comment: the column defaults to 0, the
insert type makes it optional, and nothing probes it.

## 3. Issues

**[MAJOR] migrations/0001_init.sql:56, 491–498 — `reviewer_track_scopes` does not enforce same-event tracks; `tracks UNIQUE (id, event_id)` is a dead constraint**

`tracks` carries `UNIQUE (id, event_id)` (line 56). Nothing in the file
references it: all four track FKs (`submissions.primary_track_id:341`,
`submission_tracks.track_id:377`, `reviewer_track_scopes.track_id:495`,
`agenda_items.track_id:566`) are single-column `REFERENCES tracks(id)`. So the
constraint is an unused index — and its obvious intended consumer is the one
place in the schema where cross-event leakage is an *authorization* bug rather
than a data-tidiness one. The plan's AC-214/AC-246 obligation is explicit:
"event-A reviewer membership and track scopes do not create event-B authority
**by construction**." They do not. Probe result, run against this migration with
FKs on:

```
ACCEPTED: reviewer scope: event2 + event1's track
   INSERT INTO reviewer_track_scopes VALUES ('rs1','e2','p1','t1',1,1);
   -- t1 belongs to e1
```

A row like that grants `p1` a scope on event 2 keyed to a track event 2 does not
own. MRQ-17/MRQ-18's authorization helper is then the sole line of defense for
an invariant the schema was built to hold, and per the ticket description this
migration is the only chance to add it cheaply. This is also the one finding
whose fix cost rises sharply after merge; everything else below is fixable in a
later file.

**Fix:** in `reviewer_track_scopes`, replace `track_id TEXT NOT NULL REFERENCES tracks(id)` with a plain column plus a table-level
`FOREIGN KEY (track_id, event_id) REFERENCES tracks(id, event_id)` — the exact
shape already used for `rooms → buildings`, and the reason line 56 exists. Both
columns are already present, so no downstream writer changes. Add the real
adversarial probe (see next finding). If you also want the venue/ICS read path
closed by construction, add `UNIQUE (id, event_id)` to `rooms` and make
`agenda_items.room_id` composite the same way; the other cross-event pairs
(`submissions.form_id`/`format_id`, `speaker_tasks.template_id`,
`evaluations → rounds`) are plan-sanctioned writer invariants and I am *not*
asking for those here.

**[MAJOR] scripts/schema-verify.mjs:372–379 — the cross-event authority probe is vacuous, so it certifies the bug above as fixed**

```js
assert.equal(
  query("SELECT count(*) AS count FROM reviewer_track_scopes " +
        "WHERE person_id='person1' AND event_id='event2'")[0].count,
  0,
  "Event-A reviewer scope leaked into Event B",
);
```

No fixture ever inserts a scope row for `event2`, so this asserts `0 = 0`. It
passes identically whether or not the schema can prevent the leak — which is how
finding 1 got through a green verifier run. This matters more than a normal
weak-test note because the plan designates this script as MRQ-2's AC evidence,
and the Plan-Review Cycle 1 resolution #4 specifically committed to honest
partial-discharge labeling.

**Fix:** make it adversarial, matching the style of the surrounding
`expectConstraint` calls:
```js
expectConstraint(
  "AC-246 cross-event track scope",
  "INSERT INTO reviewer_track_scopes VALUES ('cross-scope','event2','person1','track1',1,1)",
);
```
(`track1` is already an `event1` track and `event2` already exists in the
fixture.) Apply the same treatment to the `event2`-side of the AC-214 claim.

**[MAJOR] migrations/0001_init.sql:331 + src/db/schema.ts:818–824 — SPEC's "`bypass_evaluation` default 1 when `kind='session'`" is enforced nowhere, and the insert type invites omitting it**

SPEC §3.4 declares `bypass_evaluation` "**default 1 when `kind='session'`** ·
derived at insert," and the plan required that "insert logic, **types, and
probes** preserve 'session defaults to bypass evaluation = 1'." What shipped is
`DEFAULT 0` plus a comment ("Session insert paths set this to 1"), and
`CoreDefaultColumns.submissions` lists `bypass_evaluation`, which makes it
**optional** in `SubmissionInsert`. So the type system actively invites the wrong
value, and no probe catches it:

```
session bypass_evaluation default: 0
   INSERT INTO submissions (id,event_id,kind,title,origin,submitter_person_id,created_at,updated_at)
     VALUES ('s2','e1','session','Sess','admin','p1',1,1);
```

A session inserted by MRQ-9/MRQ-4 that omits the column is silently
non-schedulable-without-an-evaluation, which is AC-22/AC-119 — the "complete,
not missing data" rendering the moat-M1 demo depends on.

**Fix:** two cheap options, ideally both. (a) In the mirror, drop
`bypass_evaluation` from `CoreDefaultColumns.submissions` so every insert must
state it — a one-line change in an M-02-owned file that turns a silent default
into a compile error at every call site. (b) In 0001, add the derivation as a
trigger, precedent already set by `submissions_search_blob_insert`:
```sql
CREATE TRIGGER submissions_session_bypass_insert
AFTER INSERT ON submissions WHEN new.kind = 'session' AND new.bypass_evaluation = 0
BEGIN
  UPDATE submissions SET bypass_evaluation = 1 WHERE id = new.id;
END;
```
This is faithful to SPEC — "derived at insert; admin toggle" makes the toggle a
later `UPDATE`, which the trigger does not touch. Then probe it: insert a
session without the column, assert 1; insert an abstract, assert 0; `UPDATE` a
session to 0 and assert it stays 0.

**[MINOR] scripts/schema-verify.mjs:7 — `node:sqlite` is imported unconditionally while `package.json` declares `node >= 20.19.0`**

`DatabaseSync` arrived in Node 22.5; on the declared minimum the bare
`import { DatabaseSync } from "node:sqlite"` throws `ERR_UNKNOWN_BUILTIN_MODULE`
before any assertion runs. It works here (Node 26.5) and MRQ-2 correctly may not
edit MRQ-1's `engines` field — but this script is the ticket's whole evidence
surface, and MRQ-6's harness will invoke it on whatever Node CI pins. The direct
read of Wrangler's `*.sqlite` file layout is a second, milder coupling to
Miniflare internals (guarded by the `sqliteFiles.length === 1` assertion, which
is good).

**Fix:** either route the introspection through the existing `query()` helper
(`wrangler d1 execute` already returns JSON for `sqlite_master`,
`pragma_table_info`, `pragma_foreign_key_list`), or fail fast with an actionable
message: assert `process.versions.node` ≥ 22.5 up front and say "schema-verify
requires Node ≥ 22.5 for node:sqlite," and hand MRQ-6 that requirement as an
explicit handoff note.

**[MINOR] scripts/schema-verify.mjs:256, 229–243 — the FK-graph and column-parity guards are looser than the plan's "exact inventory"**

`assert.ok(foreignKeyRows.length > 60)` passes with 88 actual FKs — 27 could be
dropped by a bad later edit and the guard would still be green. Separately, the
`appliedColumns` query selects `not_null` and `dflt_value` but only ever asserts
them for `outbox.send_policy`; column *names* are compared to the mirror,
nullability and defaults are not. The mirror already encodes nullability
(`| null`) and defaults (`CoreDefaultColumns`), so parity is mechanically
checkable, and the plan asked for comparison "against the exact 46-table
inventory, required columns/defaults/nullability."

**Fix:** `assert.deepEqual` the sorted `(table, column, parent_table, parent_column)`
FK tuples against a literal expected list (or at minimum assert an exact count),
and extend the per-table loop to compare `not_null`/`dflt_value` against the
mirror's nullable-union and default-column metadata.

**[MINOR] scripts/schema-verify.mjs:170 — formatting-coupled regex will fail on a pure whitespace reflow**

`assert.match(migration, /sha256 TEXT,\n\s+r2_etag TEXT,/)` asserts Amendment
12's lifecycle by matching adjacent source lines. Reordering or reformatting
those two declarations without changing semantics fails the check; conversely it
proves nothing about nullability that `pragma_table_info` couldn't prove
properly. The `send_policy` assertion at line 159 has the same shape, though
that one is defensible — the plan literally asked for the declaration to be
quoted verbatim.

**Fix:** assert the Amendment 12 lifecycle from introspection instead —
`sha256.not_null === 0`, `r2_etag` present and nullable — and keep the source
match only where the contract demanded a verbatim quote.

**[MINOR] migrations/0001_init.sql:699 — `audit_log`'s missing `updated_at` is undocumented in SQL**

The migration-wide rule says any table without `updated_at` documents the
exception "beside the table in SQL and mirrored in TypeScript." The TypeScript
side is done well (`AuditLogRow extends ImmutableRecord`); the SQL side has no
comment, so a later reader sees only an apparently-inconsistent table.

**Fix:** one line above `CREATE TABLE audit_log` — append-only, no `updated_at`
by design.

**[MINOR] migrations/0001_init.sql — five plan-named indexes are absent, correctly, but the deviation is unrecorded**

`idx_events_org_id`, `idx_evaluation_rounds_plan_position`,
`idx_rubric_criteria_round_position`, `idx_participations_person_submission_role`,
`idx_magic_links_token_unused`. Each is subsumed by a UNIQUE index whose
leftmost prefix matches, so omitting them is the migration-wide "no redundant
indexes" rule being obeyed over the checklist — the right call. But the plan
tells the delegator to audit "every named index above," and the verifier's
`requiredIndexes` list doesn't mention them either, so nothing records that five
named indexes were deliberately dropped rather than forgotten.

**Fix:** name the five and their subsuming unique indexes in the PR body /
completion comment, per Cycle 1 resolution #4's honesty standard. No schema
change.

---

## 4. Positive Observations

- **The 46-table inventory is exactly right.** SPEC §3's 45 tables plus Amendment 11's `buildings`, no invented 47th table for either Amendment 7's `event_ids[]` or Amendment 12's draft files — both resolved inside existing columns as the plan's ratified resolutions required.
- **`rooms → buildings` is the strongest single piece of the migration.** The composite `FOREIGN KEY (building_id, event_id) REFERENCES buildings(id, event_id)` enforces Amendment 11's same-event ownership at the engine level rather than deferring it to writers, and the verifier proves *both* halves adversarially (missing building, cross-event building). Finding 1 is really just "do this once more."
- **Amendment 12 landed with teeth, not just columns:** `CHECK (status <> 'ready' OR r2_etag IS NOT NULL)` makes a `ready` row without a provider-observed ETag impossible. Independently confirmed rejected, including the tempting `sha256`-but-no-etag case.
- **Partial unique indexes are used precisely where they belong** — `uq_memberships_event`/`uq_memberships_org` split on `event_id IS NULL` with `role` in both keys (the SPEC §6 organizer-plus-reviewer case is probed and passes), `uq_submission_tracks_one_primary`, `uq_submissions_event_external_ref`, `uq_agenda_items_submission`, and the reviewer/committee assignment pair backing the XOR.
- **The triggers are verified behaviorally, not structurally.** `search_blob` normalization is asserted after insert *and* after a title update, and the insert trigger's inner `UPDATE` correctly cannot re-fire the `UPDATE OF title, abstract` trigger.
- **The type mirror's `CoreDefaultColumns` map is accurate table-by-table.** I checked all 22 non-`never` entries against the SQL defaults and found no drift, no missing default, no phantom. Combined with `CoreInsert`'s `Omit`/`Partial` composition and the `Equal<length, 46>` / `satisfies` assertions, the parity claim is real and it typechecks clean under `strict`.
- **The verifier is hermetic and well-mannered:** `mkdtempSync` + `--persist-to` outside the repo, `finally`-block cleanup with a `MARQUEE_KEEP_SCHEMA_STATE` escape hatch, second-apply proof that Wrangler's ledger doesn't replay 0001, and `EXPLAIN QUERY PLAN` assertions for the AC-246 intersection and AC-249 draft-queue access paths. Zero stray artifacts after my run.
- **File ownership was respected exactly.** Three files, none of them MRQ-6's `package.json`/`vitest.config.ts`/`scripts/checks/*`, none of them MRQ-1's `wrangler.jsonc`, no contract-doc edits, no minted AC IDs. Nothing secret in a repo bound for public open source.
