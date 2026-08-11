FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-12-email" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-12** (BUILDPLAN **M-11** — email core and demo-safe outbox; inline-full, ~6h). Actor: `agent:delegator-mrq-12`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-12-email`, branch `mrq-12-email`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-12 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. **Headless plan-review and code-review are suspended** — self-review inline, attach a standard-shape review naming your exact HEAD.

## Why this ticket is urgent

**Right now, Marquee sends no email at all.** MRQ-3 merged auth that *enqueues* `magic_link_login`, `draft_resume`, and `task_link` mail into the `outbox` table — and you own the queue consumer that is the only thing allowed to actually send. Until you land, magic links are written to a table nobody drains. Every later comms ticket builds on what you define here.

## The two things that must be exactly right

1. **`send_policy` — the demo-safe trap.** `outbox.send_policy` is `demo_safe | always_live`, defaulting to `demo_safe`, and it already exists in MRQ-2's migration. **Exactly two write sites may ever set `always_live`** (guardrail G3, audited by A-3). Everything else is suppressed to a rendered outbox row with no real delivery. Resend's free tier is 100/day — a loop that sends live during judging burns the quota and mails real people. Name the two live sites explicitly in your PR body.
2. **Idempotency — AC-117: "a repeated bulk action cannot notify twice."** `outbox.idempotency_key` is `sha256(template_key, entity_id, person_id)` and is UNIQUE in the schema. The send path must rely on that constraint, not on a pre-check that races. Prove it with a test that fires the same bulk action twice and asserts one row and one delivery.

## Scope and ACs

From `lattice show MRQ-12 --json`. ACs: **AC-33, AC-117, and the foundation for AC-125 – AC-131.** Read `SPEC.md`'s comms sections and `code/platform/resend.md`-equivalent details in SPEC before choosing an integration shape. Sender identity and the verified domain are already decided in SPEC — do not invent a new one.

There is no live Cloudflare account this run (deferred to **MRQ-57**), so validate against local Queues/D1 via `wrangler dev` and miniflare. Anything provable only against real Resend goes in your PR body as a named MRQ-57 checklist item, never faked locally.

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-12.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. After any rebase run `npm ci` before trusting a red test — never `npm install --no-save`.

API route modules are named `*.routes.ts` so the generated manifest glob finds them (see COMMON). Before the PR: `npm run pr-gate -- --ticket MRQ-12`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
