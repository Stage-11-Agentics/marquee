# Plan Review: MRQ-45 — Mail containment audit

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The issues below are precision fixes the auditor should absorb into execution; none require returning to `in_planning`.

## 2. Summary

Reviewed the MRQ-45 plan (audit of A-3 mail containment: Resend isolation, exactly two `always_live` write sites, demo-mode suppression of seven triggers + bulk) against the shipped source. The plan is unusually strong for an audit ticket — it treats the existing guard as an audit subject rather than evidence, demands observed counts over green checkmarks, and correctly refuses to repair product code. The key concern is definitional: the codebase contains **no Resend SDK import at all** — the consumer reaches Resend via raw `fetch("https://api.resend.com...")` (`src/jobs/mail/consumer.ts:75`) — so an audit executed literally as an "import scan" would pass vacuously while missing the actual containment surface.

## 3. Issues

**[MAJOR] Scope and non-goals / Execution step 2 — "Resend imports" is the wrong scan predicate**
The plan's first scope bullet says "Inspect the entire repository for Resend imports. The only importing module must be the consumer." No module imports a Resend package; there is no SDK dependency. The real containment surface is (a) `fetch` calls targeting `api.resend.com` (`src/jobs/mail/consumer.ts:75`), (b) reads of `RESEND_API_KEY` (`consumer.ts:97–100`), and (c) the `RESEND_API_KEY` declaration in the Env type at `src/index.ts:26`. A literal import scan reports zero hits everywhere and proves nothing. The existing guard already knows this — `tests/node/comms.AC-250.test.mjs` asserts `doesNotMatch(/fetch\("https:\/\/api\.resend\.com/)` on the comms route, not an import check.
**Recommendation:** Redefine the containment predicate in the plan as: no file outside `src/jobs/mail/consumer.ts` may (1) reference `api.resend.com`, (2) read `RESEND_API_KEY` at runtime, or (3) import any Resend client. Explicitly classify the `src/index.ts:26` Env-type declaration as a non-violation (type surface, not a capability), and record that ruling in the audit artifact so a future auditor doesn't re-litigate it.

**[MINOR] Execution step 5 — the smoke harness is still a stub; define what "verify live site 2" means**
`smoke:mail` and `smoke:ics` are stub scripts owned by MRQ-24 (`package.json:18–19` → `scripts/checks/stub-command.mjs`). `enqueueSmokeHarnessMail` (`src/jobs/mail/outbox.ts:133`) currently has **zero production callers** — its only caller is `tests/integration/mail.test.ts:351`. Step 5's "verify the two legal live paths with safe, non-networking harness inputs" is well-defined for the public-form path (`src/routes/public-form.routes.ts:470`) but ambiguous for the harness path; a literal reading could stall the auditor or produce a spurious finding against MRQ-24's unfinished work.
**Recommendation:** State explicitly: while MRQ-24 is unlanded, live site 2 is verified by (a) confirming `enqueueSmokeHarnessMail`'s production caller set is empty, and (b) exercising the wrapper directly with non-networking inputs. An unimplemented harness is expected state, not a finding.

**[MINOR] Scope — "exactly two write sites" needs an explicit production/test boundary ruling**
Beyond the two wrappers at `src/jobs/mail/outbox.ts:129,134`, `always_live` appears as a raw-SQL insert in `scripts/schema-verify.mjs:406` and in test fixtures (`tests/integration/mail.test.ts`, `tests/integration/api/public-form.AC-25-42-155-157-231-234.test.ts:189`). The plan's alternate-route search (literals, variables, SQL, helpers) will surface these, but doesn't say how to classify them — risking either a false finding on verification fixtures or, worse, a blanket "tests don't count" rule that would excuse a script that actually enqueues live mail.
**Recommendation:** Add the classification rule to the plan: any code path that can insert a row reaching the real outbox/consumer counts as a write site regardless of directory; occurrences that exist only inside isolated test databases or verification fixtures are inventoried and classified as non-sites, each with file:line and rationale.

**[MINOR] Execution step 4 — anchor "the seven triggers" to an authoritative list**
The plan enumerates "the seven mail triggers and bulk decision mail" without naming the source of the seven. The trigger surface in `src/jobs/mail/triggers.ts` (`enqueueTrigger`, `enqueueBulkReminder`, `enqueuePreCloseReminderRows`/`enqueuePreCloseReminders`) doesn't self-evidently decompose into seven; the auditor could assemble a plausible-but-wrong set and the matrix would prove the wrong claim.
**Recommendation:** Cite the authoritative enumeration (BUILDPLAN §5 / B-8 or the SPEC's trigger register) in the audit artifact, list the seven by template key/caller, and cross-check that every `MailTemplateKey` and every `enqueueOutbox` caller maps into the matrix — any unmapped caller is itself a finding.

## 4. Positive Observations

- **The guard is treated as an audit subject, not as evidence.** Step 3's "inspect its implementation, not just its green result" is exactly right: the existing count in `comms.AC-250.test.mjs:14` is a brittle textual regex (`insertOutbox\(input, \"always_live\"\)` × 2) that a variable-policy or reformatted call would slip past — and the plan's alternate-route search (literals, variables, defaults, SQL, helper calls) is aimed precisely at that gap.
- **Evidence discipline is explicit.** "A passing assertion without these observed counts is insufficient" (step 4) and the file:line + concrete-input + observed-failure format for findings make the artifact independently checkable — the right bar for an auditor who didn't write the code.
- **Scope restraint matches the ticket contract.** No product-code repairs, no contract-document edits, smallest-possible regression guard only on demonstrated recurrence risk, and the explicit statement that `tests/ac-claims/MRQ-45.json` is intentionally absent — all faithful to "audit artifact only."
- **The gate sequence is correct and complete.** pr-gate invocation (verified present at `package.json:22`), review + validation artifacts pinned to the exact branch HEAD before `pr_open`, and a sensible substitution of the deterministic trigger matrix for browser validation.
- **Public-repo hygiene is called out** (no secrets, no real addresses in the artifact) — which matters here since the repo ships open source and the audit touches API-key handling.
