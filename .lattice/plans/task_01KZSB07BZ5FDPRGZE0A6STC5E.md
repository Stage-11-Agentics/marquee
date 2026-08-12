# MRQ-85: Verify: terminal-negative records no longer inherit the Waved pipeline stage

Pass B saw a **Rejected** record and a **Withdrawn** record both render a top-right pipeline-stage pill reading **"Waved"** while their status badge correctly read Rejected/Withdrawn. Evidence: `sequence/UX-SWEEP-FINDINGS-PASSB.md` (Flows 2–3, and the root-cause clarification at ~line 304).

## The precise claim

"Waved" is a real pipeline stage (stage 3 in the left nav: Submitted → In review → **Waved** → Accepted). Pass B confirmed at the API layer that a freshly-waitlisted record returned `"status": "waitlisted"`, `"stage": "waved"` — two distinct, correctly-populated fields. The bug is narrower than "defaults to Waved": **Rejected/Withdrawn records incorrectly inherited that same waved stage.**

## Why this is a verify-first ticket

MRQ-76 ("unify pipeline stage derivation", PR #17) landed *after* the checkout Pass B tested against, and its whole subject is this derivation. This ticket may already be closed by that merge. Verify against current `main` — read the derivation and confirm empirically against a running app — before writing any code. Do not manufacture a change.

## Constraints

- Do not re-break MRQ-76 (unified derivation) or MRQ-83 (decision buttons restored on declined/waitlisted/withdrawn records). If a fix here would touch `BOARD_STAGE_SQL` in a way that risks either, stop and report rather than proceed.
- Test titles must begin `AC-<n> · ` or `CONTRACT · ` or `trace:ac` fails.

## Verification

`GET /submissions/:id` on a rejected record and on a withdrawn record: `stage` must not be `waved`. Confirm the rendered stage pill in a browser, not only the API.
