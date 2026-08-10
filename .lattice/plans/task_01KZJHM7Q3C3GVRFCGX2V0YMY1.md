# MRQ-4: Seed generator — spine

BUILDPLAN: M-04a — Wave 0 (§3) ⛔ ON THE CRITICAL PATH

Scope (verbatim): `scripts/seed/` skeleton from `sources/aie-summit-2025-program.json`: event, formats, tracks, rooms, waves, task templates, and the **60-session real accepted core** with its speakers and participations. Idempotent; `npm run seed`; `reset:demo` calls it. **Placeholder avatars only; no real emails; no real headshots.** Deliberately small so it does not sit on M-08's critical path.

Split rationale (adversarial B-5, §3): M-04a carries only what M-08 needs, so the Wave 0 critical chain is M-01 (3) → M-02 (4) → M-04a (2) → M-08 (4) = **13 h, not 18**. **Do not re-fuse this with M-04b** — that merge was considered at mint and declined for exactly this reason.

Amendment 4 fold: the seed carries swyx's named task templates — "Hotel and Travel Reservations" (form) + "Presentation Upload" (file request) leading every accepted speaker's list, plus the optional four across a subset (SPEC §6).
Amendment 11 fold (SPEC.md, post-BUILDPLAN-v1.4): seed the real **four buildings** of the 2025 program and attach every room to one (AC-252).
Trap 16: set an explicit `User-Agent` on every stdlib HTTP call in seed/backfill scripts — `api.resend.com` 403s `Python-urllib`.

File surface: `scripts/seed/index.ts`, `scripts/seed/event.ts`, `scripts/seed/accepted-core.ts`, `src/lib/ids.ts`

ACs: AC-8 · seed-side foundation for **AC-252** (Amendment 11)
Hours: 2
Workflow: fast-track (≤2 h) — but it owns a flagged shared file and sits on the critical chain; treat the file rule as binding.
Shared files: `scripts/seed/index.ts` — M-04a OWNS it (§7). Orchestration only; per-entity seeders are separate files it globs, so M-04b never edits it.
Deps: M-02
Human precondition: Airtable demo base on Team or above **before** this seed runs (§8 item 4, trap 6 — Free caps at 1,000 records and the seed is exactly 1,000)

---

## Delegator plan (agent:delegator-mrq-4, 2026-08-10)

Working against `forgejo/master @ f4aafea` (rebased onto it before first edit).

### Deviations from the ticket text, taken per boot prompt + contract (flagged in completion)

1. **Buildings: three, not four.** The ticket text says "seed the real four buildings of the 2025 program", but SPEC Amendment 11 (later, binding: "a 2026 event at the Sheraton cannot coherently seed 2025's venue buildings") and the boot prompt both rule the **Sheraton-coherent trio** — Sheraton New York Times Square · Workshop Annex · Online. Taking the trio (AC-252's `check:seed` wording also says trio).
2. **`package.json` is M-06-owned but carries no `seed` script.** `npm run seed` is in my verbatim scope, so I add exactly one script line (`"seed": "node scripts/seed/index.ts"`) and bump `engines.node` to `>=22.18.0` (native type-stripping; `schema-verify.mjs` already requires ≥22.5 for `node:sqlite`, so engines was already understated). No dependency changes. Flagged to the Orchestrator.
3. **One extra room, `Online`, in the Online building.** §6's room list is ballrooms + Expo Stage + Workshop Rooms A–E, but the Online building then has no room and the two real Online-format accepted sessions could never be scheduled by M-04b. Adding a 10th room "Online" (capacity 0). The trio assertion is unaffected.
4. **Task form `kind`.** The schema (`forms.kind ∈ abstract|session`) has no value for a speaker-task form, but `task_templates.kind='form'` requires a `form_id`. The "Hotel and Travel Reservations" form is seeded with `kind='session'` (non-competitive intake) — least-wrong under the binding schema. Flagged as a SPEC/schema gap.
5. **8th track color.** DESIGN.md says "eight track colors" but tokens/skin/prototype define only seven (no Leadership color). Leadership gets `#be185d` in the seed row only — no token file touched.

### Architecture

`scripts/seed/` is a Node ≥22.18 script (erasable-syntax TS, run via plain `node`), never imported by the Worker. It generates one idempotent SQL file and applies it through `wrangler d1 execute DB --local --file …` (the repo's established `schema-verify.mjs` pattern). Default target is wrangler's default local state so `wrangler dev` serves the seeded data; flags: `--remote`, `--persist-to <dir>` (tests/validation). No outbound HTTP anywhere (trap 16 N/A — no stdlib HTTP calls exist in this seed).

- **`scripts/seed/index.ts`** *(owned shared file — orchestration only)*: discovers sibling seeders by globbing its own directory for `*.ts` files other than `index.ts` and `_*.ts` helpers, dynamically imports each, collects their exported `SeedModule` (`{ name, order, run(ctx) }`), sorts by `(order, name)`, concatenates their SQL statements, writes a temp `.sql`, invokes wrangler. M-04b adds `pool.ts`/`evaluations.ts`/`agenda.ts`/`ugliness.ts` with `order ≥ 30` and never edits this file.
- **`scripts/seed/_sql.ts`** (helper): SQL literal escaping, `upsert(table, row)` → `INSERT … ON CONFLICT(id) DO UPDATE`, batching.
- **`scripts/seed/_source.ts`** (helper): loads + validates `sequence/research/sources/aie-summit-2025-program.json`, exposes the 60 content sessions (TALK/WORKSHOP) and 75 deduped speakers; email synthesizer (`firstname.lastname@example.com`, diacritics stripped, deterministic `-2` collision suffix); track keyword-scorer.
- **`scripts/seed/event.ts`** (`order 10`): organization, event (`AI Engineer New York 2026`, Oct 12–14 2026, `America/New_York`, venue Sheraton NY Times Square, `status='live'`, `demo_mode=1`), the four AC-8 formats with verbatim duration ranges, the eight §6 tracks with skin-c colors (+ Leadership `#be185d`), the Amendment-11 building trio, ten rooms each FK'd to a building, three waves (Aug 15 sent / Sep 1 pending / Sep 15 planned), two forms (CFP abstract form, closes Sep 12 2026; hotel/travel task form), the six Amendment-4 task templates (leading two `auto_assign=1`: "Hotel and Travel Reservations" kind `form`, "Presentation Upload" kind `file` with `file_config`; optional four kind `acknowledge`), one synthetic staff person ("AIE Program Committee", `program.committee@example.com`) as submitter of record for the three speakerless program items.
- **`scripts/seed/accepted-core.ts`** (`order 20`): 75 real speakers (real names/titles/companies/bios, synthetic emails, `headshot_attachment_id NULL` — placeholder initials-SVG is a UI render concern, no attachments seeded), 60 accepted `submissions` (`kind='abstract'`, real titles + verbatim public abstracts, `external_ref='aie-2025:<source id>'` for provenance, format mapped WORKSHOP→Workshop / Online-track→Online / ≤10 min→Lightning / else Stage Talk, primary track via keyword scorer with source-track fallback, `submission_tracks` primary row, wave split 32 Wave-1 / 28 Wave-2 by start time, `decided_at` Aug 15 / Aug 19, Wave-1 participations `confirmed`, Wave-2 `pending` = decided-not-sent), and `participations` (`speaker` first, `co_speaker` rest, source order).
- **`src/lib/ids.ts`**: deterministic seed IDs — `seedId(prefix, key)` → readable slug IDs (`evt_aie-ny-2026`, `sub_<slug>`, `per_<slug>`) plus a generic slugifier. Determinism is what makes re-runs no-ops (runtime ULIDs stay a Worker concern; the seed is not the Worker).
- **`SEED-DATA.md`** (repo root): the §6-required provenance/no-affiliation notice.
- **`tests/unit/seed-spine.test.ts`** (hermetic vitest): `AC-8 · …` asserts the four formats + durations from the built SQL rows; `AC-252 · …` asserts the building trio and that every room has a building; plus spine invariants (60 accepted, 75 people, no non-`example.com` emails, idempotent rebuild = byte-identical SQL).
- **`tests/ac-claims/MRQ-4.json`**: `owns: ["AC-8"]`, `exercises: ["AC-252"]`.
- **`tsconfig.test.json`**: add `scripts/seed/**/*.ts` to `include` so pr-gate typechecks the seed (not a flagged file).

### Idempotency

Every row is an upsert keyed on a deterministic ID with deterministic values; re-running `npm run seed` writes the same rows and never deletes — M-04b's pool data survives a spine re-run. `reset:demo` (M-03/MRQ-14) owns full wipes.

### Out of scope (M-04b / others)

The 940-row pool, evaluations state, agenda + double-bookings, deliberate ugliness, `speaker_tasks` instances, demo organizer/speaker personas, malformed records, avatars-as-files.

### Validation

Run `npm run seed -- --persist-to <tmp>` for real against local D1, apply `0001_init.sql` first, then assert via SQL: four formats, 3 buildings / 10 rooms all FK-valid, 8 tracks, 3 waves, 6 task templates, 60 accepted submissions, ≥75 people, participations coherent, zero non-example.com emails; run seed twice → identical row counts. Then `npm run pr-gate -- --ticket MRQ-4`.
