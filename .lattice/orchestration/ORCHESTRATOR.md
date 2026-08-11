# Orchestrator checklist

The standing rules for dispatching this run. The tick prompt points here so it stays short — anything durable belongs in this file, not in the tick.

## Every tick

1. **Read state:** `lattice list`, open PRs, `c11 tree --all`. Note what moved since last tick.
2. **Merge what's ready** (protocol below).
3. **Refill to N** — merges free slots faster than you expect; check the count, don't assume.
4. **Verify master isn't ahead of the remote**, then push. `git pull --rebase --autostash forgejo master` always.
5. Reschedule ~300s while building.

## Merge protocol — in order, no shortcuts

1. **Scan the diff for secrets and PII** (`re_…` keys, API keys, real email addresses, external image URLs, phone/passport/visa). Seed tickets get extra scrutiny: real people's names ship in a public repo.
2. `head != base`, `mergeable == true`. **Check whether any live branch is stacked on this one** (footgun table below) — the repair is cheapest before the squash, not after.
3. **A PASS review naming HEAD** — or an identical tree/patch-id if the branch was rebased after review.
4. Merge, **capture the HTTP code**, then **re-GET and confirm `.merged == true`**.
5. **Only then**: `lattice status <id> pr_open` → `lattice complete` → close surface → delete branch locally **and** on Forgejo.
6. `npm ci && npm run pr-gate -- --ticket <last>` on master. A red master blocks the whole fleet.

**Never chain cleanup to the merge call.** On 2026-08-10 a chained command completed MRQ-17 and deleted its branch on a merge that returned 405 and never happened. Recovery: commits survive in the object store — `git push forgejo <sha>:refs/heads/<branch>`, open a fresh PR, merge properly.

## Hand-review these yourself — read the test, don't trust the report

Auth · presigns · demo-mode · AC-246 centralized authorization · AC-259's live Transit conflict · anything touching a guardrail.

What a real guardrail test looks like: it asserts **the status code AND the absence of the thing** — no leaked ID or title in the body, no side-effect row written. A status-only assertion passes while the leak ships.

**When a ticket claims it didn't weaken a prior guardrail, verify:** `git diff forgejo/master...<head> -- <test file>` and expect it empty.

## Known footguns

| Symptom | Reality |
|---|---|
| Merge returns **405 "Please try again later"**, `mergeable: false`, no conflicts | Forgejo recomputes mergeability asynchronously after master moves. Poll and retry; settles in ~20–30 s. Not an empty PR. |
| Agent launched fine but never claims, context stuck at 0% | Model refused: **"Selected model is at capacity."** Relaunch on `terra`/`sol`. **Verify engagement by the claim in `lattice list`, never by launch success.** |
| Delegator reports master is broken | Check before believing it — usually a stale `node_modules` after a rebase. Master has been green every time so far. |
| Delegator says it "routed around" something | Investigate. Twice this became an armed `check:api` failure that its own tests passed. |
| A module under `src/routes/` not named `*.routes.ts` | It misses the manifest glob and the OpenAPI document. Check its paths reach the schema before merging. |
| Delegator hits exit 44 on the Forgejo keychain | Its sandbox can't reach the item. Open the PR yourself rather than letting a finished branch sit. |
| After a squash-merge, a branch that was press-ahead-stacked on the merged one shows phantom diffs of all the parent's commits | A squash means the parent's commits are **not** ancestors of master. A plain `git rebase` replays them and conflicts against the squashed copy. Fix: `git rebase --onto forgejo/master <merged-branch-head-sha> <stacked-branch>`, then `--force-with-lease`. **Check for stacked branches before every merge** — `git merge-base --is-ancestor <pr-head> <other-branch>` — and if the stacked branch has uncommitted work, send its agent the recipe rather than rebasing under it. |

## Dispatch judgment

- **Hold the audit track** until near a checkpoint — auditing a moving tree wastes the independence that makes it worth running.
- **S-1 (Airtable spike)** needs the operator's Team base; it stalls without it.
- **MRQ-30** (API completion + webhooks, 9h, Tier B) is the first cut if Wednesday gets tight.
- Contract conflicts are the orchestrator's to resolve — delegators flag and keep moving; you amend SPEC or redirect.
- **Design-contract changes (the prototype) are the orchestrator's call**, never a delegator's silent reconciliation.

## Current standing context

- **Deadline:** Wed Aug 12 22:00 PT = **Thu Aug 13 01:00 EDT**.
- **Models:** build on codex `gpt-5.6-luna` at `max`; `terra`/`sol` for hard items or capacity fallback; Claude sonnet for design. Always pass `--model`.
- **Capacity:** Codex effectively free. **Bravo is orchestration + hand reviews only — never delegate on it.** Alpha untouched, needs an operator login.
- **Refs:** workspace:9, pane:16, orchestrator surface:60.
