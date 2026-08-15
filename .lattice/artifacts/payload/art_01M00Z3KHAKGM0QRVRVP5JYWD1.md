# Plan Review: MRQ-210 — Server panel

## 1. Verdict

**PASS** — Plan is complete enough, feasible, and aligned. Implementation can proceed, with one major sourcing question the implementer must resolve explicitly at step 1 (see Issues).

## 2. Summary

Reviewed the MRQ-210 plan against the task description, the ruling in `sequence/org-settings-design.md` (the "Instance" → "Server" section and the "mail identity per-org" note), the binding prototype's `#org/server` view, and the current code (`src/ui/setup/InstancePanel.tsx`, `src/routes/instance.routes.ts`, `src/lib/instance-status.ts`). The plan is tight, correctly scoped, and encodes the project's honesty invariant (status derived from bindings, never a stored flag — AC-284 is already in the code's comments). The one real gap: the plan restates *that* the Resend sender and account must come from real config, but not *where* they will come from — and in this codebase the sender is a hardcoded constant in the mail consumer and the account name exists nowhere at all, so this is a decision the plan defers rather than makes.

## 3. Issues

**[MAJOR] Contract and scope / Execution step 2 — Mail identity sourcing is undetermined, and the codebase has no source for it today**
The task requires the mail row to name "the connected Resend sender and account (derived from real config, never a stored flag)." The prototype shows `sending as marquee@stage11.systems · account stage11-agentics`. But today: the sender is the hardcoded constant `MAIL_FROM = "Marquee <marquee@stage11.systems>"` at `src/jobs/mail/consumer.ts:9` (not env-derived, and not visible to the status route), and **no account/team name exists anywhere in config or code**. `src/lib/instance-status.ts` only checks `RESEND_API_KEY` presence. The plan's phrase "extend its response only as needed" hides the actual design fork: (a) share the sender constant, or (b) call the Resend API live per status read — which trades against R7 (speed) and the endpoint's `no-store` honest-read design — or (c) add an env var for the account name, which is "real config" under the ruling but must not decay into a stored flag proxy for configured-ness.
**Recommendation:** Decide in the plan (or as the explicit first output of step 1): extract `MAIL_FROM` into a shared module that both the queue consumer and `readInstanceStatus` import, so the panel can never drift from what mail actually sends as; source the account name from configuration (e.g., a `RESEND_ACCOUNT` var used for display only) or from a Resend API lookup with a stated latency budget — and state which, and why. The key invariant to preserve: `configured` continues to derive from binding presence only; the identity strings are labels, never the truth signal.

**[MINOR] Execution — No file inventory**
The checklist asks which files will be created or modified; the plan names none. The blast radius is knowable now: `src/ui/setup/InstancePanel.tsx` (rename + rows + recovery card + link), `src/ui/dashboard/DashboardPage.tsx:85` (the only current render site), `src/routes/instance.routes.ts` + `src/lib/instance-status.ts` (response extension), a new steady-state route/mount, plus tests. Note also that `src/ui/forms/FormsPage.tsx` consumes `instance/status` — verify whether it renders the panel or merely reads the endpoint, since "applies everywhere the panel renders" must not silently break a non-panel consumer of an extended response.
**Recommendation:** Fold this inventory into step 1's output so the diff review in step 4 has a checklist to verify against.

**[MINOR] Contract and scope — MRQ-207 fallback should be named, not just conditioned**
MRQ-207 is currently `backlog` (not even in progress), so the fallback branch — own route, documented in the PR — is the near-certain path, not the edge case. The plan treats both branches symmetrically.
**Recommendation:** Name the fallback route now (and the redirect intent for `org/instance` when 207 later mounts it), so the PR statement and the eventual 207 integration have a concrete handle rather than "a truthful local route."

**[MINOR] Contract and scope — Prototype reference depends on a locally served URL**
The binding reference is given as `http://127.0.0.1:8123/pipeline-v1.1/index.html?v=15#org/server`, which assumes a server another agent may have started. The file itself (`prototypes/pipeline-v1.1/index.html`, the `orgServer` view around lines 2402 and 2707) is the durable reference.
**Recommendation:** Cite the file path as the binding artifact; serve it yourself if the port is dark.

## 4. Positive Observations

- **The honesty invariant is internalized, and armed.** The plan doesn't just avoid a stored status flag — it plans regression coverage that *rejects* the stored-flag shortcut. That converts the project's hardest-won rule (the AC-284 comment in `instance.routes.ts` explains exactly why) into a test that outlives this ticket.
- **The MRQ-207 dependency is handled the right way**: a conditional integration with a truthful fallback and a documented handoff, rather than a hard dependency or a race. This matches the task's own instruction precisely.
- **Scope fencing is explicit and correct** — no sibling worktrees, no ticket minting, no new status system, no drift into other org-settings tabs. Given 207/209/211/212 are all live or queued around the same surface, that fence matters.
- **The validation ladder is complete**: focused tests → serialized gate → diff review against `github/main` → real-browser walkthrough with evidence attached before `pr_open`, and no self-merge from the worktree. This is the full loop the project's norms ask for, in the right order.
