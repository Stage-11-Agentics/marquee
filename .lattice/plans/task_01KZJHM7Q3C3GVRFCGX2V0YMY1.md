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
Plan: filled in by delegator's plan phase
