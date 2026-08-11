FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-66-migration" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-66** (M-61 — task cancellation and webhook tables migration). Actor: `agent:delegator-mrq-66`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-66-migration`, branch `mrq-66-migration`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZQFM4DCPZRAV30ZVPECSTWH.md` → `planned` → `in_progress` → implement → self-review → PR → `pr_open`. **COMMIT AND PUSH the plan as your first commit.** **Opening the PR is the final step and is not optional** — an agent on this run finished everything, passed its gate, and died before opening the PR.

## Additive migration only — and mind the number

**\`0003_building_access_note.sql\` and \`0004_calendar_reversal.sql\` already exist**, so yours is **\`0005_\`**. The ticket text calls it the third migration; that was written before two others landed. 0001 and 0002 are merged and immutable, as are 0003 and 0004.

ADD \`speaker_tasks.cancelled_at INTEGER\` nullable. **The existing \`CHECK (status IN ('open','done'))\` stays exactly as it is.** The rationale is binding and worth restating because it is the whole point: a third enum value would leave every existing \`status='open'\` read site silently including cancelled work, whereas a nullable timestamp inverts it into a predicate (\`cancelled_at IS NULL\`) so an unconverted read site is **loudly wrong in review**. Same shape as \`magic_links.used_at\` and \`imports.undone_at\`.

CREATE \`webhook_endpoints\` and \`webhook_deliveries\` exactly as SPEC §3 specifies, with an index on \`webhook_deliveries(endpoint_id, created_at)\`. **SPEC Amendment 16** ratified the six event types — \`submission.created\`, \`submission.status_changed\`, \`evaluation.completed\`, \`speaker_task.completed\`, \`agenda.published\`, \`speaker.confirmed\` — and \`events_json\` is a subset of exactly those.

**MRQ-53's reset drill is auditing \`WIPE_ORDER\` right now** and its guard asserts reset covers every table the schema defines. Add your two new tables to \`WIPE_ORDER\` in \`src/lib/reset-demo/reseed-demo.ts\` in FK-safe order, or you will land a red master. MRQ-67 depends on this migration; land it clean and quickly.

## Standing rules

- **Build on merged seams; never fork one.** `src/lib/form-conditions.ts` (one evaluator, four consumers), `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/{outbox,render,merge-data}.ts` (**exactly two `always_live` sites**, machine-enforced by an AST inventory in `tests/node/comms.AC-250.test.mjs` that also forbids a direct `api.resend.com` fetch), `src/lib/venue-geometry.ts`, `src/lib/venue-disclosure.ts`, `src/lib/auth/auth-middleware.ts` (cookie and bearer BOTH org-filter via `loadMembershipsForOrg` — do not diverge them again), MRQ-8's list contract and generated route manifest.
- **Guardrail tests assert the status code AND the absence of the thing** — no leaked ID, no row written, counts before and after — **with a positive control**.
- **Any guard keys on the invariant, never on coordinates** — files/counts/ids, never line numbers.
- Suite ~19–27s against 30s; whole gate 45s. Prefer `tests/node`. After any rebase `npm ci`, let it settle ~20s before gating; resolve `.lattice/**` conflicts by taking upstream.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9**; **elements never jump**. Organizer's noun is **"conference"**. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files or UI.

**`tests/ac-claims/MRQ-66.json`** — declare what you own; if nothing `auto`, say so explicitly. Before the PR: `npm run pr-gate -- --ticket MRQ-66`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
