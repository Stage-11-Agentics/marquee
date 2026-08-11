FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-34-views" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-34** (BUILDPLAN **M-55 + M-36** — saved views, configurable columns, the Draft queue, and the builder condition summary; ~7h). Actor: `agent:delegator-mrq-34`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-34-views`, branch `mrq-34-views`, cut clean off `forgejo/master` (`ab159bc`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMAJE83227X9NNDJETFQ4.md` (that absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. **Headless reviews are suspended** — self-review inline, attach a standard-shape review naming your exact HEAD.

**Push `mrq-34-views` to Forgejo as soon as it has its first commit**, and after every meaningful commit after that. **Write your plan to the plan file early and in rough form** — agents on this run have compacted mid-planning and lost the whole window; a rough plan on disk beats a polished one in context.

## The one thing this ticket must get right

AC-249's *applicable missing fields* is **`isFieldApplicable()`'s output** — it is computed through MRQ-13's shared helper in `src/lib/form-conditions.ts`, **never against the full required set**. The reason is in the scope line verbatim: *a draft must not be marked incomplete for a field its submitter can never see.* Marking a draft "incomplete" because of a hidden conditional field is a lie told to a speaker about work they cannot do.

You are the **second** consumer of that helper (MRQ-15's submit path is the first). Its header says later surfaces add consumers there and **do not create a second evaluator** — that is binding. If you need behaviour it does not express, **add to `form-conditions.ts`** and say so in your PR body. Never inline a second applicability check, and never re-derive the required set.

Prove it with a test that is about behaviour, not shape: a draft missing only a **hidden** conditional field counts as **not** needing attention, while the same draft with that field **revealed** does. That single pair is the whole point of the ticket.

## Scope

**M-55 — saved views, columns, Draft queue** (ACs **AC-247 – AC-249**): personal, event-scoped view CRUD capturing query, filters, sort, and column order; **immutable built-ins**; a fixed column registry; and a `Drafts needing attention` surface with count, contact, last-save, and applicable-missing-fields. Opening or editing a draft **never submits it**. Form-admin / program-staff authorization applies — this reads other people's unsubmitted work, so gate it and prove the gate asserts **both** the status code **and** the absence of draft content in the body.

**Column registry (AC-248), exactly these:** Type, ID, Title, Speakers, Status, Tracks, Score, Submitted, Last updated, Origin, Missing fields. **Title is mandatory** — it cannot be removed or reordered out.

**M-36 — builder-list condition summary** (AC **AC-134**): a **summary affordance only** — conditions visible in the field list without opening a field. The evaluator itself is MRQ-13's and is already built; you are rendering what it already knows.

**ACs: AC-134, AC-247 – AC-249.**

## What you inherit

- **MRQ-8** — the list contract (`page/per_page/q/sort/filters` → `{data, page, per_page, total}`) and the generated route manifest (`*.routes.ts`; `check:api` fails a route that bypasses it). Saved views capture that same query shape — **do not invent a second filter vocabulary**, or a saved view will silently stop matching the list it came from.
- **MRQ-9** — the submissions list you are making configurable. **MRQ-33 (just merged)** — the submission record and the read-only program board; your column registry and the record must agree on field names.
- **MRQ-13** — the builder and `form-conditions.ts`. **MRQ-60/61** — auth is wired into the API runtime; resolve the principal through the credential resolver.

## Craft

`PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9** is the binding visual contract. **Elements never jump** — this ticket is unusually exposed to it, because toggling columns and switching views is *exactly* the interaction that reflows a table. Reserve space, keep column widths stable, use tabular numerals for every count, and show "—" rather than dropping a row. Honest empty states: "no drafts need attention" is a real, good answer and should look like one, not like a broken query. The organizer's noun in UI copy is **"conference"** (the wire API keeps `/api/v1/events/...` — SPEC Amendment 13).

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-34.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. After any rebase run `npm ci` before trusting a red test — never `npm install --no-save`.

Before the PR: `npm run pr-gate -- --ticket MRQ-34`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
