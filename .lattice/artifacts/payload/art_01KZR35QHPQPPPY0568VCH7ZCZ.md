# Plan Review: MRQ-50 — Reviewer anonymity byte-scan audit

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. One major evidence-quality improvement (a positive control for the sentinel detector) should be folded in via the plan's own resolution-block mechanism before implementation; it does not require returning to `in_planning`.

### 2. Summary

Reviewed the MRQ-50 plan (A-8 audit track: byte-scan every reviewer-visible response and export for seeded identity strings, AC-64) against the live codebase. The plan is verifiably grounded: the 8 `Reviewer`-tagged routes it enumerates (queue, context queue, comparison-next, comparison write, record detail, file metadata, CSV export, evaluation write) match `src/routes/review.routes.ts` exactly; the export path it names (`/api/v1/events/{eventId}/rounds/{roundId}/export`, review.routes.ts:671) is the real M-17 route; the query-layer anonymization branch it guards (`round.anonymized ? null : identityForSubmission(...)`, review.routes.ts:619) exists; and `tests/ac-claims/`, `trace:ac`, and `pr-gate` conventions are all in place. The key concern is that all seeded rounds are blind, so a fully green scan cannot distinguish "no leak" from "broken harness" — the audit needs a positive control.

### 3. Issues

**[MAJOR] Plan §2 (fixture) — No positive control: a green scan cannot prove the detector works**
The fixture seeds only blind rounds (a blind scorecard round and a blind comparison round), and the audit asserts sentinel *absence* everywhere. If the fixture wiring is subtly broken — sentinels not persisted into the queried columns, the wrong submission driven, or a concealment 404 body returned where a 200 was expected — the scan passes vacuously and the audit evidence is worthless. The codebase offers a perfect control for free: `review.routes.ts:619` returns identity through the *same reviewer record route* when the round is not anonymized.
**Recommendation:** Add a non-anonymized round to the fixture and assert the byte-scan **does** find the seeded sentinels on that round's reviewer-visible responses (and ideally in its CSV export). This proves the sentinel pipeline and the scanner detect leaks when they exist, converting the blind-round green result into real evidence. Record it in the plan as a resolution block per the plan's own §Verification instruction.

**[MINOR] Plan §2 (scan mechanics) — Exact byte-sequence matching is fragile under JSON/CSV escaping**
The plan searches "exact sentinel byte sequences" in UTF-8 bodies. JSON string escaping (quotes, non-ASCII as `\uXXXX`) and CSV quoting (doubled quotes, quoted fields) can mutate a sentinel's byte representation, letting a real leak slip past an exact match — particularly for the bio-fragment and company sentinels if they contain punctuation.
**Recommendation:** Constrain sentinels to plain unique alphanumeric tokens (e.g., `SENTINEL-SPEAKER-NAME-7Q4X`) that survive JSON and CSV encoding byte-identically, and state that constraint in the fixture step so a future editor doesn't add a comma-bearing company name that silently evades the scan.

**[MINOR] Plan §1 (inventory scope) — Media-bytes route is silently outside the tag-driven inventory**
The inventory is derived from the `Reviewer` tag, which is correct and fail-closed for the reviewer API surface — but `/api/v1/media/{key}` (`uploads.routes.ts`, tagged `Uploads`) serves file bytes, and the reviewer file-metadata route hands reviewers the references to reach it. Headshot attachment references are explicitly on the sentinel list, so this adjacent surface is where a headshot leak would actually materialize. The tag-driven guard will never flag it.
**Recommendation:** Add one line of evidence to the audit artifact: either verify what the reviewer file-metadata response exposes (keys/URLs) and whether a `review:write` credential can fetch identity-bearing media, or record an explicit, reasoned scope exclusion (uploaded file *content* is author-controlled and not query-layer strippable). A deliberate documented boundary is fine; a silent one is not, for an audit ticket.

### 4. Positive Observations

- **The plan was written against the real codebase, not from memory.** Every load-bearing claim verified: route paths, the 8-route Reviewer inventory, the `anonymized` query-layer branch at review.routes.ts:619, the auth split (`grants: ["review:write"]` for reviewer routes vs `authenticated` for organizer evaluation routes — confirming the tag-based inventory matches the reviewer credential surface), and the existing `tests/node`, `tests/ac-claims`, `trace:ac`, and `pr-gate` conventions. The `mrq-50-audit-anon` branch named in the handoff already exists.
- **Manifest-driven, fail-closed coverage** (step 1: "name the difference rather than silently narrowing coverage") plus the AST inventory guard (step 3) is exactly the right shape for an audit that must survive future route additions — it converts "we scanned everything as of today" into a standing invariant.
- **Correct audit discipline throughout:** no product-code remediation, findings as `file:line` + reproduction, AC-246 exercised as overlap evidence but not claimed, and an honest N/A for browser validation with the reason stated.
- **The export is treated as first-class**, which is the exact half the task description warns gets forgotten — including scanning CSV bytes independently of JSON, and covering error bodies, concealment responses, and both round modes.
- Non-goals and handoff steps are crisp and match the fast-track workflow; scope fits a single implementation pass.
