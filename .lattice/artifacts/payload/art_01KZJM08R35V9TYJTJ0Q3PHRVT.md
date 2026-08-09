# Plan Review: MRQ-2 — Database schema, the whole init migration

## 1. Verdict

**FAIL (plan-level)**

The gap is not depth — the plan is one of the most complete schema plans I have reviewed — but *resolvability by a context-clean implementer*. `sub-agent-full` means the implementer receives this plan and nothing else, and writes a file (`migrations/0001_init.sql`) that by contract can never be edited again. Four items below are underspecified in ways where the obvious implementer choice is wrong and the retrofit is a new migration plus a downstream unblock. All four are fixable inside a `## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)` block — this is not a call for a rewrite.

## 2. Summary

Reviewed the plan against `SPEC.md` §3 + Amendments 10–11, `EVALUATION.md` §2.3/§7 and gate 3, `BUILDPLAN.md` M-02 and its shared-file table, `.lattice/orchestration/ticket-map.md`, and `boot/COMMON.md`. Table coverage is exact: I independently enumerated SPEC §3 plus Amendment 11 and got **46 tables**, and the plan's checklist enumerates all 46 with no omission and no invention; the downstream consumer map (MRQ-3/4/8/10/12/13/15/17/18/20/22/25/26/33/34/35/38 + audits) matches the ticket map row-for-row. The key concerns are (a) two uniqueness decisions left to implementer discretion where the natural choice contradicts `SPEC.md` §6 seed, (b) `api_tokens` carrying a singular `event_id` against Amendment 7's `event_ids[]`, (c) an undeclared test-file surface with a hard dependency on an unmerged harness, and (d) an AC-claim/`trace:ac` interaction that can paint six e2e-verified ACs green off schema-only tests.

## 3. Issues

**[CRITICAL] §3.2 checklist, `memberships` — uniqueness columns unspecified, and the obvious choice breaks the seed**

The plan says only "unique event-scoped and org-scoped membership indexes that handle SQLite NULL semantics." The NULL awareness is correct and welcome, but the *column set* is never stated. An implementer reading "one membership per person per event" will write `UNIQUE(org_id, event_id, person_id)`. That directly contradicts `SPEC.md` §6: *"The demo organizer is also a reviewer… the organizer demo persona is seeded a `reviewer` membership on the demo event"* — the demo organizer holds `owner`/`program_lead` **and** `reviewer` on the same event, which is two rows differing only by `role`. A role-less unique key makes the seed unrepresentable, which lands as a constraint failure in MRQ-4 against a migration MRQ-4 is forbidden to edit, on the Wave-0 critical chain.

**Recommendation:** Pin the exact indexes in the plan:
- `CREATE UNIQUE INDEX uq_memberships_event ON memberships(org_id, event_id, person_id, role) WHERE event_id IS NOT NULL;`
- `CREATE UNIQUE INDEX uq_memberships_org ON memberships(org_id, person_id, role) WHERE event_id IS NULL;`

and add a one-line rationale citing SPEC §6 so a later reviewer does not "tighten" it. Add an adversarial probe asserting one person can hold `owner` and `reviewer` on the same event.

---

**[CRITICAL] §3.2 checklist, `api_tokens` — singular `event_id` cannot express Amendment 7's `event_ids[]` (AC-242)**

The plan transcribes SPEC §3.2 faithfully — `org_id`, nullable `event_id`, `scopes` JSON — but Amendment 7 changed the write surface: *"`POST /org/tokens` accepts `{name, scopes[], event_ids[]}` (AC-242 semantics)"*, and `EVALUATION.md` §2 AC-242 requires proving *"effective authority is grant∩membership"* with plural **event restrictions**. A plural set does not round-trip through one nullable column. This is precisely the class the ticket exists to catch — the plan's own non-goal says *"Any field required by downstream code but absent from SPEC §3 must be raised as a contract gap"* — but it was not raised, because the field is *present* and merely too narrow.

**Recommendation:** Rule it explicitly in the Resolutions block, one of: (a) `event_ids` is encoded inside the existing `scopes` JSON with a documented shape and a `json_valid` check — cheapest, no schema risk; or (b) add `api_token_events(api_token_id, event_id)` to 0001 now, since a join table is the expensive retrofit. State the ruling and flag it to the orchestrator as an Amendment-7/§3.2 contract tension either way. Keep `event_id` regardless (SPEC declares it).

---

**[MAJOR] "Verification and AC evidence" — the test surface is undeclared and collides with the two-file ownership**

The ticket's declared file surface is `migrations/0001_init.sql` and `src/db/schema.ts`. The verification section then demands roughly a dozen AC-trace fixtures plus an adversarial probe suite — all of which are new files at paths the plan never names, under a `vitest.config.ts` that MRQ-6 owns and may not have merged. The plan's mitigation ("use the landed harness if available; otherwise run reproducible headless commands and attach the transcript") tells the implementer what to *run* but not what to *commit*, so a context-clean sub-agent will either skip the tests or invent a directory that collides with MRQ-6's config the moment it lands.

**Recommendation:** Name the paths and declare them as an explicit addition to the M-02 file surface — e.g. `tests/schema/*.test.ts` for the AC traces and adversarial probes — and state the fallback concretely: if `vitest.config.ts` has not merged, the same assertions ship as a committed standalone script (e.g. `scripts/schema-verify.mjs` against `wrangler d1 execute --local`) with a handoff note for MRQ-6 to fold it into `npm test`. Confirm neither path is MRQ-6-owned.

---

**[MAJOR] "Verification and AC evidence" — schema-only tests will register as full coverage for six e2e-verified ACs**

`COMMON.md` §Validation pins *"Test names carry their AC IDs (`trace:ac` contract)"*, and `EVALUATION.md` line 52 says `trace:ac` *"scans test names for `AC-nnn` prefixes"*, failing on any `auto` AC with zero tests. MRQ-2 claims AC-234, AC-235, AC-246, AC-247, AC-248, AC-249 — all `auto`, and every one of their §2.3 rows demands something MRQ-2 structurally cannot do (AC-234 wants `e2e` 0/1/3-track submit plus `check:seed` ≥15% multi-track; AC-246 wants a route scan proving five surfaces call one helper; AC-247–249 want e2e CRUD, reload persistence, and 403s). The plan correctly assigns each remainder to its downstream owner in prose — but the moment MRQ-2 names a test `AC-246 reviewer scope uniqueness…`, gate 3's `trace:ac --scope=all` reports AC-246 covered, and the very ticket the schema exists to protect (MRQ-18) inherits a false green on a **Tier A no-waiver** criterion.

**Recommendation:** Rule the convention in the Resolutions block. Either (a) name the tests with the AC prefix — required to clear `--scope=merged` on this PR — **and** make it a hard requirement that the PR body and completion comment list each claimed AC as `schema-foundation only → <owner ticket>`, with a matching `lattice attach --role validation` note, so the gate auditor has the partial-discharge record; or (b) get the orchestrator to pin a distinct marker (e.g. `AC-246[schema]`) that `trace:ac` does not count as discharge. (a) is the lower-risk path given `trace:ac` is MRQ-6-owned and unwritten.

---

**[MAJOR] §3.4 checklist, `submissions.search_blob` — ships a column with no writer, against the plan's own rule**

`SPEC.md` §3.4 declares `search_blob`'s writer as **"trigger on write"**, and the §3 preamble is explicit: *"A field with no writer or no reader does not ship — it is a silent hole, and the fleet must delete it or report it."* The plan lists the column, enumerates ~150 indexes by name, and never mentions a trigger, a search index, or a ruling. Quick search (M-28/MRQ-29, AC-101–104) is Wave 2 at D+40 with a 200 ms p95 budget under G7 — a full-table `LIKE` over 1,000 rows with a stale `search_blob` is exactly the "slow list is a defect" case in `CLAUDE.md`.

**Recommendation:** Add an explicit ruling: either 0001 carries the `AFTER INSERT`/`AFTER UPDATE` triggers that maintain `search_blob` (the SPEC-literal read, and the safe one since 0001 is write-once), or the plan states that `search_blob` is application-maintained and its trigger/index land in MRQ-29's own `000N_*.sql`, recorded as a named handoff in "Non-goals and downstream handoff." Note also that the plan enumerates *tables and indexes* only — say in the migration-wide rules whether triggers are in or out of scope, since it is currently silent.

---

**[MAJOR] §3.9 checklist, `mirror_outbox` — `suppress_mirror` is never ruled on**

`SPEC.md` §3.9 says `reset:demo` *"writes with `last_write_source='marquee'` and a `suppress_mirror` flag so no per-row `mirror_outbox` entry is enqueued"*, and BUILDPLAN M-03 repeats it as a build obligation. The plan covers `last_write_source` on `people`/`submissions`/`speaker_tasks` but is silent on `suppress_mirror`. If MRQ-3 or MRQ-26 later reads it as persisted state, they hit a write-once file they cannot edit.

**Recommendation:** State the ruling in one line — `suppress_mirror` is a runtime write-path option on the `afterWrite` hook, not a column — and record it as a handoff note to MRQ-3/MRQ-26. If the implementer disagrees on reading §3.9, the column is nearly free to add now and expensive later.

---

**[MINOR] "Type mirror" — a hard 46-table assertion in a file no later ticket may edit**

The plan requires *"compile-time exhaustiveness/satisfies assertions that the table registry contains exactly the 46 expected names"* while also exporting `TABLES` as *"schema metadata sufficient for later thin-query code."* Per `BUILDPLAN.md` line 194, `src/db/schema.ts` is M-02-owned and later tickets append `src/db/schema.<module>.ts`. If `TABLES` is the registry the query helper consumes, MRQ-8 cannot add a table without editing an owned file or forking a second registry.

**Recommendation:** Scope the exact-46 assertion to a `CORE_TABLES` constant representing 0001 specifically, and export the extension mechanism (e.g. a `registerTables()` or a documented union point) that module mirrors compose into. One sentence in the plan prevents a fork.

---

**[MINOR] "Verification" bullet 1 — `PRAGMA foreign_key_check` on an empty database is near-vacuous, and D1's PRAGMA allowlist is unverified**

I confirmed locally that `foreign_key_check` does surface a missing parent table, so it is not useless — but against a freshly-migrated empty DB it can never report a row, so "require zero rows" is a weak gate presented as a strong one. Separately, D1 restricts which PRAGMAs it accepts; `table_info`, `index_list/index_info`, and `foreign_key_list` (all of which the plan also uses) are safe bets, but `foreign_key_check` may be rejected by `wrangler d1 execute`, which would strand the first verification step.

**Recommendation:** Reframe: `foreign_key_check` proves FK *targets resolve*; FK *enforcement* is proven by the adversarial insert probes the plan already specifies (which are the real evidence). Add the fallback: if D1 rejects the pragma, discharge via `PRAGMA foreign_key_list` introspection across all 46 tables plus the probes. Also add a one-line handoff to MRQ-4 that D1's documented workaround for FK-ordered bulk seeding is `PRAGMA defer_foreign_keys` — MRQ-4 will hit this and it belongs in the schema owner's handoff notes.

---

**[MINOR] Authority and scope — Amendment 10 is cited as authority but never resolved**

The plan names "SPEC §3 plus Amendments 10–11" as authority and then details only Amendment 11's fold. Amendment 10 (AC-251, per-item reviewer assignment) is satisfied by `round_assignments` as already specified and needs no new table. A context-clean implementer told to obey Amendment 10 with no ruling may invent one.

**Recommendation:** One line: "Amendment 10 (AC-251) requires no schema beyond `round_assignments.reviewer_person_id`; add nothing for it." Adjacent: the plan mandates a hard reviewer-XOR-committee CHECK on `round_assignments`, which is a real design commitment against a SPEC that describes two distribution modes — state the reasoning so it is a decision rather than an assumption baked into a write-once CHECK.

---

**[MINOR] §3.1/§3.6 — `events.venue` vs Amendment 11's "Room · Building" ICS `LOCATION`**

SPEC §3.1 gives `events.venue` reader *"public site, ICS `LOCATION` prefix"*; Amendment 11 gives `buildings` reader *"ICS `LOCATION` ('Room · Building')"*. Both survive in the plan (correctly — do not delete SPEC fields), but two declared sources for one output string will surface as a contradiction in MRQ-25.

**Recommendation:** Keep both columns; add a handoff line to MRQ-25 naming the collision so it is resolved once, in the ICS ticket, rather than guessed.

---

**[MINOR] "Type mirror" — insert types omit `created_at`, which has no SQL default**

The migration-wide rule specifies `created_at INTEGER NOT NULL` with no `DEFAULT` (correct — Worker-generated, consistent with ULID generation), while the mirror *"omits generated ULID/timestamps"* from insert types. Any downstream raw-SQL insert that trusts the insert type will fail `NOT NULL` at runtime. That failure is loud and arguably correct, but the obligation is unstated.

**Recommendation:** Record it as an explicit handoff to MRQ-8: the query helper must inject `id`, `created_at`, and `updated_at`. Also note that `updated_at` is load-bearing beyond freshness — Amendment 7 pins `ETag` derivation and `If-Match` on every PATCH/DELETE from it.

---

**[MINOR] Scope vs the 4-hour estimate**

BUILDPLAN allots 4 h for 46 tables, ~150 named indexes, a full row+insert type mirror, ~12 AC-trace fixtures, and an adversarial probe suite. The verification section alone plausibly exceeds the schema authoring. MRQ-2 is ⛔SERIALIZED on the Wave-0 critical chain (M-01→M-02→M-07→M-08 = 15 h), so overrun propagates directly to CP-1.

**Recommendation:** Not a plan defect — the plan cannot change the estimate — but state a priority order for a time-boxed implementer (schema correctness and the write-once constraints first; probe breadth second) and flag the estimate to the orchestrator so CP-1 is not surprised.

## 4. Positive Observations

- **Table coverage is exact and independently verified.** I enumerated SPEC §3 + Amendment 11 myself and reached 46; the plan's checklist hits all 46 with zero omissions and zero inventions, including the two easy misses (`submissions`, whose SPEC heading is prose rather than a backtick table, and the `committees`/`committee_members`, `imports`/`import_rows` pairs the plan calls out by name). Field-level transcription is likewise faithful, including all 15 `forms` columns, all eight `form_fields` types, and the complete `outbox` column list.
- **The SQLite semantics are genuinely understood, not gestured at.** Recognizing that NULL `event_id` breaks naive UNIQUE; that a row CHECK cannot aggregate siblings (rubric weights, "at least one track"); that a partial unique index gives "at most one primary" while "exactly one" is transactional; that `foreign_key_check` needs the real D1 engine for forward references — this is the difference between a schema that applies and a schema that holds. I confirmed the `json_array_length(...)=3` CHECK works as specified.
- **Correct restraint on the boundary between schema and behavior.** Every AC-trace bullet names what MRQ-2 discharges *and* what remains with its downstream owner. "Route-level 403/helper scans remain MRQ-17/MRQ-18" and "built-in immutability remains MRQ-34" are exactly right, and the plan resists the temptation to over-claim.
- **`EVALUATION.md` was read honestly.** Noting that AC-176/212/214/222 live in §7's modeled range rather than §2, and then explicitly refusing to invent §2 rows, is the correct handling of a real asymmetry — and matches the contract-owner ratification note in the ticket map.
- **Write-once discipline is treated as the load-bearing constraint it is.** The plan repeatedly reasons from "0001 can never be edited" rather than from "make it work now," which is precisely why the remaining findings above are worth resolving before a line of SQL is written.
