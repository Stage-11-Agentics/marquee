# Code Review — MRQ-22

Reviewed exact HEAD: `1b037839508ae48b14aeb211fb7af6a791ccef8a`
Base: `forgejo/master @ 7ecbef86375803caac69b029addf8ddb8dccf74d`
Reviewer: `agent:delegator-mrq-22`
Review mode: inline self-review; suspended headless code review was not run.

## Verdict

**PASS**

## Scope

Anonymous SSR public agenda, session and speaker permalinks, published-only
visibility, venue-label privacy, anonymous agenda/speaker embeds, configured
embed preview/snippet, public cache keys and publish-purge seam, generated API
manifest registration, and the AC-83–AC-90 / AC-240 / AC-252 / AC-253 tests.

## Findings

None.

## Evidence

- `git diff --check forgejo/master...HEAD` is clean; the branch is rebased on
  the current remote master and the rebased HEAD is pushed.
- The leak regression test asserts 404 plus absence of the unpublished ID,
  title, and abstract for guessed session/speaker HTML and API URLs; the
  published agenda is also scanned for all three values.
- Public SQL gates `agenda_items.is_published = 1` and selects only public
  room/building names. The public renderer calls the existing
  `roomDisplayLabel` helper and never selects AV capabilities, room notes, or
  building access notes.
- Embed cache keys have no identity dimension; the logical TTL is 30 seconds,
  the Cloudflare KV minimum is handled with a 60-second storage fallback, and
  the publish purge helper deletes every event variant. Public responses send
  `Cache-Control: public, max-age=30, s-maxage=30`.
- `npm test` passed at this exact HEAD: 145 Vitest tests plus 32 contract/node
  checks. The focused MRQ-22 suite passed 5/5 before the rebase.
- `npm run trace:ac -- --scope=merged --ticket=MRQ-22` passed with zero
  uncovered criteria and zero errors; `npx vite build`, `check:api`, and
  `check:design` passed before the rebase and are rerun by the final PR gate.

