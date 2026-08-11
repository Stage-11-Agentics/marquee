# Handover: Kimi → Claude (operator ruling, 2026-08-10)

You are taking over a ticket that a Kimi delegator started and did not finish. **Read this before your ticket's boot file; on conflict, this file wins.**

## What you inherit

Your worktree holds **uncommitted, untracked work from the previous session — it is intact and it is yours to judge.** It was written by a model whose output the operator found below the bar, which is why the fleet switched. So:

- **Read it before you trust it.** Keep what is right, fix what is wrong, delete what is wasted. You are not obliged to preserve any of it, and you should not pretend it is reviewed work.
- **Commit it first anyway** (`git add -A && git commit -m "<ticket>: inherited WIP from prior session"`) so the starting point is in history and your own changes are legible as a diff on top of it. Then improve it in subsequent commits.
- A real defect was already found this way in MRQ-4's inherited code: a seed filter keyed on an unreliable `type` field was seeding a coffee break as an accepted abstract. Assume similar defects exist in yours.

## Rebase before you do anything else

```
git add -A && git commit -m "<ticket>: inherited WIP"
git fetch forgejo && git rebase forgejo/master
git push forgejo <your-branch>          # push immediately, then at every boundary
```

Master has moved substantially since your branch was cut. It now carries:

- **`1507bff`** — the adversarial pass closed (8/8 BLOCKING · 22/22 FIX · 8/8 NOTE). Contract docs moved.
- **`c64a9ba`** — MRQ-4's seed spine merged (event, taxonomy, venue, the 60-session real accepted core, `SEED-DATA.md`).
- **`9e8b425`** — ⚠ **the organizer's noun was renamed `event` → `conference`** across UI copy and routes. If your inherited code says "event" in user-facing copy or route paths, it is now wrong. The database column `event_id` and similar internal identifiers are a separate question — read the commit before mass-renaming anything.
- **`13d37eb`** — the venue map: building geography becomes a real constraint for travel-conflict detection. Note that `buildings` does **not** yet have `lat`/`lng`/`access_minutes` — that migration is **MRQ-58**, not yours. Do not add those columns.

## Two rules that bit the previous fleet

1. **Tests are not optional.** The previous sessions produced ~1,900 lines across four tickets and **zero test files**, while `trace:ac` blocks merge on uncovered `auto` ACs. Copy MRQ-4's shipped pattern: an AC-tagged test under `tests/` whose name carries its `AC-nnn`, plus `tests/ac-claims/<TICKET>.json`. A PR without them cannot merge.

2. **`package.json` and `package-lock.json` are contended.** `BUILDPLAN.md` §7 reserves them to M-06 through the orchestrator, and two of the in-flight branches are both editing them. Keep your edits to the minimum your ticket genuinely needs, state in your PR body exactly which dependency you added and why, and expect the orchestrator to resolve overlaps as a union at merge. Do not reformat, reorder, or regenerate the lockfile wholesale.

## Gate, unchanged

`npm run pr-gate -- --ticket MRQ-N` before you open the PR; paste the result into your completion comment. Private Forgejo has no CI runner, so this local gate is the only thing between a broken PR and master. Headless `lattice code-review` stays suspended — self-review, attach a standard-shape review naming your exact HEAD, and the orchestrator independently scans every diff before merging.

Report to the Orchestrator at **workspace:9 surface:60**.
