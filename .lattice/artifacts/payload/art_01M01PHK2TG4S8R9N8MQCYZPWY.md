MERGED as 1cce684a (PR #274, squash). CI fast-gate green; board home fast-forwarded to the merge commit and the working copy verified (sponsor-portal.routes.ts, migrations/0023_sponsors.sql, SPEC Amendment 23 all present).

WHAT SHIPPED
The sponsor portal at /sponsor-portal, reproducing the loved prototype: head with an N-of-M deliverables meter, sponsorship hero with a DERIVED deal line, booth card when there is a booth, deliverables with per-row assignee and attribution, read-only Session cards, org-level company profile with the contact roster, and a sponsor handbook whose load-in chapter appears only for a sponsorship that has a booth.

Plus the minimal data layer it needed to be a page rather than a mock: companies (org-scoped), sponsor_tiers and sponsorships (event-scoped, booth as columns), sponsorship_contacts, the deliverables join on speaker_tasks, the Sessions join on submissions, and speaker_tasks.completed_by_person_id — the attribution field the ticket anticipated, now SPEC Amendment 23.

THE THREE RULINGS, MADE LITERAL
- Whole sponsorship, anyone completes, attribution recorded. Proven in a browser: signed in as Dana, completed the deliverable assigned to Priya, and the row reads 'completed by Dana Okafor' with the assignee unchanged.
- The hero is the sponsorship, and its deal line is computed from what is attached — never a per-tier blurb.
- Sessions are read-only; the task machinery is the single write path. Completing 'Name your speaker' creates the person, the participation, and — through the same reconcileTaskSet the acceptance boundary runs — their membership and onboarding task set, so the promise printed on the task is literally true (verified: 1 membership, 1 participation, 2 tasks).

KEY DECISIONS a later ticket inherits
- Two routes added; TWO WIDENED, not duplicated: /me/tasks/{id}/complete and /me/uploads/sign both resolve through the speaker predicate OR the sponsorship-contact predicate from ONE shared function, because two near-identical predicates would give a contact a file deliverable that opens, validates, then fails at the PUT.
- The task projection and the whole task-row UI are EXTRACTED (portal-tasks.queries.ts, task-machinery.tsx), not copied.
- The completion UPDATE is scoped to the task's assignee rather than the caller — inert for a speaker, the point for a sponsor.
- No task_templates.sponsor_tier_id and no companies.logo_attachment_id: tier template sets and logo uploads belong to the organizer surface that authors them.
- No unique constraint on companies(org_id, name): right shape, but a hard constraint without a merge affordance turns a rename into an error the organizer cannot resolve.

FOUR DEFECTS FOUND RATHER THAN SHIPPED
1. (review, BLOCKING) Event deletion would have 500'd the moment a sponsor existed — deleteEventCascade had never been taught these tables, which does not fail loudly but makes the conference UNDELETABLE and takes remove-demo with it. Fixed; two integration tests now delete a conference holding a sponsorship, and I proved the test bites by reverting the fix and watching FOREIGN KEY constraint failed.
2. (review, BLOCKING) Cross-tenant leak: organizerContactFor bound only eventId, so an org-wide staff membership in ANY organization could be printed on the page and in the handbook as 'your organizer'. Now organization-scoped.
3. (tests) A deliverable's accept list was a lie — 'vector (SVG or EPS)' against an upload policy that sniffs pdf/pptx/key only. Now states what the product can take. Widening the sniffer is a security-surface change and was NOT quietly done.
4. (seed test, then runtime) A named sponsor speaker was getting a seat with an empty portal. Fixed in both places.

Also closed from the review: write-back join agreement, a composite tier FK (a single-column FK let another conference's tier attach and the failure was SILENT), a chip that slid its sibling when the last overdue item was completed, chip casing, three seed assertions that were weaker rather than sharper, boothFor counting three of seven booth columns, and one-tier-name-per-conference.

TWO THINGS FOR THE FLEET
- check:routes had been DARK on main since MRQ-209's route-table import (Node type stripping resolves extensionless relative specifiers literally), so pr-gate was red for every agent. Verified failing at the branch base AND at github/main before touching it; fixed in this PR.
- The primary checkout carried a STALE .git/index.lock, zero bytes, timestamped 17:40 — a crashed process's leftover that was blocking every index operation in the board home for the whole fleet. No live git process existed; removed it (git's own instruction for exactly this), fast-forwarded, and left every .lattice working-tree change alone.

GATE: pr-gate pass-over-budget (every check passed); npm test 203 files / 1434 tests / 0 failures; schema, seed, design, api, routes, clocks, shell-truth, trace:ac all pass. Adopted main's new migration-delta schema verification (scripts/schema-deltas/0023_sponsors.json: 4 tables, 14 FK rows).

Validation evidence: artifacts/mrq-214/validation.md; independent review: artifacts/mrq-214/review.md. Merging does not deploy, and nothing here was deployed.