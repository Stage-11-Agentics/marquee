# MRQ-50: Audit — reviewer anonymity byte-scan

BUILDPLAN: A-8 — audit track (§5). **Owned by an auditor who did not write the code.**

## Contract and scope

Scope (verbatim): anonymity scan — byte-scan every reviewer-visible response and export for seeded identity strings. AC-64 is the owned auto criterion; AC-246 is exercised where this audit overlaps the reviewer route surface. The audit must not change product code: any leak is reported with the owning file/line and a concrete request/response reproduction.

The export is a first-class surface: `GET /api/v1/events/{eventId}/rounds/{roundId}/export?format=csv`. Identity-bearing seed values include submitter and speaker name, person ID, email, title/company/affiliation, bio fragments, headshot attachment references, and any organization/affiliation sentinel that could identify authorship. Error bodies, 403/404 concealment, comparison mode, both rounds, and every reviewer-scoped response are in scope.

## Authoritative plan

1. Establish the exact post-M-17 baseline and enumerate the generated API manifest at runtime. Select every entry whose route metadata is tagged `Reviewer`; do not hand-pick the surface from memory. The expected inventory is the queue/context queue, comparison-next, comparison write, record detail, file metadata, CSV export, and evaluation write operations. If the manifest differs, the test must name the difference rather than silently narrowing coverage.

2. Add a Cloudflare integration audit fixture with a reviewer, a blind scorecard round, a blind comparison round, authorized and out-of-scope submissions, and submitter plus multiple-speaker rows carrying unique identity sentinels in every relevant column. Query those related people/attachments from the fixture so the scan set follows seeded relationships. Drive every manifest entry with a successful request, including both rounds and the CSV export; also drive representative unauthenticated, out-of-scope, unknown-round/record, malformed, and wrong-mode requests. Read each body as UTF-8 bytes and search exact sentinel byte sequences, recording method, path, status, content type, and the first matching string on failure.

3. Add a `tests/node` TypeScript-AST inventory guard over every `.ts`/`.tsx` file under `src/`. It will discover reviewer-tagged `defineApiRoute` definitions structurally, assert that the complete manifest inventory is represented, and assert the reviewer identity query helper remains behind the anonymized-round branch. The guard must fail closed when a future route/helper is added without being included in the audit inventory; it must not rely on a regex over one file.

4. Record findings as evidence, not opinions: each hit gets the owning `file:line`, the exact request a reviewer makes, the response status/content type, and the identity string returned. Do not remediate audited product code. Add `tests/ac-claims/MRQ-50.json` owning AC-64, with the runtime audit test carrying the criterion title.

5. Self-review the changed test/guard and evidence for dead-feature coverage: confirm every route is discovered from the manifest, every route response/export is actually requested, all error bodies are scanned, the CSV bytes are scanned independently of JSON, and the fixture contains submitter/speaker/org/company/email/bio/headshot sentinels. Run the targeted audit, `npm test`, `npm run trace:ac -- --ticket MRQ-50`, and the required `npm run pr-gate -- --ticket MRQ-50`. Commit and push each meaningful change; open the Forgejo PR only after the gate and validation evidence are recorded, then stop at `pr_open`.

## Non-goals

- No production identity-query or view-layer fix in this audit ticket.
- No contract-document edits or new AC IDs.
- No claims for auto criteria owned by another ticket; AC-246 is exercised only as overlap evidence.

## Verification and handoff

- Baseline observed before edits: `npm test` passed (16 files, 72 tests; integration 32 files, 180 tests).
- Plan review: self-review this plan after the `planned` transition; append any resolution block before implementation if it exposes a coverage gap.
- Runtime validation: the audit test is the evidence; record an explicit N/A only for browser-only validation because this ticket changes no UI and the reviewer API is exercised through the Worker test runtime.
- Final handoff: paste the local `pr-gate` result in the Lattice review comment, attach review and validation artifacts, push `mrq-50-audit-anon`, create the PR against `master`, attach its URL, and transition MRQ-50 to `pr_open`.
