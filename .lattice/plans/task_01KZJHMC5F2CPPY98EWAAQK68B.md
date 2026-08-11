# MRQ-51: Audit — reviewer event and track isolation

BUILDPLAN: A-9 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): Reviewer event+track isolation (**AC-214, AC-246**) — one helper on every reviewer route incl. export; out-of-scope ID probe.
Starts when (verbatim): **From CP-2** (M-16/M-17 landed).

AC-214 is a post-competition ID that carries an enforcement obligation anyway (EVALUATION §7): cross-event reviewer access is not inherited; reviewer scope is per event by construction. It is the one permission bug in this domain that leaks unpublished work. The probe: guess an out-of-scope submission ID as a reviewer → 403 with no metadata.

ACs: **AC-214, AC-246** (audit evidence)
Hours: 1
Workflow: fast-track
Shared files: none — audit artifact only.
Deps: M-16, M-17
## Audit plan

1. Establish the review surface from the generated API route manifest and the
   `Reviewer` route declarations, not from an assumed list. Inventory the
   queue (both context and round-specific forms), record, file metadata,
   export, evaluation write, comparison queue/write, and the round-one to
   round-two funnel added by MRQ-28. Trace the category-routing assignment
   writer added by MRQ-35 as a separate no-human-in-the-loop entry point.

2. Compare the four authority layers at their source and call sites: the
   MRQ-3 event-bound membership schema constraint, MRQ-18's centralized
   `authorizeReviewerScope` event/track/assignment query, MRQ-33's
   `reviewerCanBeAssignedToSubmission` pre-write guard, and MRQ-35's routing
   path. Specifically look for duplicate SQL or alternate committee,
   membership, round, and track joins whose event boundary or track
   intersection differs from the centralized helper. Record every finding as
   `file:line` plus a concrete request/database input; do not repair audited
   product code unless a fix is trivially safe and explicitly called out.

3. Exercise the runtime surfaces with adversarial fixtures. Use a positive
   in-event/in-track reviewer control first, then an out-of-event reviewer and
   an in-event/out-of-track reviewer. For every listed read surface assert a
   refusal and no evaluator-visible metadata; for evaluation and comparison
   writes snapshot relevant row counts before and after and assert they do not
   change on either denied input. Cover both rounds and the MRQ-35 automatic
   category-routing path, including its generated committee assignment rows.
   Keep the positive controls non-vacuous by asserting that the authorized
   control succeeds and writes/reads the expected row.

4. Add a machine guard under `tests/node/` modeled on the existing AST
   inventories. It will enumerate every reviewer-tagged route and its
   operation/path, assert the expected surface inventory and positive control,
   enumerate every `authorizeReviewerScope` call and reviewer assignment/
   evidence writer, and fail if a new reviewer route or write bypasses the
   shared authority path. Keep the guard public-safe and free of ticket,
   internal-host, or credential data.

5. Self-review the diff as an adversarial reviewer, run the focused runtime
   proof and Node guard, then run `npm run pr-gate -- --ticket MRQ-51`. Attach
   the review and validation evidence to Lattice, push the branch, open the
   Forgejo PR against `master`, transition only to `pr_open`, and report the
   final state to the Orchestrator.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- Verdict: PASS. The plan has a positive control and separately names the
  event, track, read, write, two-round, and automatic-routing dimensions; it
  does not assume that existing green tests prove the audit.
- The runtime inventory will treat every `Reviewer` operation in the
  generated manifest as a first-class surface, while following MRQ-28 and
  MRQ-35 into their non-`Reviewer` write paths when they can create reviewer
  assignments or evidence. Any route that is manifest-visible but not
  reviewer-reachable will be recorded as scanned and excluded with its reason.
- No product implementation change is authorized by this plan. Findings will
  be routed with exact source locations and concrete inputs; only the
  test-only machine guard and audit evidence may be committed here.
