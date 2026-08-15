# MRQ-210 — Server panel

## Outcome

Deliver the binding `org/server` surface in the Marquee application: plain organizer-language connection rows, real binding-derived state, a named Resend sender/account with an external link, and the prototype's recovery card. Preserve the existing setup-dashboard Instance panel behavior while renaming/extending every rendered instance of the panel.

## Contract and scope

- Binding design: `sequence/org-settings-design.md` iteration 3, `DESIGN.md`, `PHILOSOPHY.md`, and the served prototype at `http://127.0.0.1:8123/pipeline-v1.1/index.html?v=15#org/server`.
- Rows lead with Email sending, File uploads, Spam protection, and Web address; providers are secondary; chips say `working` or `not set up`.
- Mail identity comes from real configuration/bindings, never a stored status flag or invented account name; keep `GET /api/v1/instance/status` authoritative and extend its response only as needed.
- Mount under the org-settings surface/`org/server` when MRQ-207 is present at integration; otherwise keep a truthful local route and document the integration handoff. Redirect legacy `org/instance` where the current route seam allows.
- Include the prototype recovery copy and an honest outbound `Open Resend ↗` link.
- Do not alter sibling worktrees, mint tickets, invent a new status system, or broaden into unrelated organization-settings tabs.

## Execution

1. Baseline the exact branch and relevant tests; inspect the existing setup panel, status endpoint, route seams, and current MRQ-207 integration state.
2. Implement the panel/route/API response using canonical helpers and existing design tokens. Keep status derivation binding-based and add regression coverage that rejects a stored-flag shortcut.
3. Run focused tests, typecheck/build/design/API checks, then the serialized PR gate as required by the repository guidance. Commit meaningful units and push the branch.
4. Review the exact diff against `github/main`, open the GitHub PR, and record the PR URL/SHA.
5. Run local running-system validation with the real browser flow through the server tab and recovery/link affordances; attach validation evidence to MRQ-210 before moving to `pr_open`.
6. Report the final status, commit, PR, tests, and browser evidence to the parent at `workspace:6` / `surface:256`; do not merge the PR from this worktree.

## Status ledger

- Design/prototype: inspected and recorded before implementation.
- Implementation: pending.
- Review/PR: pending.
- Browser validation: pending; scope is the local Marquee dev app only, with no credentials or external mutations.
