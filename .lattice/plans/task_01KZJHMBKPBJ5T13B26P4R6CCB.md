# MRQ-45: Audit — mail containment and demo-safe suppression

## Objective

Independently verify the A-3 mail-containment claims against the shipped source and
runtime paths. This ticket owns an audit artifact and guard tests only; it does not
repair product code.

## Scope and non-goals

- Inspect the entire repository for Resend imports. The only importing module must
  be the outbound delivery consumer.
- Prove that the two sanctioned send_policy='always_live' write sites are the
  only live-policy writes. Inspect the existing count guard for exactness, then
  search for alternate routes through literals, variables, defaults, SQL, and
  helper calls.
- Enumerate the seven mail triggers and bulk decision mail, then drive every path
  in demo mode with an isolated test database/runtime. Assert zero live-delivery
  rows and the expected outbox behavior.
- Independently exercise the public-form confirmation exception and the smoke
  harness exception. Confirm the confirmation is addressed only to the request's
  typed address and retains its intentional fail-open absent/unset gate.
- Do not change production mail behavior, contract documents, seeded data, or
  unrelated tests. Do not create an AC claims file: this ticket owns no auto ACs.

## Execution and evidence

1. Record the clean baseline and exact branch/base relationship. Read the mail
   implementation, all trigger callers, schema/migrations, and existing
   tests/node/comms.AC-250.test.mjs guard.
2. Run whole-tree import and policy scans, including an inventory of every
   insertOutbox call and every live-policy representation. Report each result
   with file:line.
3. Run the existing guard and inspect its implementation, not just its green
   result. Add or tighten a fast tests/node static/runtime guard only if the
   audit exposes a recurrence risk that is not already machine-enforced.
4. Build deterministic demo-mode fixtures through the real trigger entry points.
   For each of the seven triggers and bulk, record the caller input, demo flag,
   live-delivery row count, and outbox row count. A passing assertion without
   these observed counts is insufficient.
5. Verify the two legal live paths with safe, non-networking harness inputs and
   ensure no other caller can reach a live policy.
6. Self-review the diff adversarially. Findings must state the exact
   file:line, concrete caller input, observed failure, and owning follow-up;
   clean areas must name their coverage and actual output. If a finding is
   discovered, add the smallest regression guard possible without fixing the
   audited product behavior.

## Deliverables and gates

- Audit findings/evidence in the ticket review artifact, with no secrets,
  credentials, real addresses, or internal-only details.
- Any required guard test and its direct test output.
- Explicit statement that tests/ac-claims/MRQ-45.json is intentionally absent
  because MRQ-45 owns no auto AC.
- Run npm run pr-gate -- --ticket MRQ-45, paste the result into the completion
  record, push the branch, open the Forgejo PR against master, attach its URL,
  and transition to pr_open.
- Before pr_open, attach a review artifact for the exact branch HEAD and a
  validation artifact. This audit has no browser/UI flow; validation is the
  deterministic trigger matrix and static whole-tree checks.

## Reset 2026-08-11 by agent:auditor-mrq-45
