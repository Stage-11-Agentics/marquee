FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-49-audit-write" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-49** (A-7 — audit: public write surface and upload safety). Actor: `agent:auditor-mrq-49`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-49-audit-write`, branch `mrq-49-audit-write`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMBZKVHVTYC496BY95HHG.md` → `planned` → `in_progress` → work → self-review → PR → `pr_open`. Read the full scope with `lattice show MRQ-49 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any other work.** **Opening the PR is the final step and it is not optional** — one agent on this run finished everything, passed its gate, and died before opening the PR.

## Strangers can write here — that is the whole risk

The public CFP form and the upload path are the only places an unauthenticated person writes to our database and storage. Verify independently, and drive the paths rather than reading the tests:

- **Turnstile gates every public write and every presign** (AC-231). The one deliberate exception is \`PATCH …/drafts/:token\` autosave, which requires no Turnstile token but IS rejected without a valid resume token and IS rate-limited per token. Confirm that exception is exactly as narrow as stated — and that a missing or invalid token yields no row.
- **Hidden conditional fields are never persisted.** \`projectApplicableAnswers\` in \`src/lib/form-conditions.ts\` is the single evaluator; four surfaces consume it. Check none of them bypasses it — the admin-create path at \`src/routes/submission-record.routes.ts\` persists supplied answers and is worth reading closely.
- **Upload safety**: presign, verify, serve. File type and size limits enforced server-side, not merely in the client. A presign must not be usable to write outside its intended key.

**Report findings with \`file:line\` and a concrete failure input.** Where you find nothing, say what you checked. Add a machine guard where a finding could recur — \`tests/node/comms.AC-250.test.mjs\` is the model, now an AST inventory rather than a regex.

## Standing rules

- **Build on merged seams; never fork one.** `src/lib/form-conditions.ts`, `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/{outbox,render,merge-data}.ts`, `src/lib/venue-geometry.ts`, `src/routes/comms.routes.ts`, MRQ-8's list contract and generated route manifest.
- **The mail guardrail is now machine-enforced by an AST inventory** in `tests/node/comms.AC-250.test.mjs`: no production module may import a Resend client, only `src/jobs/mail/consumer.ts` may reference the endpoint, and exactly **two** live-policy writes exist, both in `outbox.ts`. If your work trips it, you have introduced a third — fix your code, never the guard.
- **Guardrail tests assert the status code AND the absence of the thing** (no leaked ID, no row written — check counts before and after) **and carry a positive control** so they cannot pass vacuously.
- Suite ~10–18s against 30s; whole gate 45s. Prefer `tests/node`. After any rebase `npm ci` and let it settle ~20s before gating. Resolve `.lattice/**` conflicts by taking upstream.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9**; **elements never jump**. Organizer's noun is **"conference"**; wire API keeps `/api/v1/events/...`. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files.

**`tests/ac-claims/MRQ-49.json`** — if you own no `auto` AC, say so explicitly rather than shipping an empty claims file. Before the PR: `npm run pr-gate -- --ticket MRQ-49`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
