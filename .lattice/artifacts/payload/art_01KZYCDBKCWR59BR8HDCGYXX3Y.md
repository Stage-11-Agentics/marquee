# Code Review: MRQ-160

## 1. Verdict

**PASS**

## 2. Summary

Reviewed the fix for `findSubmitterEvent` picking the earliest conference instead of the one a submitter just submitted to. The resolver now orders `starts_on DESC` with an explanatory comment (AC3), the CFP confirmation magic link carries the submitting event's ID through to the redirect (AC1), the submitter portal now returns and renders an `available_events` switcher so a reader can reach every conference they've submitted to (AC2), and a new integration test drives the two-event case through the real public-form → magic-link → portal path rather than injected memberships (AC4). All four acceptance criteria are met and the implementation is consistent with the existing resolver/query patterns in this file. Two minor, non-blocking cleanup items are noted below.

## 3. Issues

**[MINOR] src/ui/portal/PortalPage.tsx:276-284 — Mapped conference links have no `key` prop**
Every other `.map()` that renders JSX in this file (`FormField`, `TaskRow`, `SubmissionRow`, `StatusHero`, `TalkCard`, etc.) sets a `key`, but the new `conferenceLinks` array does not:
```jsx
const conferenceLinks = snapshot.available_events.map((event) => (
  <a class="portal-button secondary" href={...} aria-current={...}>
    {event.name}
  </a>
));
```
This is a deviation from the codebase's established convention and will emit a Preact "missing key" warning; harmless today since the list is static per page load, but inconsistent and worth fixing for anyone who later makes this list dynamic.
**Fix:** `<a key={event.id} class="portal-button secondary" ...>`.

**[MINOR] tests/integration/api/submitter-portal.MRQ-150.test.ts:382 & :430 — `eventId` parameter on `submitAndFollowPortalLink` is dead**
The helper's signature grew `eventId?: string`, and the new MRQ-160 test passes `eventId: LATER_EVENT_ID` at the call site, but nothing in the helper body reads `input.eventId` — routing to the later conference is actually driven entirely by `slug: "submitter-cfp-later"` (which is bound to `LATER_EVENT_ID` via the form fixture). The test still proves what it claims (the server-computed redirect is asserted independently), so this isn't a false-positive risk, but the unused field misleads a future reader into thinking the client can pick the target event.
**Fix:** drop the unused `eventId` field from the input type and the call site, or wire it into the request if there was a reason to pass it explicitly.

No other issues found.

## 4. Positive Observations

- `findSubmitterEvent`'s new ordering comment (portal.routes.ts:333-336) does exactly what AC3 asks: it states *why* `starts_on DESC` is correct for a submitter, distinct from the (still oldest-first, out-of-scope) speaker resolver right above it.
- The confirmation-link fix (public-form.routes.ts) and the resolver's default ordering are complementary, not redundant: a fresh submission's magic link deterministically opens the event just submitted to via the query param, while the DESC fallback only matters for links minted before this change or without an `eventId`. That's the right belt-and-suspenders design given AC1's literal wording ("the conference they submitted to," not just "the latest").
- `findSubmitterEvents` and `available_events` are correctly scoped to `auth.orgId`/`auth.personId` the same way the existing resolver is, and the field is `.optional()` in the response schema so the speaker-seat response (which never sets it) stays valid.
- The new integration test (`CONTRACT · MRQ-160`) is a genuinely strong regression guard: it submits through two real public forms bound to two real events, follows the real magic-link exchange, and asserts both that the later event is selected by default *and* that the earlier one remains reachable and doesn't leak the other event's submissions — exactly the "not on injected memberships" bar AC4 sets.
- Good hygiene on the pre-existing tests: `submitter-portal.MRQ-150.test.ts` and `submitter-seat.MRQ-154.test.ts` were both updated for the new `/portal?eventId=...` redirect shape rather than left to silently start failing.
- The bundled copy fix (`submitterOutcomeDetail`'s "accepted" text no longer promising a speaker portal) is outside MRQ-160's literal file list but is well covered by its own dedicated unit test (`CONTRACT · MRQ-162`) and doesn't conflict with or complicate the MRQ-160 changes.
