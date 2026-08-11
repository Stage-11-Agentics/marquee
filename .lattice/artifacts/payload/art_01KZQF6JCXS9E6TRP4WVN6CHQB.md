# MRQ-18 inline self-review (final rebased head)

Reviewed commit: d695e05f2af6b6de780c09a20ad1f10f7df07e07
Base: forgejo/master @ 750ee7260ad02f021a23a59874ce3fc64de74737
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

- Reviewer integration: 7/7 tests passed.
- Reviewer surface contract: 1/1 test passed.
- Worker/client/test TypeScript checks passed.
- `npm run check:api` passed with 41 manifest/OpenAPI operations.
- `npm test` passed on the pre-rebase implementation; the post-rebase full gate is required before PR creation.
