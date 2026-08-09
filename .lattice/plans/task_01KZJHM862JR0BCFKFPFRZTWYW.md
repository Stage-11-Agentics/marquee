# MRQ-9: First loop screen: submissions list

BUILDPLAN: M-08 — Wave 0 (§3), the last ticket before CP-1

Scope (verbatim): Server-side filtered/sorted/paginated list at 50/page over the seed, type/status/track filters including Draft, selection state, exact record navigation, empty state, and the stable column registry that M-55 configures. Proves the whole stack end to end on real data.

Amendment 5 fold (AC-240): slot chips (day · time · room) and the "Not yet public" marker land in the submissions list here.
Vocabulary note (SPEC): **`waitlisted` displays as "Maybe"** on chips and filters.

File surface: `src/routes/submissions.routes.ts`, `submissions.queries.ts`, `src/ui/submissions/*`

ACs: AC-23, part AC-66, foundation **AC-240, AC-247–249**
Hours: 4
Workflow: inline-full
Shared files: none — module-local. The **column registry** it defines is consumed by M-55; keep it a named module (`src/lib/`-style specific name), never a `utils.ts`.
Deps: M-04a, M-05a+M-06, M-07
CP-1 (human-visible checkpoint) closes when this lands: deployed URL, populated, both demo logins land on a real screen, `npm test` green in <30 s, `check:repo` clean; traps 2, 4, 15 closed; felt checkpoint C1 runs.
Plan: filled in by delegator's plan phase
