# Limitations — what is not built, and what is rough

Being first to name a gap reads as confidence; every item here is one a
diligent judge could find anyway. Which of these go in the form is the
operator's call — they are written so any subset can be pasted as-is.
Verified against build `1f53732201aa`, 2026-08-12.

## Deliberately not built

- **Airtable persistence.** D1 is the source of truth; the Airtable mirror is a
  designed extension point, not a shipped feature. The named bonus is
  forfeited on purpose — at 1,000+ submissions, Airtable-as-primary fights the
  speed requirement we consider more important.
- **AI-assisted review workflows.** Taken at swyx's word ("I don't care about
  the AI workflow thing"). The one AI-shaped thing that survived is the agent
  evaluator seat: a scoped reviewer identity an organizer can hand to an AI
  reviewer, with its own credential and rubric — committee machinery, not an
  AI feature.
- **Accelevents integration, portal wiki pages** — struck in the brief, not
  built. **XLSX export** — CSV opens in Excel. **Multi-language** — English
  only, per the ruling. **Payments** — per the ruling.
- **Calendar OAuth write.** Invites are full-lifecycle ICS (request, update,
  cancel) with Google/Outlook links; pushing directly into a calendar via
  OAuth is a documented extension point, per the Discord ruling that ICS is
  enough.

## Known gaps against the incumbent's surface

- **No rich-text/WYSIWYG editor** — descriptions and bios are plain text
  fields with character budgets, not formatted documents. The incumbent ships
  WYSIWYG on six-plus screens.
- **No section headers or dividers inside a form** — a long CFP renders as one
  list of fields.
- **No admin↔portal impersonation** ("view portal as this speaker / back to
  admin"). The demo's one-click speaker seat covers the judging need; the
  production feature is absent.
- **No dedicated pronouns field**; social links are freeform, not discrete
  labelled fields.
- **13 email template keys against the incumbent's ~26 triggers.** The
  lifecycle is covered; the long tail of niche triggers is not.
- **No outbound webhook delivery.** Endpoints and event types are defined in
  the schema and API contract; the delivery writer is not built. The README
  says so.
- **No per-plan ratings column in the submissions grid, no submission-pacing
  chart, no field-level hiding from evaluators, no file approval/reject
  state.**

## Rough edges a judge might hit

- **Sessionize import is verified against a bundled fixture, not a real
  export.** The mapping preview is write-free, so checking it against a real
  export is safe — but we have not done it yet, and the README says so.
- **The speaker directory sorts by first name**, not surname.
- **The demo's third day (Oct 14) has no published sessions** — the seeded
  program concentrates on Oct 12–13. An empty day tab is seed shape, not a
  filter bug.
- **Optimistic concurrency is narrow**: the agenda mutation routes carry
  compare-and-swap version guards; other writes are last-write-wins.
- **Pagination is offset-based** (`page`/`per_page`), not cursor-based.
- **No request-level `Idempotency-Key` contract.** Idempotency exists where it
  matters operationally — outbox dedupe, durable bulk `operation_id`s,
  idempotent task reconciliation — but not as a generic header.
- **Speed budgets are instruments, not CI gates.** 14 per-surface budgets are
  measurable in one command (`npm run check:speed`, real browser); they do not
  run in CI.
- **No end-to-end browser test suite.** 388 node tests and 855 worker tests,
  all passing, plus design/API/route parity gates — but `npm run e2e` is a
  registered stub. Browser-level verification was done by hand and by the
  graders' own harness.
- **No MCP server.** The integration path is the OpenAPI document, the CLI,
  and the skill file; an MCP shim could be generated from the served spec.
- **`SKILL.md` ships in the repo, not from the site** — fetching
  `/SKILL.md` from the deployment returns the app shell.

## Internal — fix or route around before submission (not for the form)

- **Fresh-submitter portal handoff is broken on the live build.** Submitting
  the public CFP and clicking "Open your speaker portal →" on the confirmation
  page authenticates the new speaker (the session is real) but `/portal` fails
  with "conference not found" — `GET /api/v1/me/portal` 404s because the fresh
  person has no membership row. The seeded speaker seat works fine, and the
  quickstart routes judges through it, but a judge who follows the natural
  link will hit this. Verified live 2026-08-12 ~21:40 UTC.
- **The CFP header says "Closes Apr 30, 2027"** — six months after the
  conference it belongs to (Oct 2026). Seed data oddity; cheap reseed fix.
- **The OpenAPI `info.description` still claims** "Mutations carry strong
  ETag/If-Match optimistic concurrency" — one sentence, contradicted by the
  spec's own zero `If-Match` header parameters. Delete or soften the sentence
  before a diligent judge diffs it.
