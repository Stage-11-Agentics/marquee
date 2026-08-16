# MRQ-225: Announce: the ready-to-announce kit, the speaker's share link, and public pages that unfurl

## Plan-only state and signed inputs

This is the delegator's PLAN ONLY artifact for `MRQ-225`. It is intentionally
the only file changed in this phase. Feature code, contract documents, stable
US/AC allocation, migration numbering, browser approval, gates, PR creation,
and deployment are outside this cut line.

The implementation must reproduce the signed `prototypes/pipeline-v1.1`
direction at v1.17, signed at commit `390d52dc`. The binding decisions are:

- `/announce` is an index in the Public links group. Its sidebar row is
  labelled `Announce`, has no external arrow, and is not an external link.
- The organizer surface is a truthful empty state until the published agenda
  has live content. Once live, it assembles copy, public links, the existing
  embed snippet, the unfurl explanation, and speaker share links.
- The portal panel is inserted between the portal grid and `Your talks`. It
  always renders for an accepted speaker, with a prepublish state that has
  finished copy and a disabled link line; publication changes the state in
  place rather than adding or removing the panel.
- The pasted-link mock is an event-branded fallback card. A per-speaker
  rasterized social image is future work and is not promised here.
- The responsive kit uses one column below 1100px and inner stacks with
  `minmax(0, 1fr)`. No exclamation marks or decorative motion are introduced.

The exact starting base is `github/main` at
`52bb485f105e0392fe475332b87cbb48dbcee832`. The plan was authored from that
base after reading `CLAUDE.md`, `sequence/run-state.md`, `DESIGN.md`, the full
MRQ-225 ticket and comments, and the signed prototype.

## Hard dependency: MRQ-234 owns the decision-plan machinery

The expanded `Mail all their links` and per-speaker `Mail it` scope is not a
new confirmation flow. It is one more consumer of MRQ-234's read-before-send
plan contract. MRQ-225 implementation is therefore sequenced after MRQ-234
lands on `github/main`.

At planning time the MRQ-234 task is
`task_01M03Q5P7V8FT6YY4WV366F5NC`, its implementation branch is
`github/mrq-234-decision-plan`, and the observed pushed head is
`de24658bdb136287eb5725055ae64387de070dae`. That branch is not `main` and is
not a merge substitute. Before implementation begins, the owner must:

1. Wait for MRQ-234's reviewed, approved, green delivery to land on
   `github/main`.
2. Fetch and verify the new `github/main` head, then rebase this branch from
   that remote-tracking ref. Do not cherry-pick an implementation fragment or
   copy the current branch's files into MRQ-225.
3. Re-read the actual exported MRQ-234 seam at the new base. If its final
   names differ from the planning snapshot below, adapt the MRQ-225 consumer
   to the landed seam and record the mapping in the implementation comment.

The exact shared seam is the contract and its orchestration, not a second
announce-specific confirmation stack:

| Concern | MRQ-234 seam that MRQ-225 must reuse or extend in place |
| --- | --- |
| Wire shape and OpenAPI | `src/api/decision-plan.ts`: `DecisionPlanResponse` and the shared row/preview/fingerprint schema |
| Pure disposition logic | `src/jobs/cascade/decision-plan.ts`: `DecisionPlan`, four fixed disposition rows, and the pure planner seam |
| Read/apply orchestration | `src/jobs/cascade/decision-plan-service.ts`: plan construction, fingerprint/strong ETag, `requireCurrentDecisionPlan`, zero-effect refusal, and stale preflight |
| Canonical mail rendering | `src/jobs/mail/render.ts` and the existing `renderMail`/`renderAdHocMail` path; no local merge renderer |
| Queue and idempotency | `src/jobs/mail/triggers.ts`, `src/jobs/mail/outbox.ts`, and the named `IDEMPOTENCY_REGISTRY` in `src/jobs/mail/idempotency.ts` |
| Fixed plan UI | The landed shared decision-plan panel/component used by bulk, record, and Notify; do not make a bespoke `confirm()` or modal for Announce |

The implementation may add an `announce` action/recipient adapter to the
landed generic contract, or generalize the planner in those same modules, but
must not create `announce-plan.ts`, a parallel fingerprint format, a second
renderer, or a direct `/comms/send` bypass. The response must retain the
MRQ-234 semantics: bounded selection, all fixed rows present, server-rendered
preview, demo-suppression truth, disabled-template truth where applicable,
strong `If-Match` plus `plan_fingerprint`, authored stale 409, zero-effect
refusal, per-record result truth, and idempotent outbox enqueue.

The Lattice `related_to` edge from MRQ-225 to MRQ-234 is already wired to
`task_01M03Q5P7V8FT6YY4WV366F5NC`. Preserve that edge; do not mint a duplicate
relationship. MRQ-224 remains a soft adjacency for later role enrichment,
not an implementation dependency.

## Product contract

### Organizer Announce screen

Add the admin route `/announce` and the `Announce` row to the existing
`public-links` group in `src/ui/shell/route-table.ts`. The row is an internal
admin navigation index: `external` stays false/omitted, there is no arrow, and
the active state follows the route table. Mount the page in
`src/ui/shell/AppShell.tsx` using the existing event-scoped admin shell.

The page's server snapshot is event-scoped and authenticated. Prefer one
read-only endpoint, `/api/v1/events/{eventId}/announce`, backed by a query
module, so the page does not assemble contradictory counts from several
client reads. That snapshot must derive its publication gate and counts from
`readAgendaPublication()` in `src/routes/agenda.queries.ts`; it must not infer
publicness from a submission status alone. The snapshot should carry:

- event name, dates, venue, timezone, event slug, and the absolute public
  origin needed for copied links;
- `publication.live`, the public agenda URL, and the exact published session
  and speaker counts used by the copy;
- the conference site, speakers directory, and CFP URLs, with the CFP's
  actual open/closed state rather than guessed copy;
- the canonical agenda embed source/config and the snippet generated by
  `embedIframeSnippet` for the same kind and output as `/embed/config`;
- one deduplicated row per currently published speaker, with the contractual
  `/p/:slug` link, display name, an appropriate talk summary, sendability
  information, and the exact data needed by the shared mail plan.

When `publication.live === 0`, return the honest empty state: “Nothing is
public yet” (or the signed equivalent), explain that announcing an unpublished
program announces nothing, and link to the agenda builder. Do not render
placeholder counts, guessed speaker links, an embed snippet, or a mail action.
When live, render four stable content blocks matching v1.17:

1. Suggested announcement copy containing event name, dates, venue, live
   session/speaker counts, and the public agenda URL. It is editable and
   copyable, uses the product voice, and contains no exclamation marks.
2. One copy row each for the conference site, speakers directory, and CFP.
3. The canonical embed snippet with a `Configure formats` link to
   `/embed/config`; there is no second snippet generator.
4. The “How a pasted link renders” event-branded unfurl explanation and the
   published speaker share-link list. Every row has Copy and `Mail it`; the
   header has `Mail all their links`.

Rows are deduplicated by person, not by session. A speaker appearing in two
published sessions receives one contractual `/p/:slug` row and one mail-plan
recipient. A person who is only a moderator or chair remains governed by the
public participant audience predicate; do not silently broaden the speaker
audience by joining `primary_track_id` or membership alone.

### Speaker portal

Extend the authenticated speaker `portalSnapshot()` contract in
`src/routes/portal.routes.ts` with a public link field on the speaker seat's
published/accepted submission projection (or an equivalent event-scoped
speaker link field). Derive it from the same public slug/link helper used by
the public page; do not mint a token or create a portal-only permalink.

The submitter seat must remain unchanged and must not receive the announce
panel or a public speaker link. The speaker snapshot must preserve the
accepted-seat boundary and return the panel data only for the speaker's own
records.

In `src/ui/portal/PortalPage.tsx`, insert `Announce your talk` between the
portal grid and `Your talks`, matching the signed panel geometry and existing
portal-panel language. For every accepted speaker it remains mounted:

- prepublish: show the finished first-person post copy, an `Awaiting publish`
  state, and the disabled line “Your link goes live when the organizer
  publishes the schedule”; no public URL is exposed before publication;
- postpublish: show the first-person copy, the contractual `/p/:slug` URL,
  Copy the post, and View page;
- both states: explain that pasting the link produces the event share card;
  preserve a reserved layout so publication does not move the surrounding
  controls.

The public URL is live only when the underlying published agenda data says it
is live. Unpublish, withdraw, and acceptance reversal must flow through the
existing public loader and return 404 without leaking the speaker or talk
title; the portal must then return to the honest prepublish/absent-link state.

### Public unfurls and cache truth

Extend `renderPublicDocument()` in `src/routes/public-agenda.route.tsx` with a
small escaped metadata option alongside its current title/style/script options.
Keep the 404 document free of private title/description metadata. Apply the
metadata only after the corresponding public loader has returned live data.

The successful `/p/:slug`, `/s/:slug`, and `/agenda` documents emit matching
OpenGraph and Twitter card tags with absolute URLs and a static,
event-branded `og:image`. The speaker permalink's title is exactly
`<speaker name> — speaking at <event name>` and its description is derived
from the published talk titles. The session and agenda variants use their
public event/session context, with descriptions derived only from published
content; the session variant must preserve the signed unfurl hierarchy so a
pasted speaker link foregrounds the speaker name and talk. All values are
HTML-escaped and no headshot URL is used for the fallback card.

Replace `no-store` on successful public agenda, session, and speaker pages
with a short, explicit public max-age (the implementation should use the
same bounded value on all three routes, e.g. `public, max-age=300`), while
keeping 404 responses non-cacheable. Do not claim instant invalidation: the
bounded staleness is part of the contract. The static fallback asset belongs
under `public/` and its request must not be intercepted by the SPA fallback.
If a new public route or asset requires Worker precedence, update the
corresponding `wrangler.jsonc` `run_worker_first`/asset rule and add a direct
asset-route regression test. Existing `/agenda*`, `/speakers*`, `/s/*`,
`/p/*`, and `/embed/*` routing must remain intact.

The public data authority remains `src/lib/public-site.ts`:
`loadPublicAgenda`, `loadPublicSession`, `loadPublicSpeaker`, the published
session predicate, and the slug functions. Refactor/export a small link helper
if necessary so admin, portal, mail, and public routes cannot drift on slug
construction. Do not copy the public SQL predicate into the Announce page.

## Mail and merge-field contract

Add `speaker.public_link` to `MERGE_FIELDS` and the visible communication
palette in `src/lib/mail-merge-fields.ts`. It is a public content field, not a
credential, and must not be treated like `auth.link`. Add an optional public
link to `RecipientMergeContext` and populate it in `mergeDataForRecipient()`.
Migrate every relevant caller to the shared merge-data builder, including the
acceptance decision cascade and scheduled/comms preview paths currently using
inline `speaker.*` objects. The resulting acceptance and schedule mail must
resolve `{{speaker.public_link}}` through the same renderer as preview and
delivery; missing context remains visibly unresolved rather than silently
disappearing.

The Announce mail actions use an event-scoped published-speaker audience, one
recipient row per person, and the same canonical merge path. Suggested mail
copy may be ad hoc and editable, but it must be rendered by
`renderAdHocMail`/`renderMail`, validated by the shared merge-field
vocabulary, and queued through `enqueueBulkReminder` → outbox →
`enqueueMailMessage`. No browser-only `mailto:` or direct provider call is a
send.

### Exact treatment of “Mail all their links”

`Mail all their links` and a row's `Mail it` both invoke the same announce
plan/apply consumer. The only difference is selection cardinality: all
currently published speaker rows versus one person. The plan must:

- resolve and cap the selected audience using the MRQ-234 bounded-selection
  rules; never loop over unbounded rows in the Worker;
- return the same serializable plan contract, four fixed disposition rows,
  rendered recipient preview, demo-mode suppression truth, fingerprint,
  strong ETag, and plan revision/precondition fields as MRQ-234;
- classify each person using current public-link/publication and mail state,
  including no valid address, do-not-contact or otherwise unsendable rows,
  already-queued/sent idempotent work, and effective rows that will queue;
  zero rows remain visible and muted with an operator-readable reason;
- accept the `plan_fingerprint` body plus `If-Match` on apply, recompute the
  plan immediately before enqueue, return the MRQ-234 authored stale 409 when
  the selection/copy/public link/mail state changed, and refuse a zero-effect
  plan rather than reporting success;
- send only the `will_send` rows, return `outbox_ids` and per-record failures,
  and show the shared clean-toast versus skipped-result behavior; demo mode
  must say “queued/suppressed in the outbox” rather than claiming delivery;
- derive duplicate detection and retry identity from the existing outbox and
  named idempotency registry. The first identical plan must be idempotent;
  an intentional resend, if supported by the landed generic action, must use
  its explicit retry semantics rather than silently changing the initial key;
- use `speaker.public_link` in the canonical suggested message and preserve
  the public-link contract: no token, no private portal URL, and no link to an
  unpublished speaker.

The announce plan route can be an event-scoped `/announce/mail-plan` and
`/announce/mail` pair, but its response and apply semantics must be the
landed MRQ-234 decision-plan contract and its route/OpenAPI/manifest registry
must stay in parity. Do not call the existing generic `/comms/send` endpoint
from the UI as a shortcut: that would bypass the plan, fingerprint, and
precondition. The per-speaker and bulk actions must share one server service,
one plan component, one renderer, and one idempotency path.

## Implementation checkpoints after MRQ-234 lands

These are future checkpoints, not actions authorized in this plan-only phase.
Each checkpoint commits only owned paths, stages exact paths, and pushes to
`github/mrq-225-announce-kit` before moving to the next one.

1. **Rebase and seam confirmation.** Fetch `github`, verify MRQ-234 is in
   `github/main`, rebase from that remote head, inspect the final
   `DecisionPlanResponse`/service/panel exports, and record the exact
   announce-action adapter. Stop if the landed contract cannot support the
   shared mail consumer without a duplicate path.
2. **Public authority and metadata.** Add the public-link helper/query
   reuse, `renderPublicDocument` metadata option, event-branded fallback
   asset, bounded cache headers, and direct public/404/meta tests. Preserve
   the existing public loaders and Worker asset precedence.
3. **Announce read surface and admin UI.** Add the authenticated announce
   snapshot route/query, manifest/OpenAPI entries, route-table row, AppShell
   mount, page blocks, live-count gate, canonical embed snippet, copy rows,
   and published-speaker list. Add focused API and unit tests first.
4. **Portal truth.** Add the speaker-only public-link snapshot field and the
   fixed-position `Announce your talk` panel with prepublish and postpublish
   states. Add submitter-seat and acceptance/unpublish regression coverage.
5. **Merge data and shared mail plan.** Add `speaker.public_link`, migrate
   inline acceptance/schedule merge maps, implement the shared announce
   plan/apply consumer through MRQ-234's modules, and wire both Mail affordances
   to it. Add tests for four dispositions, stale/zero-effect, demo safety,
   idempotency, canonical rendering, and per-record outcomes.
6. **Parity and focused validation.** Verify route/OpenAPI/manifest/client
   parity, embed-snippet equality with `/embed/config`, public 404/title-leak
   behavior, and the full publish → Announce → portal → pasted-link path in
   tests. Request scoped browser approval before any Playwright/browser or
   computer-use run. Request a serialized gate slot from `merge-captain`
   before `npm test`/`npm run pr-gate`; no full gate is implied by this plan.

## Validation matrix

Before any full gate slot, the implementation should have focused,
non-browser evidence for:

- `readAgendaPublication().live` gating, exact live counts, no guessed
  prepublish rows, and one-row-per-person deduplication;
- route-table/AppShell reachability and authenticated event scoping, with no
  submitter-seat announce data;
- the portal panel's two states, accepted-only visibility, and recovery after
  unpublish/acceptance reversal;
- escaped OG/Twitter tags, exact speaker title, talk-title descriptions,
  absolute fallback image URL, short public cache headers, non-cacheable 404,
  and no private title leak;
- embed snippet byte equality against the canonical `/embed/config` output;
- merge-field vocabulary, acceptance/schedule mail rendering,
  `speaker.public_link` escaping, and unresolved-field truth;
- announce plan four-row truth table, bounded selection refusal, preview
  rendering, fingerprint/ETag/If-Match 400/409/positive paths, zero-effect
  refusal, demo suppression, duplicate identity, and per-record results;
- the shared bulk and single-speaker mail actions producing the same plan
  shape and queue path, with no direct `/comms/send` or provider bypass;
- API route/OpenAPI/manifest/client registry parity and focused route tests.

The signed browser proof remains held because browser scope is unapproved.
Do not run it, computer-use, live/provider actions, or deployment in this
phase. The eventual end-to-end proof should publish a seeded schedule, verify
all four Announce blocks, exercise both mail selection sizes, verify both
portal states, fetch public metadata/cache headers, and confirm an unpublished
speaker returns 404 without title leakage.

## Contract, migration, and cut line

Trace the work to R2 and R17, with US-39/US-57/US-58 adjacency and inherited
AC-84/AC-85/AC-86/AC-122 behavior. Do not mint new stable IDs in this plan,
edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `USER_STORIES.md`,
`DESIGN.md`, or assign a migration number. The eventual contract fold owns
the new Announce criteria, claims manifest, and route documentation after the
current next-mint is rechecked at consolidation.

The plan-only completion boundary is: this plan exists byte-identically in
the authoritative board and this linked branch, the plan commit is pushed,
local and remote heads match exactly, the tree is clean, and the task is
handed to the orchestrator for a non-author plan review. Do not mark
implementation complete, open a PR, merge, deploy, publish, or run a full
gate from this assignment.
