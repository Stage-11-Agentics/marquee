# Plan Review: MRQ-2 — Database schema, the whole init migration (Cycle 2)

## 1. Verdict

**FAIL (plan-level)**

Cycle 1's four blocking findings are genuinely resolved — not deflected — and the Resolutions block is authoritative, specific, and folded back into the plan body rather than bolted on. What remains is one omission of the same class that made cycle 1 fail: a decision every one of the 46 tables needs, that the plan never states, that a context-clean implementer will resolve the wrong way, and that lands in a file nobody may edit again. Like cycle 1, this is fixable in a `## Plan-Review Cycle 2 Resolutions (AUTHORITATIVE)` block — no re-plan, no re-enumeration.

## 2. Summary

Reviewed the revised plan against `SPEC.md` §3 + §6 + Amendments 7/10/11, `EVALUATION.md` §2.3 rows for AC-234/235/242/246–249/252/253 and the `trace:ac` contract (line 52), `BUILDPLAN.md` §7 shared-file table, `.lattice/orchestration/ticket-map.md`, the MRQ-1/MRQ-2/MRQ-14 boot prompts, `COMMON.md`, and the v1.4 binding prototype for the agenda/break surface. I re-derived the table count independently and again get **46**; the plan's checklist hits all 46 with no omission or invention, and I field-checked every table against SPEC — column coverage is complete, including the easily-dropped ones (`applied_rule_id`, `last_write_source` on exactly the three mirrored tables, all 15 `forms` columns, the full `outbox` list). The blocking gap is that the migration-wide rules pin types, enums, JSON validity, FK behavior, timestamps and ~150 index names, but never state **when a column is `NOT NULL` and when it carries a SQL `DEFAULT`** — and the plan's own per-table style (marking only *some* columns "nullable") pushes an implementer toward `NOT NULL` on everything unmarked, which breaks the draft-autosave path on the first migration.

## 3. Issues

**[CRITICAL] "Migration-wide rules" — no nullability/default policy, and the implied default breaks draft autosave**

The plan marks specific columns nullable inside each table's field list (`nullable form_id`, `nullable decided_at`, `nullable notes`…) and says nothing about the rest, which reads — correctly, by the plan's own explicitness convention — as "everything else is `NOT NULL`." Applied literally to a write-once file that is the fixture for every downstream ticket, that lands at least these failures:

- **`submissions.title` / `abstract` `NOT NULL`** kills the draft path. `SPEC.md` §3.4 stores drafts as `submissions` rows (`status='draft'`, `last_saved_at`, `resume_token_hash`), and AC-40–AC-42 autosave a draft *before* the submitter has typed an abstract. MRQ-15 discovers this at insert time against a migration it may not edit.
- **`submissions.search_blob` `NOT NULL`** with no `DEFAULT` makes *every* insert fail, because the plan's own new `AFTER INSERT` trigger writes the value only after the row exists.
- **`evaluations.comment` `NOT NULL`** contradicts `abstained` (a reviewer who abstains submits no comment) and AC-245's score-free recommendation path.
- **`people.bio` / `title` / `company` / `social_links` `NOT NULL`** breaks portal profile edit (AC-50) clearing a field and `PATCH /people/:personId` (Amendment 7).
- **`rooms.capacity` and `buildings.address` required** collides with §6's seeded **Online** building ("virtual sessions") and its virtual rooms, which have no capacity.
- Booleans: the plan says `INTEGER NOT NULL CHECK(... IN (0,1))` but never requires a `DEFAULT`, while the type mirror rule says insert types "mark SQL-defaulted columns optional." Without defaults, every insert site must supply `is_published`, `is_demo`, `turnstile_required`, `abstained`, `enabled`, `auto_assign`, `bypass_evaluation` explicitly — and the insert types will claim otherwise.

**Recommendation:** Add a migration-wide rule and a short pinned list. Suggested rule: *"A column is `NOT NULL` only if its SPEC-named writer supplies a value at the first insert, or the column carries a SQL `DEFAULT`. SPEC's explicit `NULL` markers are a floor, not the complete set: any column an early-lifecycle row (a draft submission, an unconfirmed participation, a pending attachment, a freshly-created person) does not yet have is nullable. Every boolean is `NOT NULL DEFAULT <0|1>` per SPEC's stated default."* Then pin the non-obvious ones explicitly: `submissions.title/abstract` nullable (or `NOT NULL DEFAULT ''` if the implementer prefers, ruled once), `search_blob TEXT NOT NULL DEFAULT ''`, `evaluations.comment` nullable, `people.title/company/bio/social_links` nullable, `rooms.capacity` and `buildings.address` nullable, `events.tagline/venue/logo_key/accent` nullable, `forms.max_sponsors/reminder_offset_hours/thankyou_template_key/password_hash/welcome_md` nullable, `bypass_evaluation INTEGER NOT NULL DEFAULT 0` with the `kind='session' ⇒ 1` derivation stated as writer logic (a CHECK must **not** force it — AC-119 toggles it off). Add one adversarial probe: insert a bare draft (`event_id`, `kind`, `status='draft'`, `submitter_person_id`, `last_saved_at`) and assert it succeeds.

---

**[MAJOR] §3.4 checklist + Resolution 5 — the `search_blob` trigger is mandated but its contract is unspecified**

Cycle 1's finding was answered correctly in principle (0001 owns the writer), but the implementer is handed a trigger with no composition, no collation rule, and no extension mechanism. Three concrete gaps: (1) *what* the trigger writes — `lower(title) || ' ' || lower(abstract)` versus something including speaker/company, which AC-102–104's quick search will want; (2) the `AFTER INSERT` ordering trap above; (3) `idx_submissions_event_search_blob` is a B-tree over a free-text column, which does nothing for the `LIKE '%q%'` the search will actually run — it is pure write cost on a table that takes ~1,000 seed rows plus every autosave.

**Recommendation:** State the initial composition in one line and mark it explicitly extensible: MRQ-29 extends the projection by `DROP TRIGGER` + `CREATE TRIGGER` (and, if it wants FTS5, a virtual table) **in its own numbered migration** — SQLite has no `ALTER TRIGGER`, and saying so now prevents MRQ-29 concluding it must edit 0001. Either justify the `search_blob` index as serving prefix matching or drop it and record the ruling; ~1,000 rows scan inside G7's 200 ms budget without it.

---

**[MAJOR] Resolution 4 — the `[schema-foundation AC-nnn]` label is unratified and may block MRQ-2's own merge**

`EVALUATION.md` line 52: `trace:ac --scope=merged` (the PR default) "considers only the ACs claimed by already-merged tickets **plus the ACs the current PR names**," and `COMMON.md` requires the PR body to cite the ticket's AC IDs. MRQ-2's ticket names AC-234/235/246–249. Under the plan's chosen label, the probes live in `scripts/schema-verify.mjs` — not vitest test names — so `trace:ac` sees six `auto` ACs named by the PR with zero tests and blocks merge on the serialized CP-1 ticket. The inverse risk (substring matching → false green on Tier A no-waiver AC-234/246) is the one cycle 1 raised; the plan cannot avoid both by fiat, and the orchestrator has already set the precedent for resolving exactly this — MRQ-14's boot prompt pins AC-146–148 to MRQ-24 "for `trace:ac` purposes" and tells MRQ-14 to say so in its plan.

**Recommendation:** Do what MRQ-14 was told to do. State in the plan that MRQ-2 is **not** the `trace:ac` owner of any of these ACs, naming the ticket-map owners — AC-234 → MRQ-5/13/15/35, AC-235 → MRQ-38, AC-246 → MRQ-5/17/51, AC-247–249 → MRQ-34, AC-252/253 → MRQ-10/20/22/25 — and that the PR body lists them as *schema foundation, not coverage*. Then c11-send the Orchestrator for ratification of the label form before implementation, since `trace:ac` is MRQ-6/MRQ-42-owned and unwritten: an unratified convention against an unbuilt tool is a coin flip on a ticket that cannot afford one.

---

**[MINOR] Partial unique indexes need a downstream handoff — `ON CONFLICT` targets must repeat the `WHERE`**

The plan now (correctly) pins several partial unique indexes: `uq_memberships_event/org`, `uq_submission_tracks_one_primary`, `uq_submissions_event_external_ref`, `idx_magic_links_token_unused`. SQLite's upsert requires the conflict target to restate the partial index's `WHERE` clause — `ON CONFLICT(event_id, external_ref) DO UPDATE` fails with "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint" unless written `ON CONFLICT(event_id, external_ref) WHERE external_ref IS NOT NULL`. MRQ-31's idempotent re-import (AC-112) and MRQ-4's seed both walk straight into this.

**Recommendation:** One handoff bullet naming the exact conflict-target forms for the partial indexes, alongside the existing `PRAGMA defer_foreign_keys` note to MRQ-4.

---

**[MINOR] Resolution 2 — the `scopes.event_ids` ⇄ `event_id` agreement rule has no named owner**

The ruling is sound (no 47th table, `{permissions, event_ids}` inside the existing `json_valid` column), but "when set, must agree with the sole JSON event ID" is unenforceable in SQL and the plan's downstream-consumer list does not name the ticket that must enforce it. AC-242 (`POST /org/tokens` with `event_ids[]`, "effective authority is grant∩membership") belongs to **MRQ-30**; AC-107 token CRUD/revocation belongs to **MRQ-3**.

**Recommendation:** Add MRQ-30 and the AC-242 shape to the handoff list with the JSON contract written out verbatim, so the mint route and the bearer middleware read the same shape. Keep the orchestrator flag as written.

---

**[MINOR] Verification depends on MRQ-1-owned Wrangler config with no escalation path**

Every verification bullet runs through `wrangler d1 migrations apply --local`, which needs the D1 binding and (if non-default) `migrations_dir` from `wrangler.jsonc` — a file MRQ-1 owns and MRQ-2 is explicitly forbidden to edit. The plan's blanket rule ("missing downstream capability is a handoff note, never a workaround") gives an implementer no move if the landed config is wrong, on a serialized ticket.

**Recommendation:** One line: if the landed `wrangler.jsonc` cannot apply migrations, that is an Orchestrator-serialized edit request (`BUILDPLAN.md` §7 already says additions to that file queue through the orchestrator), not a local edit and not a reason to skip verification.

---

**[MINOR] The third file is an ownership addition the Orchestrator has not seen**

`scripts/schema-verify.mjs` is correctly placed — it collides with nothing in `BUILDPLAN.md` §7 (which names `package.json`, `.github/workflows/ci.yml`, and `scripts/seed/index.ts`, not `scripts/` wholesale) and is keyword-safe. But the ticket's declared file surface is two files, and the delegator's own contract calls a scope change a deviate-with-flag.

**Recommendation:** Add it to the plan's flag list for the same c11 send that carries Resolution 2 and the `trace:ac` question — one message, three items, no extra roundtrip.

## 4. Positive Observations

- **Cycle 1's findings were resolved, not absorbed.** The membership key is now two pinned partial unique indexes with `role` in both and a SPEC §6 rationale that survives a later "tightening"; the `event_ids[]` tension is ruled *and* flagged rather than quietly forked; `[schema-foundation AC-nnn]` is a real attempt at the false-green problem. The Resolutions block reads as authoritative instruction to a context-clean agent, which is exactly its job.
- **Table and field coverage is exact under independent re-derivation.** 46 tables, no omission, no invention — and I checked columns, not just names: `applied_rule_id` reaching back to §3.10, `last_write_source` on exactly the three tables §3.9's allowlist mirrors, all eight `form_fields` types, the complete `outbox` column list including `send_policy`'s verbatim declaration.
- **The write-once constraint is the plan's actual organizing principle.** Priority order under time pressure (correctness → access paths → probe breadth), "no later ticket may rewrite 0001," "later tickets append `schema.<module>.ts`," `CORE_TABLES` scoped so module mirrors compose rather than edit — the plan consistently optimizes for the file it can never touch again rather than for the four hours in front of it.
- **The boundary between schema and behavior is drawn honestly.** Every AC bullet names what MRQ-2 discharges and who owns the remainder; sum-to-100 rubric weights, "exactly one primary track," and comparison set-equality are correctly left transactional rather than faked into row CHECKs; `suppress_mirror` is ruled runtime-only with both consumers named.
- **The venue fold is handled as the one-shot it is.** `buildings` plus a required `rooms.building_id` in the same migration, with same-event ownership pushed to verification rather than left to an unscoped lookup, is the right read of Amendment 11's "this is the one chance." I checked the binding prototype's break modal — breaks reserve a room lane — so the plan's required `agenda_items.room_id` is right, and it was right for a reason the plan clearly reasoned through.
