FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-69-audit-remediation" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-69** (audit remediation — make the seed exercise the product). Actor: `agent:delegator-mrq-69`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-69-audit-remediation`, branch `mrq-69-audit-remediation`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZQMFC33HA1XBRX0S5PXY093.md` → `planned` → `in_progress` → implement → self-review → PR → `pr_open`. **COMMIT AND PUSH the plan as your first commit.** **Opening the PR is the final step and is not optional** — an agent on this run finished everything, passed its gate, and died before opening the PR.

## This is the most walkthrough-critical ticket left

**Read \`sequence/code-quality-audit.md\` first, in full.** Every finding carries a file:line, a failure input, and the smallest correct fix. Its unifying sentence is the one that matters: **the code is largely correct and the shipped seed cannot exercise it.**

Concretely, the seed writes ZERO \`submission_answers\` and ZERO attachments across all 1,000 submissions, so **every reviewer detail screen renders eight rows of \"Not answered\" and \"No files attached\" — on walkthrough step 8, the single most-graded screen.** It reads green today only because the AC-244 test builds its own fixture carrying an answer the seed never writes. That is the venue-coordinates defect repeating: green tests over an inert feature.

Also in scope: **wire the applicability guard** on the admin-create path (\`src/routes/submission-record.routes.ts\` persists supplied answers verbatim, bypassing \`projectApplicableAnswers\`, so a crafted request persists a hidden-by-condition answer and skips minLength), and **collapse the reviewer-queue query**.

**Prove the fix the way the defect hid**: assert against the DATABASE that seeded \`submission_answers\` and attachments are non-zero, and that a reviewer detail for a SEEDED submission renders real content — not a fixture you built. \`scripts/checks/seed.ts\` is the natural home for the assertion half; MRQ-23 left the venue assertions there and they must survive.

The operator deliberately deferred this to the end of the run so it would not collide with six live agents. That moment is now — the tree is quiet.

## Standing rules

- **Build on merged seams; never fork one.** `src/lib/form-conditions.ts` (one evaluator, four consumers), `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/{outbox,render,merge-data}.ts` (**exactly two `always_live` sites**, machine-enforced by an AST inventory in `tests/node/comms.AC-250.test.mjs` that also forbids a direct `api.resend.com` fetch), `src/lib/venue-geometry.ts`, `src/lib/venue-disclosure.ts`, `src/lib/auth/auth-middleware.ts` (cookie and bearer BOTH org-filter via `loadMembershipsForOrg` — do not diverge them again), MRQ-8's list contract and generated route manifest.
- **Guardrail tests assert the status code AND the absence of the thing** — no leaked ID, no row written, counts before and after — **with a positive control**.
- **Any guard keys on the invariant, never on coordinates** — files/counts/ids, never line numbers.
- Suite ~19–27s against 30s; whole gate 45s. Prefer `tests/node`. After any rebase `npm ci`, let it settle ~20s before gating; resolve `.lattice/**` conflicts by taking upstream.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9**; **elements never jump**. Organizer's noun is **"conference"**. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files or UI.

**`tests/ac-claims/MRQ-69.json`** — declare what you own; if nothing `auto`, say so explicitly. Before the PR: `npm run pr-gate -- --ticket MRQ-69`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
