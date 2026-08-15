# Plan Review: MRQ-171

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The plan correctly maps the touchpoint list, the routing structure in `AppShell.tsx`/`route-table.ts`, and the queue payload it plans to extend with committee membership — all of that checks out against the current code. But its central "no new endpoint" premise for the profile block (AC6) is built on an unverified claim inherited from the task description: `PATCH /api/v1/me/profile` looks unscoped from its OpenAPI `policy.auth`, but its handler gates on a `speakerEvent()` lookup that requires a `role = 'speaker'` membership row, which a reviewer — including the seeded demo reviewer personas the ticket's own validation script signs in as — never holds. As written, the plan will ship a profile block that 404s the moment a reviewer tries to use it, which is also exactly the step the ticket asks the implementer to manually verify before calling the work done.

## 3. Issues

**[CRITICAL] AC6 / "No new API" — `PATCH /api/v1/me/profile` and `GET /api/v1/me/portal` 404 for a reviewer with no speaker membership**

The task description asserts: *"No new API — `PATCH /api/v1/me/profile` (`src/routes/portal.routes.ts:1454`) is `auth: { kind: "authenticated" }`, not speaker-gated"* — and the plan repeats this without re-verifying it against the handler body. The OpenAPI `policy.auth` is indeed broad, but `updateProfile` (`src/routes/portal.routes.ts:1286-1288`) immediately calls:

```ts
const auth = requireUnscopedSpeakerSession(context);
await speakerEvent(context.env.DB, auth);
```

`speakerEvent()` → `findSpeakerEvent()` (`portal.routes.ts:289-317`) runs:

```sql
JOIN memberships m ON m.event_id = e.id AND m.person_id = ? AND m.org_id = ? AND m.role = 'speaker'
```

and throws `ApiError.notFound("conference not found")` when no row matches. It is purely a gate — the `event` it returns is never otherwise used in `updateProfile`. A reviewer created through the real invite flow (`inviteCommitteeReviewer`, `evaluation.routes.ts:865-945`) only ever gets a `reviewerMembershipStatement` (`role: "reviewer"`), never a `speaker` membership. The same is true of the seeded reviewer personas the plan's own validation step signs in as (`scripts/seed/evaluations.ts:79-98`: Nora Vale / Dario Quill / Imani Sato each get exactly one `membership(ctx, personId, "reviewer")`, no `"speaker"` row) — and `findDemoPersona`'s staff-exclusion logic (`demo-seat.ts:80-114`) guarantees the "reviewer@demo.com" door resolves to one of exactly these three, never to the staff person who happens to also hold a `reviewer` membership alongside `owner`.

`GET /api/v1/me/portal` (the endpoint `PortalPage.tsx`'s `ProfileForm` sources its `person` prop from) has the identical gate at `portalSnapshot()` (`portal.routes.ts:1057-1063`): no speaker seat, no submitter seat (a submission), and it 404s before ever reaching the "seat: submitter" fallback the endpoint's own doc comment describes.

Net effect: following the plan exactly, "Home renders... the shared profile editor" reusing `/me/profile`/`/me/portal` as-is will 404 for every real reviewer, and the ticket's own prescribed validation ("edit the profile, reload, confirm it stuck," through the demo reviewer door) will reproduce the failure immediately rather than only in production.

**Recommendation:** Before implementation, decide and record how a reviewer's own profile is read and written through the existing route — the fix stays within "no new endpoint" (broaden `findSpeakerEvent`/`speakerEvent`, or the specific call sites in `updateProfile`/`portalSnapshot`, to also accept a `role = 'speaker' OR role = 'reviewer'` membership, or resolve the reviewer's home event a different way that doesn't require a speaker row) but it is a real code change the plan does not currently account for. Add it as an explicit implementation step and an explicit test (reviewer-only membership, no speaker/submitter row, profile GET+PATCH succeed).

**[MAJOR] Plan does not commit to a `route-table.ts` entry (or `check:routes` regeneration) for `/reviewer/queue`**

`docs/ROUTES.md` is generated, not hand-written — `scripts/checks/check-routes.mjs` builds it from `src/ui/shell/route-table.ts` (SPA routes), `app.tsx`'s `isPublicPage` predicate, and `src/routes/*.route.tsx`, and diffs the result against the checked-in file; `check:routes` is a step in `pr-gate.mjs`. `/reviewer` already has a `routeTable` entry (`route-table.ts:55`) even though `AppShell.tsx` dispatches it via a hardcoded early return rather than the route switch — that's the established convention for this kind of route. The task's touchpoint list names `route-table.ts:55` and `docs/ROUTES.md:43,101`/`SITEMAP.md` explicitly, but the plan's step 4 ("Update route/shell/sign-in/landing/invite/seat/public-link/docs/speed seams") never states the concrete action of adding a `/reviewer/queue` row to `routeTable` and regenerating `docs/ROUTES.md` with `--write`. Skipping this leaves the generated docs describing only the old single `/reviewer` = "Review queue" entry, silently wrong about the split this ticket exists to make.

**Recommendation:** Add an explicit plan step: add a `reviewer-queue` entry to `routeTable` in `route-table.ts` (non-sidebar, matching `isAdminRoute`'s existing exclusion pattern for `reviewer`), then run `npm run check:routes -- --write` and commit the regenerated `docs/ROUTES.md`.

**[MINOR] `ProfileForm` is a private, unexported function in `PortalPage.tsx`**

`function ProfileForm(...)` in `src/ui/portal/PortalPage.tsx:466` has no `export`; only `PortalPage`/`SubmitterPortal` are exported (`PortalPage.tsx:984`). The plan says "Home renders... the shared profile editor" and the task description says "Reuse it or lift it into a shared component" but the plan doesn't pin down which, nor note that reuse requires exporting/relocating it first. Leaving this undecided risks an implementer copy-pasting the form under time pressure — precisely the "second profile editor" the task explicitly prohibits.

**Recommendation:** Decide in the plan: lift `ProfileForm` into a shared module (e.g. `src/ui/shell/` or a new small `profile/` module) that both `PortalPage.tsx` and the reviewer home import, rather than exporting it in place from a page-specific file.

## 4. Positive Observations

- The plan's touchpoint tracing is accurate where checked: the `AppShell.tsx:127,173` special-case dispatch for `/reviewer`, the `signin-destination.ts` role-home mapping, the demo links in `public/submission/index.html`, and the `speed.ts` check are all real and correctly identified as needing changes.
- The queue-payload extension for committee membership is sound: `reviewerQueuePayload` (`review.routes.ts:519-553`) already resolves `round.committee_id` and reviewer scopes in one place, and adding committee name/membership there is a natural, low-risk extension rather than a new endpoint.
- The decision to keep `scripts/checks/speed.ts` measuring `/reviewer/queue` rather than the new home is the right call and is stated as a deliberate decision rather than left implicit — this is exactly the kind of choice the task asked to be made "deliberately."
- Scope discipline is good: the plan does not propose a new queue/profile/identity endpoint, matches the "Do not" list, and keeps the split to routing + UI decomposition + one payload extension.
