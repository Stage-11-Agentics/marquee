# MRQ-161: The OpenAPI concurrency test's docstring tells a history that never happened

tests/integration/api/meta.test.ts:149-150 carries a docstring that is factually wrong about this repo's own history, in a repo that is public:

  * The document used to state that mutations carry `ETag`/`If-Match` optimistic
  * concurrency; two of two hundred did.

It did not state that at the base of the PR that added this comment. MRQ-146 had already narrowed the sentence to 'Strong `ETag`/`If-Match` optimistic concurrency currently applies only to the two agenda item mutation operations that require it' (commit 5441cf1c). The overclaim the comment describes was fixed one ticket earlier; the PR that wrote this comment was rewriting an already-correct sentence.

This is small, but it is the specific failure mode CLAUDE.md's skill-writing rule names — a comment that rationalizes the present against a past the reader has no way to check, and that in this case did not happen. Someone reading the test to understand why the assertion is shaped that way is told a false story about the codebase.

Acceptance criteria:
1. The docstring describes what the test guards NOW — that info.description's concurrency claim is held to the route table — with no narrative about what the document 'used to' say.
2. No other comment introduced by the same change carries the same false history; check the surrounding block.
3. No assertion changes. This is comment-only; the contract the test enforces is correct and recently strengthened by PR #158.

Files: tests/integration/api/meta.test.ts (:145-155).

Provenance: finding 6 of the 8-finding post-merge review on MRQ-150.
