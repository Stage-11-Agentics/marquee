# MRQ-24 implementation review — cycle 2

Reviewed commit: `2b02a4690f0a628b5a897a24ef249e5f14d52c53` (HEAD verified)
Base: `forgejo/master` at merge-base `df23e01`

## Verdict: FAIL

The mail seam, demo-safe idempotency, upload-policy wiring, route manifest, and AC claims are sound. The following findings must be resolved before PR:

- MAJOR `src/routes/onboarding.queries.ts:332`: severity sums done/upcoming state weights and omits days overdue, so caught-up work can outrank overdue work. Compute severity from owed tasks only, with maximum days overdue as the primary sort key and risk as the tie-breaker; add an AC-92 ordering test.
- MAJOR `src/ui/onboarding/OnboardingPage.tsx:156`: unioning `person_ids` and `submission_ids` cross-multiplies co-speaker selections. Add an additive exact recipient-pair selector and test one outbox row per selected pair.
- MINOR `src/ui/onboarding/OnboardingPage.tsx:254`: filtered empty results claim every accepted speaker is clear. Use a filter-specific empty state when active filters explain the empty result.
- MINOR `src/ui/onboarding/OnboardingPage.tsx:163-176`: compose drawer omits the binding demo-safe outbox/no-delivery banner.
- MINOR `src/routes/portal.routes.ts:310`: raw template accepts can advertise formats that the server policy rejects. Expose the shared policy's effective extensions to the client.
- MINOR `src/ui/onboarding/OnboardingPage.tsx:243-248`: metric tiles are static divs and the toolbar omits the specified shown/selected summary, track column, wave/session metadata, and binding head copy. Make the tiles actionable and restore these bound elements.

The row-drop behavior for speakers with no owed work is intentional per the plan's AC-265 resolution. The cross-event preview lookup and recurring-reminder identity are pre-existing/sanctioned follow-ups, not blockers for this ticket.
