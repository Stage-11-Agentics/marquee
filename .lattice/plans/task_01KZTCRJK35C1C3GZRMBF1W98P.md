# MRQ-121: Public speaker directory

## Scope and success

Ship the fifth enumerable public surface described by T-I2 / register row 36:

- Add an SSR `/speakers` page using `PublicShell`, with a responsive card grid showing each published speaker's name, title/company, and the shared `headshotUrl` avatar when present with an initials fallback. Cards link directly to the existing `/p/:slug` profile (with the event query preserved for multi-event correctness).
- Add a GET `q` search control whose server-side directory query matches published speaker name/company only. Preserve the selected event and show truthful empty states for no published speakers versus no search matches.
- Turn both speaker embed layouts into real anchors to the existing speaker profile route, preserving the embed event in the link.

The page is anonymous and published-only, deduplicates people who speak in multiple sessions, and does not expose private/unpublished speakers. MRQ-122 owns the shared `headshotUrl` producer and synthetic assets; MRQ-121 owns this card markup and keeps the honest initials fallback. EMB-13 gets the existing back navigation rather than a modal.

## Implementation plan

1. Extend `src/lib/public-site.ts` with a directory data shape and loader that reuses the published agenda/session projection, adds a speaker-only search predicate on the existing `sessionRowsQuery`, deduplicates by person id, and sorts by speaker name. Keep the existing agenda search semantics unchanged.
2. Add the `/speakers` route in `src/routes/public-agenda.route.tsx`, passing `event`/`event_slug` and `q`, using the shared public document/404 shell.
3. Add the directory page and small responsive card-grid styles in `src/ui/public/agenda/PublicAgendaPage.tsx`; use stable card/avatar dimensions, render `headshotUrl` with an initials fallback, visible labels, resettable GET search, and links to `/p/:slug?event=...`.
4. Update `src/ui/embeds/EmbedPage.tsx` so both card and list speaker renderers use real profile anchors and add event-aware link construction; keep the existing layout/filter behavior.
5. Add focused integration coverage to the existing public-site fixture for `/speakers`, name/company filtering, published-only privacy, multi-session dedupe, event-preserving profile links, and both embed link layouts.

## Verification

- Target only the touched public-site integration test and any directly relevant type/build checks; never run the full `npm test` in this fleet.
- At `in_validation`, run the Worker locally and curl the real anonymous `/speakers`, filtered `/speakers?q=...`, `/p/:slug`, and speaker-embed flows, recording status/body evidence. No browser validation is required for this SSR/link-focused change.
- Before the PR, check load with `uptime`; if 1-minute load exceeds 24, wait 2–3 minutes before `npm run pr-gate -- --ticket MRQ-121`. Paste the gate result into the completion comment and stop at `pr_open`.

## Plan-review Cycle 1 Resolutions (AUTHORITATIVE)

- Privacy: the loader's SQL remains scoped to live events, published agenda items, public participant audience, and non-rejected/non-withdrawn sessions; no person-table-only enumeration is introduced.
- Search honesty: directory `q` uses only the existing speaker name/company branch, so a title/abstract match cannot surface an unrelated speaker. Empty search results retain a one-click event-preserving reset.
- Correctness: deduplicate on stable speaker id before rendering; include `event` in every new directory/embed profile link so two live events cannot silently resolve a profile from the default event.
- Scope: no modal, headshot seeding, image route, public API endpoint, or organizer navigation is added; MRQ-122 owns the headshot producer/assets while this ticket consumes its projection field.

## Reset 2026-08-12 by agent:delegator-mrq-121

## Reset 2026-08-12 by agent:delegator-mrq-121
