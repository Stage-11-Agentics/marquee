# MRQ-155: V2-6: publication is a status the organizer can set, and unset

Source: .briefs/eval-gap-v2-human-lens.md section 4, authored by Fable (Eval V2 Audit, surface:55). Operator-approved 2026-08-12. Read that section for the full human-problem framing before starting. (V2-6, ~45 min.)

HUMAN PROBLEM. Publishing is batch-only and one-way. When a speaker cancels the night before the site goes out, there is no way to pull that one session off the public agenda.

GOOD LOOKS LIKE. The submission record's slot panel — where 'Live on the public site' already reads — becomes a control: Publish / Unpublish this session, with the same confirmation gravity the batch flow has. The API gains the is_published = 0 transition, audited, like the reversal path. Public output already gates on the flag, so there is NO public-side work.

CLOSES. CNT-12 (w3 cannot_judge — MANDATORY for 100%: a cannot_judge is excluded from the denominator, so it costs nothing today but makes a perfect score unreachable while it stands). Also serves the EMB precondition step ('set every scheduled session content status to Approved') with a real control.

VERIFY. Unpublish a published session -> gone from the /site agenda on reload. Publish it back -> it returns.

## Build plan

1. Extend the canonical submission-record publication API with an audited `unpublish` transition. Keep the dual `submissions.is_published` and `agenda_items.is_published` flags coherent, advance both `updated_at` values, and guard the write against the versions read for the record.
2. Make the record slot panel the single-session publication control. Expose server-authorized publish/unpublish actions, use explicit inline confirmation copy for both directions, reserve the chip/action footprint, and remove the duplicate publish-only card.
3. Add contract coverage for both API transitions, audit attribution/payloads, the public agenda/session exclusion, and republish restoration; add static UI/API assertions for the control copy and fixed layout.
4. Run focused integration/unit checks, then `node scripts/checks/pr-gate.mjs`. Start a distinct local Worker, drive the organizer record in the right-pane c11 browser, and record observed publish → public, unpublish → absent, and republish → public evidence.
5. Commit with `MRQ-155` in the message, push `v2-6-publish-control` to `github`, open a PR titled `MRQ-155: ...`, attach validation evidence, and report the PR/gate to the Eval Fix Orchestrator surface. Do not merge.
