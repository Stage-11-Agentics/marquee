# MRQ-154: V2-5: submitting a proposal gives you a seat that shows it

Source: .briefs/eval-gap-v2-human-lens.md section 4, authored by Fable (Eval V2 Audit, surface:55). Operator-approved 2026-08-12. Read that section for the full human-problem framing before starting. (V2-5, ~45 min.)

HUMAN PROBLEM. A speaker submits, gets a confirmation and a portal link — and the portal politely tells them there is nothing there. Their first question is the one the product must answer: did you get my proposal, and where does it stand?

GOOD LOOKS LIKE. The portal resolves its event through participations as well as memberships, and lists the person's own submissions with status ('Submitted · awaiting review' — the vocabulary the decision flow already uses). NO new account machinery: the magic link IS the account. Say so on the confirmation ('this link is your sign-in').

CLOSES. CFP-05 (w3 fail — the largest single call-for-papers item, and call-for-papers is the biggest prize on the board at 55.9% of a 20-weight area). Hardens CFP-06's roundtrip.

COORDINATE WITH MRQ-150 (in progress). That ticket fixes the portal dead-end; this one extends its empty state into a real answer. SAME SURFACE — sequence after it, or brief the same agent. Do not run both blind in the same files.

VERIFY. Public form -> submit the fixture proposal -> follow the confirmation link -> the portal lists it with a status -> the organizer's list shows the same record intact.

## Dependency and scope

MRQ-150 / PR #136 (`portal-submitter`, reviewed at `831867b`) owns the participation-based
portal resolver, submitter snapshot, base submitter portal, and initial confirmation link. It is
currently conflicting against `main`. Do not edit its owned production files before the
orchestrator confirms its merge. After it lands, rebase this branch onto `github/main`; layer only
the CFP-05 delta onto that implementation.

## Plan

1. Read the existing decision-flow status vocabulary and make the submitted-state copy exactly
   `Submitted · awaiting review`, without changing accepted/rejected speaker treatment.
2. Add an independent `CONTRACT · MRQ-154` test file that defines the CFP-05 behavior: a
   submitter sees only their own proposal and its status, while the accepted-speaker portal
   remains on the established speaker path. It may fail before the #136 rebase because its
   dependency is intentionally absent from this branch.
3. Once #136 is merged, rebase on `github/main`, adjust only the submitter status/confirmation
   wording and the independent tests, then run focused tests and the full PR gate.
4. Run the real local browser flow: submit a demo fixture through the public form, follow its
   portal magic link, observe the named submission/status, then check the same record in the
   organizer submission list and an existing accepted speaker portal.

## Browser validation approval

Authorized by the task brief: use one c11 embedded-browser surface in the workspace's right pane
against a local Marquee dev server on an unused loopback port. Interact only with local demo
fixture data and the task's public-form, magic-link, portal, and organizer-list paths; do not use
external credentials or send consequential external requests.

## Non-goals

No new account or membership machinery; no widening of a submitter's query beyond their own
participations; no reviewer or organizer behavior change; no reimplementation of MRQ-150's
event-resolution or portal-seat mechanism.

## Reset 2026-08-12 by agent:mrq-154-submitter-seat
