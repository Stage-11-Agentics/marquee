# MRQ-118 validation — CNT-S3 steps 7–9 and 15 driven against a running Worker

## Method

`npx vite dev` on port 5311 (the Cloudflare plugin runs the real Worker), migrations applied,
`npm run seed` (9,976 rows). Signed in through the product's own door
(`POST /api/v1/auth/demo {"role":"organizer"}`) and drove the actual HTTP surface the browser
drives — not test doubles, not seeded state, not in-process mocks.

Target: `sub_are-reasoning-models-better-llm-judges`, status `accepted` — the exact class of
record that could not be edited at all before this ticket.

## Result — every step of the judge's walkthrough passes

```
login: 200
ORIGINAL TITLE: Are reasoning models better LLM judges?
step7 edit -> 200
  persisted title : UPDATED: Are reasoning models better LLM jud ...
  live-demo saved : True
  list reflects it: UPDATED: Are reasoning models better LLM jud ...     <- CNT-09
step8 second edit -> 200
step9 history entries: 2
   content_updated  actor='AIE Program Committee'    restorable=True     <- CNT-11 attribution
   content_updated  actor='AIE Program Committee'    restorable=True
restore -> 200
  keeps live-demo : True                                                 <- CNT-11 restore
  lost laptop     : True
  title prefixed  : True
  history rows now: 3 ['content_restored', 'content_updated', 'content_updated']
step15 cleanup -> 200 | exact original title restored: True
no-op save -> 200 | wrote no history row: True
actions: {'can_decide': True, 'can_schedule': True, 'can_publish': False,
          'can_edit_content': True, 'can_restore_content': True}
```

Mapped to the scenario: step 7 (edit persists across navigate-away/reopen, and the session
list shows the new title), step 8 (second distinct edit), step 9 (≥2 timestamped entries with a
person's NAME — not the literal "user" the card printed before — then a restore that drops the
second edit's sentence and keeps the first), step 15 (the exact original title returns, which
later areas depend on).

## UI half

The c11 browser surface wedged repeatedly under fleet load (five `browser.get.text` socket
timeouts at load 223), so rather than keep retrying I built the UI assertion as a repeatable
gate instead of a one-off screenshot: `tests/unit/content-history-panel.MRQ-118.test.ts`
renders `ContentHistory` through `preact-render-to-string` and pins the scoring surface —
the editor's name appears, `actor_kind` never does, the restore control names the version it
restores to, non-content rows offer no restore — plus the two elements-never-jump contracts
(fixed action column, pinned save-button width). 8 tests, ~350 ms. This is the better artifact:
a screenshot proves one moment, this fails the build if the attribution regresses.

Enabling that required teaching the node test project Preact JSX (`vitest.node.config.ts`),
which had no `.tsx` support at all — the reason no UI component in this repo had a render test.

## Suites

- `tests/integration/api/content-editing-history.MRQ-118.test.ts` — 22 tests
- `tests/unit/content-history-panel.MRQ-118.test.ts` — 8 tests
- Regression: portal, views-drafts, submission-record-board, record-actions-declined, search, meta — all green

## Local gate

`npm run pr-gate -- --ticket MRQ-118` → **pass**, 81,394 ms against a 120,000 ms budget.
