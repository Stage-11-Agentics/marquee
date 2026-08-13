# Plan Review: MRQ-156 — V2-7: public speakers, finished; and honest outbox copy

### 1. Verdict

**PASS** — with three major issues that must be handled during implementation.

The approach is sound, correctly scoped, and consistent with existing conventions. The
issues below are specifics the plan leaves open where the code has a trap waiting; none
of them invalidate the approach, and all live inside files the plan already claims.

### 2. Summary

Reviewed the four-part plan (speakers Gallery/List toggle, bio clamp + `Sessions (N)`,
outbox chip copy, closed-portal date) against the current `github/main` tree — the
sequencing gate is already satisfied: PR #132 (MRQ-143) is **merged**, so
`/speakers`, `PublicSpeakerDirectoryPage`, and `loadPublicSpeakerDirectory` all exist
and the plan's assumptions about them hold. The plan covers every task item, picks the
right mechanism for each (URL-backed view matching the existing `/agenda?view=mine`
precedent; progressive enhancement matching the existing inline-script pattern), and
correctly reaches for suppression rather than invention on item 4. The key concern is
that step 1 needs data the directory loader currently throws away, and that a URL-backed
view interacts with two existing links the plan does not mention — one of which is
directly graded by the EMB-13 rubric line this ticket is chasing.

### 3. Issues

**[MAJOR] Plan bullet 2/3 — the session count the List rows need does not exist in the directory's data**

`loadPublicSpeakerDirectory` (`src/lib/public-site.ts:735`) dedupes into
`Map<string, PublicSpeakerSummary>` keyed by speaker id and returns
`speakers: PublicSpeakerSummary[]`. `PublicSpeakerSummary` carries no session count, and
the per-speaker session set is discarded by the overwrite in the dedup loop. The plan
says "Keep speaker data loading and surname ordering in `src/lib/public-site.ts`," which
reads as *no change there* — but bullet 3 requires "each speaker's published-session
count." Discovering this mid-implementation invites the wrong fix (a second query per
speaker, or counting in the component from data it does not have).

**Recommendation:** State it explicitly: count during the existing dedup loop while the
sessions are still in hand, add a `PublicSpeakerDirectoryEntry = PublicSpeakerSummary & { sessionCount: number }`,
and widen `PublicSpeakerDirectoryData.speakers` to it. Confirm
`comparePublicSpeakerDirectoryEntries` (`:143`) still types. Worth noting for the
implementer: the count stays correct under an active search — `sessionRowsQuery(..., { speakerOnly: true })`
filters by an `EXISTS` over the session's participants, so every session of a matched
speaker survives the filter; no extra query is needed.

**[MAJOR] Plan bullet 2 — a URL-backed view breaks two existing links, one of them graded**

`?view=list` is the right mechanism, but three link sites currently hardcode
`event=` only:

- The directory's search form (`PublicAgendaPage.tsx:1010`) is `method="get" action="/speakers"`
  with a hidden `event` input. Submitting a search **drops `view`** and throws the
  visitor back to Gallery. The hidden-input pattern is right there to copy.
- The toggle links themselves must carry `q` forward, or toggling clears an active search.
- `PublicSpeakerPage`'s back link (`:1050`) is `/speakers?${eventQuery}`. EMB-13's
  `pass_criteria` says "Back/Close restores the grid **in its prior state**" — a judge in
  List view who opens a profile and presses ← Speakers lands in Gallery, and the ticket's
  own rubric line loses its point.

**Recommendation:** Add a small href helper alongside the existing `agendaHref`
(`:348`) that carries `event`, `q`, and `view`; use it for the toggle, the directory
cards' hrefs, and the profile back link. Add the `view` hidden input to the search form.
Add "toggle to List, run a search, open a profile, press back — still List" to the VERIFY
list.

**[MAJOR] Plan bullet 5 — where the "future close date" decision is made**

The target is confirmed: `PublicForm.tsx:468` renders
`` `Closed ${new Date(closes_at).toLocaleDateString()}` `` whenever the state is closed,
including a manual closure whose `closes_at` is still in the future. Also confirmed:
**there is no `closed_at` column** on `forms` (`migrations/0001_init.sql:216-238`), so
"the closure state's own date" is unavailable and suppression is the only honest option —
the plan chose correctly. But `PublicForm` is server-rendered *and* hydrated from injected
JSON (`public-form.route.tsx`), so a bare `Date.now()` comparison inside the component
puts the rule in the one place where SSR and client can disagree, and where no test can
reach it without a DOM.

**Recommendation:** Compute it server-side where `now` already lives — `loadPublicForm`
already threads `now` into `publicFormIsClosed` (`public-form.shared.ts:178, 211`). Expose
the decision on the public state (e.g. a nullable close-date label) and have the component
render what it is given. That makes the "CONTRACT · closed-state copy" test the plan
promises a plain unit test over `toPublicFormState`, and keeps time-based closure showing
its correct past date.

**[MINOR] Plan bullet 4 — "reusing the embed's existing list layout" is not literal reuse**

The embed's list (`EmbedPage.tsx`, `.embed-speaker-list`, `.embed-flat-row`) is styled by
the embed document's own stylesheet; the public site ships `PUBLIC_SITE_STYLES` from
`PublicAgendaPage.tsx:16`. The two style systems do not meet, so this is reproducing a
treatment in public tokens, not importing a component. Read literally, the plan could send
an implementer toward importing `.embed-*` CSS into the public page.

**Recommendation:** Say "reproduce the embed's compact row treatment using `.public-*`
classes and tokens." One naming trap worth calling out: `.public-speaker-list` is
**already taken** — it is the session list on the *profile* page (`:1064`). Name the
directory list something else (`.public-directory-list`).

**[MINOR] Plan bullet 4 — the ticket's line reference is off by one**

The outbox chip is `CommsScreen.tsx:377` (the `<summary>` status span); `:378` is the
message-detail row. Trivial, but the two lines are adjacent and both mention suppression.
Verified low-risk: no test or fixture in `tests/` asserts the string `suppressed · demo mode`.

**[MINOR] Plan bullet 6 — `tests/ac-claims/MRQ-156.json` is not mentioned**

`npm run pr-gate` runs `trace:ac --scope=merged --ticket=MRQ-156`
(`scripts/checks/pr-gate.mjs:19`), which emits a `missing-current-ticket-manifest`
warning when no claim manifest exists for the ticket.

**Recommendation:** Add the manifest (`{"ticket": "MRQ-156", "owns": [...], "exercises": [...]}`)
as part of the test step, or note deliberately that this ticket owns no AC.

**[MINOR] Plan bullet 5 — a simpler alternative for the bio clamp**

The plan's progressive enhancement is fine and matches the page's inline-script pattern
(`/p/:slug` already passes `PUBLIC_SCHEDULE_SCRIPT`, and `/agenda` shows scripts being
concatenated). But a CSS-only clamp (`-webkit-line-clamp: 5`) with a `<details>`-based
Show more gets no-JS correctness for free, with no measurement pass and no reserved-line
bookkeeping.

**Recommendation:** Try the CSS-only route first; fall back to the scripted version only
if the "only show the control when the bio actually overflows" requirement demands
measurement. Either way, say which script carries it — `PUBLIC_SCHEDULE_SCRIPT` is shared
with the agenda pages, so a new profile-only script concatenated at the route is cleaner.

### 4. Positive Observations

- **The sequencing gate was real and is now clear.** The plan names it explicitly rather
  than assuming; #132 is merged, and every structure the plan leans on exists.
- **Mechanism choices match existing convention rather than inventing.** A URL-backed view
  mirrors `/agenda?view=mine`; SSR-first with progressive enhancement mirrors how every
  public page already works; the fixed-width segmented control has a direct precedent in
  `.embed-layout-segment`.
- **Item 5 is correctly diagnosed as one line and correctly resolved as suppression.** The
  plan resisted the tempting wrong answer — there is no `closed_at` to show, and inventing
  one from `updated_at` would have been worse than nothing. It also correctly narrows to
  *future* dates, leaving a time-based closure's honest past date intact.
- **Honest about verification.** Tests plus the gate plus driving all four flows in a real
  browser, rather than stopping at green tests — which is exactly what items like a
  no-jump toggle and a clamped bio require, since neither is provable from a unit test.
- **Scope is disciplined.** Four small changes, no abstraction built ahead of need, no
  adjacent cleanup smuggled in.
