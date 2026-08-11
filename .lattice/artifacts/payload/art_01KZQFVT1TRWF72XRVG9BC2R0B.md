# MRQ-18 inline self-review (final rebased head)

Reviewed commit: 312afb8a770bc5f33c8b4a9a1890060a9831f981
Base: forgejo/master @ f83de445392700f8721bcdbccb3b30c345856e00
Verdict: PASS
Review mode: inline self-review; headless code review is suspended by the ticket directive.

Findings: none.

Scope checked:

- `src/routes/review.routes.ts` is a `*.routes.ts` manifest module; queue, context, detail, files, export, and evaluation-write all use the centralized `authorizeReviewerScope` helper before evaluator-visible reads or writes.
- Blind detail projection excludes identity-bearing form keys in SQL, returns no identity object while anonymized, and exposes only safe file metadata. Out-of-scope failures use the generic 403 body without resource metadata.
- Approve/Maybe/Deny persists nullable score and criteria values, records reviewer actor/time, maps to a decision proposal, and leaves submission lifecycle unchanged.
- The reviewer page uses only reviewer-scoped APIs, has no admin shell, preserves queue item/index on detail close, supports keyboard recommendation/score/save interactions, and guards focused controls from the global save handler.
- Existing evaluation/admin routes and guardrail tests remain intact; the committee event-boundary predicate is tightened without introducing a second authorization path.
- No contract documents, migrations, secrets, or unrelated paths changed.

Evidence already run at this head:

- Reviewer integration: 7/7 tests passed before the final base rebase.
- Reviewer surface contract: 1/1 test passed before the final base rebase.
- Worker/client/test TypeScript checks passed.
- `npm run check:api` passed with 41 manifest/OpenAPI operations.
- `npm ci` was rerun after the final base rebase; validation and the full gate are required at this exact head before PR creation.
