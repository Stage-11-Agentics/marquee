FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-52-audit-bulk" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-52** (A-10 — audit: bulk-write path and chunking). Actor: `agent:auditor-mrq-52`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-52-audit-bulk`, branch `mrq-52-audit-bulk`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/$u.md` (uuid from `lattice show MRQ-52 --json`) → `planned` → `in_progress` → work → self-review → PR → `pr_open`. **COMMIT AND PUSH the plan as your first commit.** **Opening the PR is the final step and is not optional.**

## Bulk is the demo's headline action and its worst failure mode

A judge bulk-accepts 150 submissions on camera. Two things must hold: it completes, and it does not notify anyone twice.

Verify independently, driving the real path rather than reading tests:
- **D1 chunking**: MRQ-8 shipped a \`json_each\` chunking helper and MRQ-56's spike measured bulk-write at wave scale. Confirm every bulk path uses that ONE helper — bulk decisions, bulk reminders, rejection at scale, assignment distribution, category routing, import. A hand-rolled loop that works at 10 rows and blows the D1 statement limit at 150 is exactly the defect to find.
- **AC-117 idempotency**: \`outbox.idempotency_key\` = sha256(template_key, entity_id, person_id), UNIQUE in schema. Fire the same bulk action twice; assert ONE row and ONE delivery, by count.
- **AC-69 completion**: a bulk accept of 150 reaches a durable completed state, not a partial one. Kill it mid-flight if you can and check what survives.
- **Empty selection is a deliberate no-op** (\`recipientsFor\`) — treating [] as an omitted filter would turn a cleared board selection into a bulk send. Confirm every bulk entry point preserves that.

**Assume a green test over a dead path until proven otherwise** — that shape has appeared five times on this run. Add a machine guard where a finding could recur.

## Standing rules

- **Build on merged seams; never fork one.** `src/lib/form-conditions.ts`, `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/{outbox,render,merge-data}.ts` (**exactly two `always_live` sites**, machine-enforced by an AST inventory in `tests/node/comms.AC-250.test.mjs` which also forbids a direct `api.resend.com` fetch), `src/lib/venue-geometry.ts`, `src/lib/venue-disclosure.ts`, `src/lib/auth/auth-middleware.ts` (cookie and bearer BOTH org-filter via `loadMembershipsForOrg` — do not diverge them again), MRQ-8's list contract and generated route manifest.
- **Guardrail tests assert the status code AND the absence of the thing** — no leaked ID, no row written, counts before and after — **with a positive control** so they cannot pass vacuously.
- **Any guard you add keys on the invariant, never on coordinates.** Assert files/counts/ids, never line numbers; a guard that fails on unrelated drift gets silenced rather than heeded.
- Suite ~19–27s against 30s; whole gate 45s. Prefer `tests/node`. After any rebase `npm ci`, let it settle ~20s before gating; resolve `.lattice/**` conflicts by taking upstream.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9**; **elements never jump**. Organizer's noun is **"conference"**. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files or UI.

**`tests/ac-claims/MRQ-52.json`** — if you own no `auto` AC, say so explicitly rather than shipping an empty claims file. Before the PR: `npm run pr-gate -- --ticket MRQ-52`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
