# MRQ-2: Database schema — the whole init migration

BUILDPLAN: M-02 — Wave 0 (§3) ⛔ SERIALIZED · never merged with another item

Scope (verbatim): Every table in `SPEC.md` §3 in one migration, including `submission_tracks`, `submission_decisions`, `reviewer_track_scopes`, `saved_views`, and `form_admins`; indexes for submissions/status/kind, track intersections, reviewer scopes, saved-view ownership, participations, tasks, agenda, outbox, and evaluation uniqueness. **`outbox.send_policy TEXT NOT NULL DEFAULT 'demo_safe'` (`demo_safe|always_live`) lands in this migration** — it is what lets the queue consumer implement G3's tested exception (B-8). **Status enum complete including `waitlisted`; `(person, submission, role)` triple; round-aware evaluation; event + explicit-track reviewer authority from day one.**

Amendment 11 fold (SPEC.md, post-BUILDPLAN-v1.4 — flagged to the orchestrator): the venue model lands in THIS single migration — **`buildings`** (`event_id`, `name`, `address`, `position`) and **`rooms`** gaining `building_id` (required), `av_capabilities` (JSON tag array), and `notes`. AC-252/AC-253. Retrofitting a required FK after dependent tickets ship is expensive; this is the one chance.

File surface: `migrations/0001_init.sql`, `src/db/schema.ts`

ACs: AC-176, AC-212, AC-214, AC-222, **AC-234, AC-235, AC-246–249** · plus schema-only foundation for **AC-252, AC-253** (Amendment 11)
Hours: 4
Workflow: sub-agent-full (named in the mint brief: schema)
Shared files: `migrations/0001_init.sql` — M-02 OWNS it, **written once**; every later change is its own `000N_<ticket>.sql` and nobody edits 0001 after this merges. `src/db/schema.ts` — M-02 OWNS it as the type mirror of 0001; later tickets append `src/db/schema.<module>.ts`.
Deps: M-01
Plan: filled in by delegator's plan phase
