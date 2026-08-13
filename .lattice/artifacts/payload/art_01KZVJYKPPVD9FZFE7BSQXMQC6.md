# Code Review: MRQ-133 — the sign-in door, and a 401 that leads to it

Reviewer: independent (Claude), cold context. Worktree `Marquee-worktrees/mrq-133-signin`
@ `4ecdc6d1`, 8 commits, 27 files (+1266/−51).

Verification performed: read every changed file plus the modules they lean on
(`magic-links.ts`, `instance-claim.ts`, `scope-resolution.ts`, `rate-limit.ts`,
`demo-fixture.ts`, `claim.route.tsx`, `OverlayHosts.tsx`, `app.tsx`), ran the full
gate, and read the attached smoke screenshots.

**`npm run pr-gate -- --ticket MRQ-133` → pass, 44,484 ms of a 120,000 ms budget.**
All eleven checks green: three typechecks, production build, shell-truth, design
contract, API contract, route map, fixture clocks, hermetic suite (40,174 ms of a
45,000 ms budget), merged AC trace (0 uncovered, 0 errors).

---

### 1. Verdict

**FAIL (implementation-level)** — on one issue, with a two-condition fix.

The plan is sound and the build follows it closely. But scope item 2's new
"org's newest event" attribution fallback, combined with the demo-mode on-screen
link, produces an unauthenticated account-takeover path against a **real** (claim-created)
owner on the shipped instance topology — reachable with nothing but that person's
email address, from the public form this ticket just built. See Issue 1. Everything
else below is minor and would not, on its own, hold the merge.

### 2. Summary

This is careful, idiomatic work. The page reproduces the claim-page idiom exactly
(server-rendered, session-free, inline styles and script, `assetShell` fallback), the
four states are all decided before the first byte, the wall reuses the shell's own
modal chrome instead of inventing a stylesheet, and the demo landing is kept
byte-identical by a `demoMode` flag that fails *closed* on a database wobble. The
smoke evidence is real — screenshot 04 shows the wall standing over a live Program
board with the work still visible behind it, screenshot 06 shows the expired link
rendering the door instead of a JSON envelope. Test coverage is genuinely good: pure
decisions extracted into `signin-destination.ts` and tested as arithmetic, one Worker
integration file as instructed, and the client listener tested in both directions.

The key finding is that the new event-id-less path can hand a real owner's sign-in
link to an anonymous caller on any instance where the claimed org also holds the demo
event — which is the default topology, because `resolveOrganization` reuses the oldest
existing org (`src/lib/auth/instance-claim.ts:66`).

### 3. Issues

---

**[CRITICAL] src/routes/auth.routes.ts:215 — the on-screen demo link can be minted for a real person**

```ts
if (event.demo_mode === 1) onScreenLink = absoluteLink;
```

`event` here is no longer the event the caller named. For an `event_id`-less request
it comes from `attributionEvent` → `pickOutboxEventId`, which falls back to *the org's
newest event* when the person holds no event-scoped membership
(`src/lib/auth/signin-destination.ts:402`). Three facts make that fallback land on the
demo event for the instance owner:

1. `upsertOrganizerMembership` gives the claimed owner an **org-wide** membership with
   `event_id = NULL` (`src/lib/auth/instance-claim.ts:284`), so the membership branch of
   `pickOutboxEventId` never fires for them.
2. `resolveOrganization` reuses the **oldest existing organization** rather than creating
   a fresh one (`src/lib/auth/instance-claim.ts:66`), so on a demo-seeded instance the
   claimed owner is a `people` row inside `org_demo` — the same org that owns the
   `demo_mode = 1` event.
3. On such an instance the demo event is typically the only event, so it is also the
   newest.

**Failure scenario.** On `marquee.stage11.dev` (demo-seeded and claimed), an anonymous
caller who knows the owner's email address posts:

```
POST /api/v1/auth/magic-link
{"email": "<owner@their-domain>"}
```

`findPersonForSignin` resolves the real owner (no event scope any more),
`pickOutboxEventId` returns the demo event, `event.demo_mode === 1`, and the 200 body
contains `magic_link` — a live, 15-minute, single-use link that exchanges into a
30-day owner session. Full instance takeover, unauthenticated, one request.

The *shape* of this hazard predates the ticket: `main` already returned the on-screen
link for any `people` row in a `demo_mode` event's org. But on `main` the caller had to
name the demo `event_id`, and the demo-ness came from the event they named. This diff
removes the event from the request entirely and lets an inferred attribution event
decide, so an email address alone is now sufficient — and the new `/signin` form is a
public surface pointed straight at it. The ticket asks the route to be widened; it does
not ask for the demo escape hatch to widen with it.

**Fix:** gate the on-screen link on the *person*, not only on the attribution event.
Demo personas carry `is_demo = 1` (`src/lib/reset-demo/demo-fixture.ts:77, 91`) and
claim-created people carry `is_demo = 0` (`src/lib/auth/instance-claim.ts:253`), so the
judge flow is untouched and the owner is covered:

```ts
// The link only ever appears on screen for a seeded demo persona. A real
// person in the same org as the demo event is a real account, and handing
// their sign-in link to whoever knows the address is a takeover, not a demo.
if (event.demo_mode === 1 && person.is_demo === 1) onScreenLink = absoluteLink;
```

Worth a test alongside the existing demo case: a real person seeded into the demo
org gets `magic_link` **absent** from the body.

---

**[MAJOR] scripts/checks/check-routes.mjs:68 — the new assets-router gate is blind to the route that motivated it**

The guard's own docblock cites `/claim/:token` as the lived failure ("shipped that way
and served an empty shell on the deployed Worker until MRQ-133"). But `serverPageRoutes()`
finds pages by matching `.get("<literal>"` in `*.route.tsx`, and `claim.route.tsx:213`
registers both paths through a loop over an array:

```ts
for (const [path, door] of [["/claim/:token", "claim"], ["/join/:token", "org_invite"]] as const) {
  claimRoutes.get(path, async (context) => {
```

So `/claim/:token` and `/join/:token` are absent from `pages` — confirmed by the
regenerated `docs/ROUTES.md`, whose "Server-rendered pages" table lists neither. The
new `assetsRouterCoverage` check therefore never examined them; the wrangler entries
were added by hand, and if someone removes them tomorrow the gate stays green. A guard
that cannot see its own motivating example will not catch the next one.

**Fix:** either register the two paths as literal calls so the existing regex finds
them, or add a second matcher for the array-literal form. The literal registration is
the smaller change and keeps one convention:

```ts
claimRoutes.get("/claim/:token", claimPage("claim"));
claimRoutes.get("/join/:token", claimPage("org_invite"));
```

---

**[MINOR] src/ui/app.tsx:37 — two of the four embed kinds now render, then get wiped**

`wrangler.jsonc` gains one `run_worker_first` entry per embed kind — `/*/agenda/embed`,
`/*/sessions/embed`, `/*/speakers/embed`, `/*/cfp/embed` — but `isPublicPage` still
matches only two:

```ts
/^\/[^/]+\/(?:agenda|speakers)\/embed\/?$/.test(window.location.pathname);
```

`EMBED_KINDS` is `["agenda", "sessions", "speakers", "cfp"]` (`src/db/schema.ts:113`),
and `embed.route.tsx:124` serves all four. So `/{event}/sessions/embed` and
`/{event}/cfp/embed` are now correctly server-rendered by the Worker, and then the
client bundle mounts `AppShell` over the top of them because the predicate says they
are not public. Not a regression — before this change the assets router served a bare
shell for those paths anyway — but the diff fixes half the problem and leaves the other
half looking fixed.

**Fix:** `/^\/[^/]+\/(?:agenda|sessions|speakers|cfp)\/embed\/?$/`, then
`npm run check:routes -- --write`.

---

**[MINOR] src/routes/auth.routes.ts:189 — the cooldown blacks out the demo's only delivery channel**

On a demo instance the on-screen link *is* the delivery channel — mail is typically
unconfigured, and screenshot 01 shows the page saying so. A second submit within 60 s
takes the `hasFreshLoginLink` branch, mints nothing, and returns the generic
acknowledgement with no `magic_link`. The page cannot recover the first link either:
`mintLink` stores only `sha256Hex(token)` (`src/lib/auth/magic-links.ts:66`), so the raw
token is gone. The reader sees "a sign-in link is on its way" on a deployment that has
just told them mail will not arrive, and nothing else, for up to a minute.

The client script's decision not to blank an already-displayed link
(`signin.route.tsx`, `SIGNIN_SCRIPT`) covers the same-page case, which is good — but not
a reload, a second tab, or the judge who navigates away and comes back. The three demo
doors below limit the damage, which is why this is minor rather than major.

**Fix:** skip the cooldown when the resolved person is a demo persona — one extra
condition, and it keeps the anti-mail-cannon property exactly where it matters, since a
demo persona's mail goes nowhere:

```ts
const cooled = person.is_demo === 1 ? false : await hasFreshLoginLink(...);
```

---

**[MINOR] src/ui/shell/api-client.ts:68 — `ERROR_TREATMENTS.unauthenticated` was left unread**

Scope item 5 asked for this to be re-read now that the wall carries the action. It is
unchanged, and the PR's own screenshot 04 shows why that matters: behind the wall, the
Program board panel reads *"Your session has expired. Sign in again to pick up where
you left off. · ref 00dfdc"* while the wall in front of it reads *"Your session ended. /
Sign in again and you will come back to this page."* — the same sentence and the same
instruction, twice, one of which has no button attached to it. Two answers to one
question, which is precisely the reasoning the diff uses to *suppress* the wall inside
PortalPage.

**Fix:** trim `recovery` to something the wall does not already own — e.g.
`"Nothing you were working on has been lost."` — and leave `sentence` alone.

---

**[MINOR] src/ui/shell/SessionWall.tsx:21 — the modal effect re-runs on every shell render**

```ts
const ref = useDialogLifecycle(true, () => undefined);
```

`useDialogLifecycle` lists `onClose` in its dependency array
(`src/ui/shell/OverlayHosts.tsx:34`), and this arrow is a new identity on every render.
The wall is sticky, so it stays mounted while the page behind it keeps setting state
(toasts, polling, search) — and each of those renders tears down and re-runs the
effect: `document.body.style.overflow` is restored then re-hidden, `previous?.focus()`
fires, then `ref.current?.focus()` fires again. Focus bounces off the dialog and back,
and the `oldOverflow` captured on the second run is already `"hidden"`, so an eventual
unmount would leave the body unscrollable.

**Fix:** hoist a stable no-op — `const INERT = () => undefined;` at module scope, passed
as the second argument.

---

**[MINOR] src/routes/signin.route.tsx:341 — `String.replace` treats `$` in the rendered markup as a pattern**

`shell.replace('<div id="app"></div>', \`<div id="app">${markup}</div>\`)` uses a
*string* replacement, where `$&`, `$'`, `` $` `` and `$1` are substitution directives.
`markup` contains `state.next`, which is attacker-supplied: `/signin?next=/a$'` passes
`safeNext` (it starts with `/`), lands in the hidden field's value, and makes
`replace` splice the remainder of the shell document into the page. Not XSS — the
spliced text is the shell's own already-escaped tail — but the page comes out
malformed. Same idiom, same exposure, in `claim.route.tsx:187` via the `name`/`email`
prefills, so it is pre-existing rather than introduced.

**Fix:** use a function replacer, which never interprets `$`:
`shell.replace('<div id="app"></div>', () => \`<div id="app">${markup}</div>\`)`.

---

**[MINOR] src/routes/signin.route.tsx:367 — `next` has no length bound**

The claim page caps its query prefills at 200 and 320 characters
(`claim.route.tsx:232`). `safeNext` applies no bound, so a multi-kilobyte `?next=`
is rendered verbatim into the hidden field and then posted back as `redirect_to`,
where it is stored in `magic_links.redirect_to` and later becomes a `Location` header.

**Fix:** `safeNext(url.searchParams.get("next")?.slice(0, 512))`, matching the claim
page's posture.

---

**[NIT] src/routes/signin.route.tsx — the mail callout contradicts the demo card below it**

Screenshots 01 and 06 show "This deployment cannot send mail yet. **A link requested
here will not arrive.**" directly above a demo card, on an instance where submitting the
form *does* produce a working link on screen. Both statements are individually true and
together they read as a contradiction to anyone who tries it.

**Fix:** when `state.demo`, soften the second sentence — e.g. "A link requested here
will not be emailed; the demo shows it on screen instead."

---

**[NIT] src/routes/auth.routes.ts:471 — `attributionEvent` re-reads an event already in hand**

When `event_id` *is* supplied, `findPersonForSignin` has already run
`SELECT * FROM events WHERE id = ?` (line 447) and `attributionEvent` runs the identical
query again. Two round trips where one would do.

**Fix:** have `findPersonForSignin` return `{ person, event }` and pass the event
through.

---

### 4. Positive Observations

- **The pure/impure split is the right one.** `signin-destination.ts` extracts the three
  decisions that fail silently — seat home, `?next=` safety, outbox attribution — into
  pure functions, then tests them exhaustively (`tests/unit/signin-destination.MRQ-133.test.ts`,
  including a non-mutation assertion on the caller's rows). This is what let one
  integration file cover the wiring instead of five.
- **The demo landing really is byte-identical.** `{!data.demoMode && …}` renders nothing
  when false, and the catch-branch defaults `demoMode: true` so a database wobble cannot
  accidentally add a link to the graded surface. That default is the conservative one,
  and the comment says why.
- **`safeNext` hardens beyond `isSafeRedirectTarget`.** The extra `/\` rejection is a real
  browser behaviour, not a theoretical one, and the hostile-input test enumerates
  `//evil.com`, `http://`, `https://`, `/\`, `javascript:`, bare host, and empty.
- **The wall is the right shape.** Sticky, one per session, mounted as a sibling above
  every AppShell branch (`/handoff`, `/reviewer`, blocked seats, the main shell) rather
  than replacing any of them, reusing `modal-backdrop`/`modal` so it cannot drift from
  Flight Deck. `onUnauthenticated` mirrors `onForbidden` exactly, and the client test
  pins both directions plus the unsubscribe and the still-thrown error.
- **The `check:routes` assets-router gate is a real contribution**, independent of this
  ticket — a whole class of "200 that contains none of the page" is now a gate failure
  rather than a live discovery, and the comment is honest that it is a smoke alarm and
  not a proof. (Issue 2 is about its reach, not its worth.)
- **The smoke gate was actually run**, not asserted: eight screenshots covering all three
  required flows plus the sign-out state and the restored claim page, and the wall
  screenshot shows the underlying board still legible behind the dim, which is the
  property the operator ruling was actually about.
- **Comments earn their place.** The `rejectMagicLink` docblock, the `run_worker_first`
  block, and the `.signin-status` min-height note each record something a reader could
  not derive and would otherwise re-break.

### 5. Recommended path

Fix Issue 1 before merge — it is two conditions plus a test, and it is the difference
between a door and a door with the key taped to it. Issues 2 and 3 are cheap enough to
fold into the same push. The remaining minors and nits are legitimate follow-ups and
should not hold pre-deadline scope.
