# MRQ-244 — First-week truth

- Ticket: MRQ-244
- Actor: agent:delegator-mrq-244
- Branch: mrq-244-truth
- Base: github/main at e24e68e843a476c4d9f824e3083edf9ef16cebda
- Status: bounded implementation plan; stable US/AC IDs and claims manifest are intentionally not minted.

## Outcome

Make the first week truthful in the existing operator surfaces: setup state survives reloads without becoming a persisted checklist, empty states name the real next action, the Getting started footer is always reachable through an honest repository-URL seam, and demo reset is visible only for a real demo event.

## Draft acceptance scope (unnumbered)

1. Implement the compact setup-state representation at the existing setup persistence seam. It must remain stable across reloads and compact when the program is in motion, without adding checklist state, a capability map, a tour, or coachmarks. Preserve the fixed-height/no-jump behavior through runtime evidence.
2. Onboarding must distinguish zero accepted submissions from a genuine all-clear. Zero accepted submissions keeps the truthful onboarding CTA to open submissions; all-clear is available only after at least one accepted submission and no remaining setup work.
3. Agenda and communications empty states must expose live next actions: agenda points to the unfiltered submissions path when no agenda can exist yet, and communications names the missing recipient/submission prerequisite with an actionable submissions path.
4. Add the Getting started footer link through a small obvious repository-URL seam. This branch uses the honest repository fallback now; after MRQ-243 lands, rebase and switch/verify the served local Getting Started URL if it is available. Do not couple to MRQ-243.
5. Show reset-demo only when the authenticated event carries a non-null demo-event identity, using the same runtime signal as ServerPanel. Do not infer demo mode from labels or allowlisted names.

## Implementation boundaries

- Reuse existing data, auth, navigation, and styling seams; avoid parallel persistence or event-specific speaker models.
- Do not add a capability map, tour, coachmarks, or persisted checklist state.
- Do not use source-text assertions or allowlists as proof for runtime behavior.
- Do not fold the contract, mint stable US/AC numbers, or publish a claims manifest. After implementation and handoff, request CONSOLIDATION RESUME.
- Browser/computer-use, screenshot, fresh-instance E2E, deploy, live-site writes, and publication remain held pending explicit operator approval.
- Workers stop at pr_open; never merge or deploy.

## Verification

Targeted hermetic tests will cover the state transitions, truthful copy/actions, repository fallback seam, demo-event gate, and the fixed-height/no-jump behavior through a real rendered/runtime path where the existing test harness permits it. Local Worker/curl checks are allowed.

The pending browser validation flow, to run only after explicit approval, is: start the local Worker; create or select a fresh non-demo event with zero accepted submissions; verify onboarding, agenda, and communications next actions; accept one submission and verify the onboarding transition and compact setup state; reload and verify persistence/no jump; inspect the footer fallback URL; verify reset-demo is absent for a non-demo event and present for a demo event; then, after MRQ-243 lands, repeat the footer check against the served /docs/GETTING-STARTED.md URL. Capture screenshots and fresh-instance E2E evidence only in that approved validation pass.

Before any full pr-gate or full suite, request the serialized slot from mailbox merge-captain. When ready, ask the Adoption Orchestrator for its sole reviewer slot and report completion or recoverable blockers to workspace:10 surface:513 (mailbox adoption-orchestrator). The branch handoff is the PR-open boundary.
