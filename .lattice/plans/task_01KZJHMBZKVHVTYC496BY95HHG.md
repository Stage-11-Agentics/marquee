# MRQ-49: Audit — public write surface and upload safety

## Contract and operating boundary

- Ticket: A-7 audit track, AC-231 and AC-232; actor `agent:auditor-mrq-49`.
- Repository: `/Users/atin/Projects/Stage11/deployments/Marquee`; worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-49-audit-write`; branch: `mrq-49-audit-write`.
- Starting point recorded at planning: `forgejo/master` = `cfd7e700fe65a0f153748674d52d6d6bb8dd4973`.
- This is an audit artifact, not an authorization to edit SPEC/EVALUATION/BUILDPLAN/DESIGN/PHILOSOPHY/USER_STORIES or mint ACs. No `auto` AC is owned by this ticket; do not create an empty `tests/ac-claims/MRQ-49.json`.
- Keep the audit independent of the M-13/M-14 authors: drive the public paths and inspect resulting rows, R2 objects, response headers, and route/key boundaries. Distinguish observed proof, test evidence, and code inference in the final report.

## Investigation and evidence plan

1. Establish a clean baseline and map the actual public write surface. Read the ticket dependencies, route manifest, route modules, `src/lib/form-conditions.ts`, the four condition consumers, the admin-create path in `src/routes/submission-record.routes.ts`, and the upload implementation only to identify concrete endpoints and line references. Run the relevant existing `tests/node` probes and the baseline gate without treating tests alone as proof.
2. Exercise Turnstile policy with a positive control and absence checks. For draft creation, submit, and every presign, send missing and invalid Turnstile inputs and verify the expected rejection plus unchanged database row counts. Exercise a valid-token control. For `PATCH …/drafts/:token`, send no Turnstile token with a valid resume token, then missing/invalid/foreign/expired tokens, and a per-token burst; verify only the valid case can write, no invalid case creates or mutates a row, and rate limiting is per token rather than global. Record exact method/path/input/status and before/after counts.
3. Exercise conditional-answer persistence on every consumer. Use a fixture containing hidden/inapplicable answers and applicable answers, drive the public create/submit/autosave and relevant admin-create paths, and compare persisted answers with `projectApplicableAnswers`. Check that no consumer can persist a hidden field by supplying it directly. If a bypass is found or could recur, add the narrowest machine guard as an AST inventory under `tests/node` (following `tests/node/comms.AC-250.test.mjs`) and include a positive control; do not weaken the shared evaluator or invent a second writer.
4. Exercise the full upload lifecycle: presign, write, verify, and serve. Independently probe disallowed extension, disallowed MIME, valid type/size, oversized input, and magic-byte/type contradiction. Confirm every rejected presign is gated, every rejected verification leaves no R2 object (`HEAD` 404), and valid writes cannot select a caller-controlled key, path traversal, alternate prefix, or another submission. Drive per-IP and per-submission caps until each returns 429, using isolated identities/tokens and checking that unrelated identities remain usable. Fetch a valid served object and verify attachment disposition, `nosniff`, and a host distinct from the app host.
5. Self-review as an adversary: enumerate every unauthenticated write/presign route and every upload state transition, check absence assertions and positive controls, then resolve any finding before review. Report each finding with `file:line`, a concrete failure input, observed status/absence evidence, severity, and the smallest fix/guard. Where nothing is found, list the exact surfaces and negative/positive cases checked.

## Verification and handoff

- Run the focused `tests/node` suite and the full `npm run pr-gate -- --ticket MRQ-49`; paste the gate result into the completion record.
- If the audit adds a guard, commit it separately from the audit/report artifact and push after each meaningful commit. Keep the default suite hermetic and within the repo's gate budget.
- Attach the final audit evidence and a post-`review` PASS artifact naming the branch HEAD. Transition through `in_validation`, attach runtime evidence (or an explicit N/A only where a live probe truly cannot apply), create the Forgejo PR against `master`, attach its URL, and only then set `pr_open`.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Verdict: PASS. Self-review found no untriaged plan defect. The plan covers the complete gated set, the deliberately unprotected autosave exception, conditional-answer consumers including admin create, the presign/write/verify/serve lifecycle, row/object absence assertions, positive controls, key-boundary attacks, caps, report line references, required local gate, validation evidence, and the mandatory PR/status handoff. No production change is pre-authorized; a machine guard is added only if the audit identifies a recurring bypass.

## Operator Ruling Amendment (AUTHORITATIVE)

- The reproduced public-presign Turnstile replay is a real security finding. A single verified token must be single-use on the public presign path; the second attempt must be refused before any new attachment row or object is created.
- A contained fix in the public presign handler is authorized. Do not change shared upload/auth seams; stop and report if the fix requires them.
- MRQ-57 real Cloudflare deployment is gated on this fix. The PR body must state that dependency explicitly.
- The admin hidden-conditional persistence finding is known and remains unfixed in this ticket. Document its `file:line` reproduction, add only a safe isolated guard, and route remediation to the owning ticket at end of run.
