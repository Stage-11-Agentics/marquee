# MRQ-106 validation — exercised against running systems

## 1. THE GATE RESULT — the live headshot upload is FIXED (item 1)

Real browser session against the **deployed** site, not localhost, not a mock.

- Live build `709f9ca7`. `git merge-base --is-ancestor 1fc2e2e 709f9ca` → true, so
  MRQ-92's fix is deployed.
- `https://marquee.stage11.dev/f/cfp`: filled title, speaker name, and speaker email
  (`ensureDraft()` hard-requires an address), then injected a **real 256×256 PNG**
  (2175 bytes, canvas-generated) into `#public-headshot` through `DataTransfer` and a
  bubbling `change` event — the path a human file-picker takes.
- Result: the field reads **`Saved file: mrq106-probe.png`** with class `has-file`, and the
  crop preview rendered. No page error.
- Why that label is proof: `PublicForm.tsx:385`'s `setAnswer(field.key, {attachmentId…})`
  is the only thing that sets `existing`, and it is reached only after **sign → R2 PUT →
  complete** all resolve (`PublicForm.tsx:373-383`). Any failure lands in the `catch`.
- Screenshot: `docs/evidence/mrq-106/live-headshot-upload.png`.

CFP-S2's 43 turns and CFP-S3's 20 turns on this field are recovered. Nothing downstream is blocked.

## 2. Local runtime — real Worker, migrated and seeded

`npx vite dev` (the real Worker), migrations applied, `npm run seed` → 9,976 rows.

| Check | Evidence |
|---|---|
| Sidebar rows exist and point at real paths | hrefs read from the live DOM include `/submissions`, `/submissions/new`, `/embed/config` |
| The Embeds row leads to a working flow, not an empty state | `/embed/config` renders `h1: "Embed the program."`, 8 real track options, `hasSnippet: true` |
| The event switcher is gone | `.event-switcher` absent; `.event-context` reads `Conference / AIE NYC 2026` |
| The agenda feed link exists and resolves | `/agenda` serves `Agenda data ↗` → `/api/v1/public/agenda?event=aie-ny-2026` → **200 `application/json`** |
| `/embed/config`, `/agenda`, `/dashboard` all serve | 200 |

## 3. The Ready-to-place premise, on real data

Both the local seed and the deployed site, through the API with a real organizer session:

| Filter | Local | Live |
|---|---|---|
| `status=accepted` (the pipeline stage) | **1** | **1** |
| `status=accepted_any` (the stored fact) | **60** | **62** |

**This changed the shape of the fix, and the change is deliberate.** The ticket specified an
escape for "the stage filter yields 0 while accepted_any > 0". MRQ-100's stage seeding means
that zero is now nearly unreachable — and what replaced it is worse: `?status=accepted` answers
with **one** record on a conference that accepted 62. An empty list reads as a filter that
missed; a list of one reads as an answer. The note therefore fires on the **gap**, not the zero,
and the zero case keeps its own larger escape in the empty state. Flagged as deviate-with-flag.

## 4. Generator, exercised both ways

- `node scripts/checks/check-routes.mjs --write` → `pass`, 29 SPA routes, 8 server pages.
- Clean re-run → `pass`.
- Injected drift → **`fail`, reason `drift`**, with the fix command printed.
- Wired into the gate; `[pr-gate] route map` passes.

## 5. Truthful notes (`.eval-kit/evalconfig.json`, primary checkout, never committed)

`git check-ignore` confirms the file is ignored; `git status` in the worktree shows no
`.eval-kit` path. Corrections: `/site` and `/settings/webhooks` dropped (neither is a route),
`/comms` → `/communications` in both the route block and the MAIL paragraph, `/agenda` moved to
public with `/agenda-builder` named as the builder, and `/embed/config`, `/delivery-health`,
`/submissions/new`, `/board`, `/settings/venues`, `/settings/tasks`, `/co-speaker` added.

Two further falsehoods found and fixed while there:

- The MULTI-EVENT paragraph claimed the sidebar switcher "opens a modal that says 'Not
  installed'". There is no modal and never was. Item 6 removes the control, so the paragraph now
  describes what ships.
- "an `/evaluation/ai` surface exists but is off the demo path" — there is no such route, and
  `tests/unit/route-table.test.ts` has asserted its absence since before this ticket.

## 6. The one gap, stated plainly

The accepted-count note was **not** observed rendering in a browser. Every client-side `fetch`
in the c11 WKWebView surface returns `unauthenticated` against the local dev server: the session
cookie is `Secure` and the dev origin is plain `http`, so the browser will not attach it to XHR
(document navigations carry it, which is why SSR pages render authenticated). No client-fetch
behaviour can be validated in that surface, for this change or any other.

What covers it instead: the predicates behind the note are unit-tested against the real seed's
own numbers (1 of 62), and the reserved-space markup and CSS are asserted in
`tests/node/wave-0-sweep.MRQ-106.test.mjs`.

## 7. Local gate — **546/546 tests pass; red on wall clock only**

```
[pr-gate] worker types      ✓
[pr-gate] client types      ✓
[pr-gate] test types        ✓
[pr-gate] production build  ✓
[pr-gate] design contract   ✓  status: pass
[pr-gate] API contract      ✓  status: pass
[pr-gate] route map         ✓  status: pass
[pr-gate] hermetic fast suite
   Test Files  86 passed (86)
        Tests  546 passed (546)
   OVER BUDGET: 85954ms against a 45000ms objective
{ "command": "pr-gate", "ticket": "MRQ-106", "status": "fail", "failedCheck": "hermetic fast suite" }
```

Four runs, same verdict every time — **every test passes; only the 45s objective fails**, and
the elapsed time tracks machine load, not the diff: 90s, 70s, 52s, 86s at 1-minute loads of
147, 89, 53, and 52 on a box running roughly twenty agents (40+ shell users). The diff adds two
small test files and one API call on one filtered view; the vitest report attributes the cost to
worker startup (transform 109s, import 698s summed across workers), not to any test here.

Reported as red, because it is red. It is a load verdict, not a defect verdict, and I have not
touched the budget to make it green — that is not this ticket's call to make.
