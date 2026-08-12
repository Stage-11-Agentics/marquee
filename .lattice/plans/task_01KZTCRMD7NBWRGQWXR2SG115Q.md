# MRQ-125: Shell truth: event name, branding, IA

Protects CFP-03 (w3), kills two judge defect lines. (1) Wire eventName from the API in the existing AppShell boot path (useIdentity/useSeat already fetch there) and make the prop REQUIRED — AppShell({eventName = 'AIE NYC 2026'}) is never passed anywhere; the default is the only value that exists; MRQ-101 rebuilt the breadcrumb structure but not the name source. Same fix in DeliveryHealthShell.tsx:21. (2) Reconcile ALL FIVE stale brand strings (landing footer 'Built for AIE NYC 2026' + hero note are hardcoded on the run's highest-traffic page; seeded form name '2026 CFP' collides with conference-year vocabulary — rename to 'Call for Speakers'). (3) Add 'AIE NYC 2026' as a forbidden literal outside seed/fixtures in scripts/checks/ so it cannot grow back. Human lens: an organizer who renames their conference and watches the old name persist concludes the save silently failed — the run-1 judge recorded exactly that as 'a stale cached label bug'. Full spec: section T-N1. Register rows 46,48.

## Plan

### Scope and ownership

- Protect CFP-03 (w3) and the T-N1 shell-truth acceptance surface. Do not touch T-N2's public submit path, the Section 4-owned `EvaluationPage.tsx`, `ReviewerPage.tsx`, uploads handlers, attachment SQL, `PublicAgendaPage.tsx`, or contract documents.
- Work only in the linked worktree `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-125-shell-truth`; the primary checkout remains the Lattice board home.

### Implementation

1. Extend the authenticated `/api/v1/auth/me` response with the demo event's current name and consume that response in the existing shell boot path. Add a small shared event-name hook/cache so the root renders both shells with an explicit required `eventName` prop; use a non-event loading label while the API is pending and never a conference-specific default. Publish the saved name from Conference settings so the shell updates in the same SPA session as well as after a fresh boot. Make `AppShell` and `DeliveryHealthShell` props required so a future caller cannot silently reintroduce the stale default.
2. Make all landing brand copy derive from the live `LandingData.conferenceName` (including the hero note and footer) and replace missing/error fallback names with neutral copy. Rename the seeded form from `2026 CFP` to `Call for Speakers` without changing the form's stable identity or public slug.
3. Add a focused `scripts/checks` guard for the forbidden stale literal `AIE NYC 2026`, allowing only deliberate seed/fixture paths. Register it as an npm check and run it in `pr-gate`, so a new production/source occurrence fails before review. Add contract tests for the required prop/API wiring, dynamic landing copy, seed vocabulary, and the guard's allowlist/violation behavior where the existing test shape supports it.

### Verification

- Self-review the plan and implementation against T-N1, register rows 46/48, Section 1 (YAML rubric, 70-turn discoverability, honest labels, no jumping), and Section 4 ownership rules.
- Run only targeted Vitest/Node tests covering touched files during implementation. Before the gate, inspect `uptime`; if one-minute load exceeds 24, wait 2–3 minutes and retry.
- Run `npm run pr-gate -- --ticket MRQ-125`, capture its complete pass output, then create the GitHub PR against `github/main`. Attach the PR reference and end Lattice at `pr_open`; do not merge, deploy, or claim live proof.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Self-review: PASS. The plan names the API source, both required shell call sites, all five stale literals, the seed vocabulary change, the check's allowlist, targeted validation, load-aware gate, PR evidence, and the explicit T-N2/Section 4 non-goals. No untriaged findings.
