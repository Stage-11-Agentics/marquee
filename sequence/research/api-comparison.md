# API comparison — Marquee vs Sessionboard

**Crawl date:** 2026-08-08 (live documentation, not a cached product review)

**Decision window:** before Marquee's first migration and route manifest are fixed

**Competition relevance:** [R53](competition-requirements.md#15-new-rulings--requirements-from-discord--full-brief) explicitly awards bonus points for an API and names Sessionboard's API docs as the comparator.

**Marquee baseline:** `SPEC.md` §4 and §5.13, `USER_STORIES.md` US-68/69/70 (AC-105–108, AC-138–145), `EVALUATION.md` §1.1 `check:api`, and `PHILOSOPHY.md` principle 3.

## Executive read

Sessionboard documents a very broad integration API: **177 operation blocks across 23 OpenAPI tags** in its current YAML, spanning program data, CRM-adjacent entities, agenda sandboxes, analytics, post-event media, OAuth, and early-access MCP. Marquee's planned surface is intentionally narrower but substantially deeper through the conference's operating loop: public CFP and drafts, review, bulk decisions, speaker onboarding, comms, calendar delivery, direct agenda editing and conflicts, publication, embeds, import, and Airtable mirror operations.

The comparison does **not** justify cloning Sessionboard's breadth before Wednesday. It does expose five cheap or architecture-sensitive amendments worth making now: event discovery, event people reads, least-privilege token grants, a complete file lifecycle, and a deliberately small outbound-webhook surface. The semantic contract should also pin pagination limits, conflict handling, bulk result shape, error envelopes, rate-limit headers, and generated-doc consistency before implementation fans out.

## Method and caveats

I followed the live Mintlify sidebar, its published [`llms.txt`](https://sessionboard.mintlify.app/llms.txt), the rendered [API overview](https://sessionboard.mintlify.app/api-reference/overview), and both published OpenAPI representations. The current [`openapi.yaml`](https://sessionboard.mintlify.app/api-reference/openapi.yaml) contains 177 method blocks; the current [`openapi.json`](https://sessionboard.mintlify.app/api-reference/openapi.json) contains only 18 and appears stale. The YAML is also not parseable by a standards YAML parser at the time of crawl because at least one flow mapping contains an unquoted colon (`Missing write:metadata scope`). Accordingly, endpoint inventory below uses the YAML method blocks and rendered reference together, while semantics are taken from the relevant rendered pages.

There is one other material freshness conflict: the [OAuth guide](https://sessionboard.mintlify.app/oauth) says access/refresh tokens last 1 hour/7 days and OAuth is read-only, while the newer [changelog](https://sessionboard.mintlify.app/changelog) says 24 hours/90 days and that write scopes shipped in April 2026. Treat those OAuth particulars as internally inconsistent, not as a reliable contract to copy.

## Their API, mapped

### Cross-cutting contract

- **Base and versioning.** US data uses `https://public-api.sessionboard.com`; EU data uses `https://public-api-eu.sessionboard.com`. Most resources are under `/v1`; OAuth is under `/oauth`. The spec advertises OpenAPI `3.1.0` and API version `1.0`. Two regions are explicit rather than inferred. ([Introduction](https://sessionboard.mintlify.app/introduction), [API overview](https://sessionboard.mintlify.app/api-reference/overview))
- **Authentication.** Long-lived organization tokens use `x-access-token`; OAuth access tokens use `Authorization: Bearer`. Token creation is admin-dashboard-only, the secret is shown once, and scopes are selected at issue time. The scope catalog separates domain reads (`read:events`, `read:sessions`, `read:contacts`, `read:insights`, `read:transcriptions`, `read:media`) from writes (`write:sessions`, `write:contacts`, `write:exhibitors`, `write:sponsors`, `write:fields`, `write:metadata`, `write:transcriptions`, `write:media`, `write:events`). Legacy unscoped tokens retain implicit reads but no writes. ([Authentication](https://sessionboard.mintlify.app/authentication))
- **OAuth.** Authorization code + PKCE, refresh, revocation, and RFC 8414 discovery are documented. User permission and event visibility constrain the token, and revoking AI Access takes effect on the next request. The guide and changelog disagree on lifetimes and write support, as noted above. ([OAuth guide](https://sessionboard.mintlify.app/oauth), [OAuth endpoints](https://sessionboard.mintlify.app/api-reference/overview#oauth), [changelog](https://sessionboard.mintlify.app/changelog))
- **Pagination.** Search endpoints accept `page` and `pageSize`; default 25, maximum 100. Responses carry `pagination.currentPage`, `pageSize`, `totalPages`, and `totalResults`. Some legacy routes return `results` while newer routes return `data`. ([Introduction](https://sessionboard.mintlify.app/introduction#pagination), [API overview](https://sessionboard.mintlify.app/api-reference/overview#pagination))
- **Filtering, sorting, expansion.** Many searches are `POST` requests with filters and sort objects in the body; sorts support `createdAt`/`updatedAt` ascending or descending. Reads can request `translated_fields`, `subsession_details`, `linked_sources`, and `composition`; heavy relationship joins are opt-in. Abstracts and guaranteed program sessions share one resource and are distinguished by immutable `is_abstract`. ([API overview](https://sessionboard.mintlify.app/api-reference/overview#common-patterns), [sessions and composition](https://sessionboard.mintlify.app/api-reference/sessions-composition))
- **Caching.** Session get and search may be stale for three minutes; webhook delivery is real-time and bypasses that cache. ([Introduction](https://sessionboard.mintlify.app/introduction#caching))
- **Rate limits.** Independent per-token category buckets default to 100 requests per 15 minutes. Headers are `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; a 429 also carries `Retry-After`. Several legacy search routes are currently unlimited. Bulk operations count once. Custom per-token limits are support-controlled. Entity-create docs separately state a 10,000-write daily quota per token. ([Rate limiting](https://sessionboard.mintlify.app/rate-limiting), [create session](https://sessionboard.mintlify.app/api-reference/session-writes/create-a-session))
- **Errors and concurrency.** The overview names 400/401/403/404/409/429/500. Session/contact/sponsor/exhibitor updates accept the last-seen `updated_at`; stale writes return 409. The published 429 example is `{error, message}`, but no universal machine-readable error schema is documented. ([API overview](https://sessionboard.mintlify.app/api-reference/overview#error-codes), [update session](https://sessionboard.mintlify.app/api-reference/session-writes/update-a-session))
- **Bulk writes.** Sessions, contacts, sponsors, and exhibitors accept up to 100 create/update/delete operations. Responses include a `batch_id`, per-item status/id/error, and a total/succeeded/failed summary; partial failure is representable. ([Bulk session operations](https://sessionboard.mintlify.app/api-reference/session-writes/bulk-session-operations))

### Webhooks

Webhook configuration is a dashboard surface rather than a published REST resource. The catalog has 20 events:

- Contacts: `contact.created`, `contact.updated`, `contact.deleted`, `contact.event.associated`, `contact.event.disassociated`.
- Sessions: `session.created`, `session.updated`, `session.deleted`, `session.speaker.attached`, `session.speaker.detached`.
- Exhibitors: `exhibitor.created`, `exhibitor.updated`, `exhibitor.deleted`, `exhibitor.event.associated`, `exhibitor.event.disassociated`.
- Sponsors: `sponsor.created`, `sponsor.updated`, `sponsor.deleted`, `sponsor.event.associated`, `sponsor.event.disassociated`.

Deliveries contain the full changed resource as `data` and a `metadata` object with action, actor, event, organization, direct resource URL, payload version, and UTC timestamp. Consumers are told to ignore additive fields; removals/renames bump `metadata.version`. The UI can send test payloads and inspect delivery logs; failures retry with exponential backoff. Security is only an optional operator-configured custom header—no first-class signature, delivery ID, replay window, or webhook-management API is documented. ([Webhooks](https://sessionboard.mintlify.app/webhooks))

### Endpoint inventory and Marquee coverage

`WE COVER` means Marquee's planned public API can perform the comparator operation, even when Marquee uses the organizer's vocabulary or a more workflow-oriented route. `WE LACK` means the operation is absent from `SPEC.md` §4 as written. Counts are operation blocks in Sessionboard's current published YAML.

| Sessionboard group | Their published operations | Marquee planned equivalent | Mark |
|---|---|---|---|
| Events (1) | `GET /v1/events` | Event detail exists at `GET /events/:eventId/`, and public lookup at `GET /public/events/:slug`; no authenticated collection/discovery route | **WE LACK** |
| Sessions read + write (10) | Search/list/get; create/update/custom-fields; soft-delete/restore; bulk; status search | `submissions` deliberately unifies Abstracts and guaranteed Sessions; list/detail/create/update/delete and filter-selector bulk actions cover the operating need | **WE COVER** |
| Speakers (2) | Search and get by contact ID | Public speaker by slug, `/me`, participation links, global search; no general authenticated people collection/detail contract | **WE LACK** |
| Contacts read + write (11) | Event/org search/get/session links; create/update; soft-delete/restore; bulk | Participant mutation, `/me`, global search, chase, messages; no standalone people CRUD or relationship endpoints | **WE LACK** |
| Sponsors (7) | Search/get/create/update/delete/restore/bulk | Sponsor-guaranteed talks are represented as Sessions, but sponsor CRM entities are not | **WE LACK — SKIP** |
| Exhibitors (7) | Search/get/create/update/delete/restore/bulk | None; outside Program scope | **WE LACK — SKIP** |
| Event settings reads (16) | List + paginated search for fields, tags, languages, formats, tracks, levels, rooms, statuses | Event detail returns tracks/formats/rooms; CRUD exists for tracks/rooms/formats/waves; form-field CRUD covers CFP fields. No generic tags/languages/levels/custom-status catalog | **WE COVER core / WE LACK extras** |
| Metadata writes (22) | CRUD rooms/tracks/tags/formats/levels/languages/statuses; status restore | CRUD tracks/rooms/formats/waves is planned. Missing tags/languages/levels/custom statuses is deliberate | **WE COVER core / WE LACK extras** |
| Custom field writes (3) | Create/update/delete event-module fields | Form-specific fields CRUD + reorder is more relevant to CFP construction; no event-global custom-field registry | **WE COVER CFP / WE LACK generic** |
| Agenda planning (22) | Draft CRUD; draft placements CRUD/bulk; preview/commit; scheduling rules CRUD; personas CRUD | Direct agenda item create/move/resize/delete, conflict detection, and publish. No isolated draft workspace, constraint rules, or attendee personas | **WE COVER live agenda / WE LACK sandbox** |
| Insights (28) | Event/org SbQL execute, natural-language generation, schema/suggestions, saved queries, dashboard reads | Global operational search only; no ad-hoc query language | **WE LACK — SKIP** |
| Dashboards & widgets (8) | Org convenience dashboard/widget CRUD | Marquee's Program home is a fixed operational dashboard, not user-authored analytics | **WE LACK — SKIP** |
| Reports & queries (5) | Org saved-query CRUD/run | Open exports and fixed workflow views; no report builder | **WE LACK — SKIP** |
| GDPR (2) | List/create access or erasure requests | None | **WE LACK — SKIP** |
| Transcriptions (13) | Text artifacts CRUD, composed content packs, PDFs/event report | None; post-event content/marketing scope | **WE LACK — SKIP** |
| Session recordings (4) | List/get/initiate/complete audio | None | **WE LACK — SKIP** |
| Media (5) | Multipart AV initiate/sign/abort/complete/status with auto-transcription | R2 uploads are documents/headshots/slides, not AV processing | **WE LACK — SKIP** |
| Session files (7) | List; simple upload; presign/complete; replace; metadata update; delete | Speaker presign/complete exists and admin sees the file through tasks; list/replace/delete are not explicit | **WE COVER upload / WE LACK lifecycle** |
| OAuth (4) | Authorize, token/refresh, revoke, discovery | Revocable bearer tokens, cookie auth, and magic links; no delegated OAuth | **WE LACK — DEFER** |
| MCP (27 consolidated tools, early access; not in REST count) | Read, analytics, and `manage_*` tools over the REST/insights surface, plus schema/event resources and prompts | Shipped `marquee` CLI + `SKILL.md`; no remote MCP server | **WE LACK MCP / WE COVER agent operation** |

The complete Sessionboard method/path sidebar is on its [API overview](https://sessionboard.mintlify.app/api-reference/overview); the machine inventory is in its [OpenAPI YAML](https://sessionboard.mintlify.app/api-reference/openapi.yaml). Agenda drafts expose an explicit change preview before commit. ([Preview draft changes](https://sessionboard.mintlify.app/api-reference/agenda-planning/preview-draft-changes)) Session files support both a simple 50 MB upload and a presigned 500 MB lifecycle. ([Session files](https://sessionboard.mintlify.app/api-reference/session-files)) Reports/SbQL and MCP are explicitly early access, account-manager-gated products rather than baseline API availability. ([Reports & Dashboards](https://sessionboard.mintlify.app/insights/overview), [MCP server](https://sessionboard.mintlify.app/insights/mcp-server))

### What their published API lacks and Marquee plans

These are `THEY LACK` in the published API as of the crawl, not claims that no private Sessionboard UI can do them.

| Marquee capability | Planned routes | Mark |
|---|---|---|
| Public CFP definition, conditional fields, authoritative submit validation, resumable draft | `GET /public/forms/:slug`; `POST /submissions`; `POST/PATCH /drafts` | **THEY LACK** |
| Public upload safety before a person has an account | `/public/uploads/sign|complete` with Turnstile and magic-byte enforcement | **THEY LACK** |
| Speaker self-service portal | `GET/PATCH /me`, submissions, tasks, task completion, confirm/decline | **THEY LACK** |
| Reviewer workflow, including blind payloads | queue; evaluations; comparisons; abstain | **THEY LACK** |
| Pipeline-native, filter-wide bulk disposition | `POST /submissions/bulk` with `ids` or an all-matching filter selector and accept/reject/waitlist/withdraw/promote/assign | **THEY LACK** (their generic bulk is max-100 item operations, not all-matching workflow intent) |
| Evaluation plans, rounds, criteria, committees, assignments, promotion | `/plans`, `/rounds`, `/criteria`, `/committees`, `/assignments`, `/promote` | **THEY LACK** in the published REST API |
| Speaker onboarding/chase work | task-template CRUD, speaker-task assign/list, one-query chase board | **THEY LACK** |
| Decision and chase communications | template CRUD, preview, selector send, outbox, per-person history | **THEY LACK** |
| Calendar delivery | submission invites; schedule-change notify; stable per-item ICS and event feed | **THEY LACK** |
| Direct conflict oracle and explicit public publication | agenda conflicts; agenda publish; public agenda/session/speaker/JSON/ICS/embed routes | **THEY LACK** (their API focuses on drafts and generic session publication fields) |
| Reversible Sessionize import | upload → mapping preview → run → per-row outcomes → undo | **THEY LACK** |
| Genuine Airtable operational mirror | mirror status/sync/webhook plus visible freshness and outbox depth | **THEY LACK** |
| One labelled cross-resource search | `GET /search?q=` over submissions, speakers, sessions, forms | **THEY LACK** (SbQL is broader but gated and not the same low-latency operator lookup) |
| Judge-safe demo lifecycle | demo login, magic-link reveal, atomic reset, health | **THEY LACK** |
| Open, local agent affordances | `marquee` CLI and repository `SKILL.md` | **THEY LACK**; Sessionboard's comparable is remote, early-access MCP |

Sessionboard's integration guide also advertises unauthenticated JSON/XML/HTML embed feeds refreshed every 60 minutes, Zapier beta, and filtered list exports; those are separate product surfaces, not operations in the published REST API. ([Build an Integration](https://sessionboard.mintlify.app/integrations))

## Gap calls, ranked

### Recommend before kickoff

| Rank | Gap | Competition/value call | Concrete amendment |
|---:|---|---|---|
| 1 | API tokens cannot discover the event IDs they must place in every admin URL | **R53-visible, trivial, required for a self-describing CLI/API** | Add `GET /api/v1/events` → events visible to the token, including `id`, `slug`, `name`, dates, timezone, and token role. Keep `GET/PATCH /events/:eventId/` for detail/mutation. |
| 2 | Token permissions are role-derived but no least-privilege grant is specified at issue time | **Architecture-sensitive and cheap before the first migration** | Make `POST /api/v1/org/tokens` accept `{name, scopes[], event_ids[]}`; show secret once; persist only a hash; return grants on list; revocation stays immediate. Minimum grants: `program:read`, `program:write`, `review:write`, `speaker:write`, `agenda:write`, `comms:send`, `mirror:write`. Effective authority is intersection of token grant and issuer membership. |
| 3 | General event people/speaker reads are missing | **Needed for integrations and the CLI/skill; cheap because `people` is already org-level** | Add `GET /api/v1/events/:eventId/people?q=&role=&task_status=&page=&per_page=`, `GET/PATCH /api/v1/events/:eventId/people/:personId`, and `GET .../people/:personId/submissions`. Do not add separate duplicate Speaker and Contact models. |
| 4 | File API stops at upload completion | **R2-adjacent, cheap, and avoids a visible half-API** | Normalize on `GET /api/v1/events/:eventId/submissions/:id/files`; `POST .../files/sign`; `POST .../files/complete`; `PATCH .../files/:fileId` (title/participant); `DELETE .../files/:fileId`. A replacement is a new upload version, not a bespoke byte-replace route. Keep speaker aliases under `/me`. |
| 5 | No outbound webhooks | **Best direct R53 comparator after core REST; build only after Tier A is green** | Add endpoint CRUD at `/api/v1/events/:eventId/webhook-endpoints`, `POST .../:id/test`, and `GET .../:id/deliveries`. Ship only `submission.created|updated|status_changed`, `person.updated`, `speaker_task.completed`, and `agenda.published`. Queue delivery, sign `id.timestamp.body` with HMAC, expose delivery ID/attempt/schema version, retry with backoff, and make replay idempotent. |

### Semantic amendments (no new product scope)

1. **Pin list semantics:** `page` default 1; `per_page` default 50, max 100; stable secondary sort by ULID; response `{data, page, per_page, total, total_pages}`. Keep GET query filtering rather than Sessionboard's POST-search + `/create` split.
2. **Add optimistic concurrency:** every mutable representation returns `ETag` (derived from `updated_at`); `PATCH`, `DELETE`, agenda move, and publish accept `If-Match`; stale state returns 409 with the current `ETag` and resource summary. This matters more in Marquee because agents and humans are first-class simultaneous operators.
3. **Specify one error envelope:** `{error:{code,message,field?,details?}, request_id}` for every non-2xx response. Pin 400 malformed, 401 absent/invalid credential, 403 valid-but-insufficient, 404 concealed/not found, 409 stale or lifecycle conflict, 422 valid JSON/invalid domain state, 429 limited, 500 unexpected.
4. **Specify rate-limit behavior:** authenticated token buckets by read/write/send/import; public-write buckets by IP and submission. Emit standard `RateLimit-*` plus `Retry-After` on 429. Never rate-limit internal SPA reads differently from equivalent token reads.
5. **Specify bulk results:** return a durable `operation_id`, selected count, succeeded/failed counts, per-item error only when the selector is explicit IDs, and an outbox/publication state. Do not inherit Sessionboard's hard 100-record ceiling for all-matching workflow operations.
6. **Make OpenAPI one-source:** Hono's route/schema registry generates the served JSON; YAML, docs, CLI registry, and `SKILL.md` links derive from it. `check:api` must parse both rendered artifacts, compare operation counts/hashes, fail stale examples, and print build SHA + generated time. This directly beats the comparator's current 177-vs-18 and invalid-YAML drift.

### Rightly skipped for Wednesday

1. **Sponsor/exhibitor CRM entities.** R8 explicitly says Program only. Guaranteed sponsor talks are Sessions; the CRM relationship is not needed.
2. **Languages, levels, generic tags, custom statuses, and event-global custom fields.** Tracks, formats, rooms, waves, lifecycle status, and CFP fields satisfy this conference. These can be additive later.
3. **Agenda draft workspaces, automated scheduling rules, and attendee personas.** Useful future agent-planning primitives, but they conflict with the loved direct-manipulation/instant-save contract and are not cheap.
4. **SbQL, natural-language report generation, saved reports, and custom dashboards/widgets.** Analytics/marketing breadth; a deadline trap, and Sessionboard itself gates it as early access.
5. **GDPR-request workflow API.** Important for a hosted service, not a competition-loop differentiator. Document extension points; do not fake compliance workflow.
6. **Transcriptions, recordings, AV processing, content packs, and generated PDFs.** Entirely post-event media/marketing scope.
7. **OAuth and remote MCP before Wednesday.** API tokens + CLI + shipped skill are enough to demonstrate agent-native operation without hurried auth security. Put OAuth 2.1/PKCE and a generated MCP adapter on the post-competition roadmap.

## Design wins to steal or beat

### Steal

- **One-time token reveal plus issue-time scopes.** It makes the security model legible from the token screen, not only from docs. ([Authentication](https://sessionboard.mintlify.app/authentication))
- **Optimistic concurrency with 409.** Sessionboard's `updated_at` handshake is simple and directly relevant to agent/human races. Marquee should express it with HTTP `ETag`/`If-Match`. ([Update session](https://sessionboard.mintlify.app/api-reference/session-writes/update-a-session))
- **Opt-in heavy relationships.** `expand=composition` and `subsession_details` prevent default list payloads from becoming graph dumps. Use `include=participants,scores,tasks,history` only where Marquee detail consumers need it. ([Sessions & Composition](https://sessionboard.mintlify.app/api-reference/sessions-composition))
- **Per-item bulk outcomes.** A batch ID and succeeded/failed summary make automation recoverable. Marquee should keep that visibility while allowing its stronger filter-wide selectors. ([Bulk session operations](https://sessionboard.mintlify.app/api-reference/session-writes/bulk-session-operations))
- **Webhook envelope ideas.** Full changed resource plus action, actor, event/org, resource URL, schema version, and timestamp is easy to consume; delivery logs and a test action are excellent operator affordances. ([Webhooks](https://sessionboard.mintlify.app/webhooks))
- **Context-size safety on agent tools.** Sessionboard's MCP truncates list/query results and returns `truncated`, totals, and a pagination hint. Mirror this behavior in `marquee --json` and the skill's examples. ([MCP server](https://sessionboard.mintlify.app/insights/mcp-server))
- **Two upload shapes.** Simple small-file upload plus direct-to-storage for large files is good documentation. Marquee only needs presigned upload in the product, but its docs should explain the whole state machine as clearly. ([Session files](https://sessionboard.mintlify.app/api-reference/session-files))

### Beat

- **Canonical documentation parity.** Sessionboard currently publishes invalid YAML and a stale JSON spec with radically different operation counts. Marquee's existing `check:api` should fail this class of drift before deploy.
- **Documentation truth.** Sessionboard's OAuth guide and changelog disagree on token lifetimes and write support. Marquee should generate capabilities/scopes from code and version every rendered page.
- **Conventional route grammar.** Sessionboard uses POST for searches and adds `/create` to writes, then switches back to standard POST collections for transcriptions/files. Marquee's GET lists + POST creates are easier to predict, cache, and teach.
- **Consistent nullability and envelopes.** Sessionboard documents the same unassigned nested metadata as `{}` on one search path and `null` on CRUD paths, and legacy lists alternate between `results` and `data`. Marquee should have one representation from first commit.
- **Signed webhooks by default.** Sessionboard documents optional custom headers rather than a first-class signature. Marquee should make HMAC verification, unique delivery IDs, timestamps, replay tolerance, and retry visibility part of the baseline.
- **Workflow operations, not database operations.** `accept all matching`, `publish agenda`, `send template to selector`, `undo import`, and `reset demo` map to organizer intent and preserve invariants. This is more agent-safe than making clients synthesize workflows from generic 100-item CRUD batches.
- **Open agent surface.** Sessionboard's MCP is feature-flagged early access. Marquee's CLI and `SKILL.md` ship with the open-source repo and work against any instance; keep them thin over the same schema and publish copy-paste examples beside each workflow.

## Verdict (≤10 lines)

1. Amend SPEC now with `GET /api/v1/events`, event people reads, issue-time token scopes, and full submission-file lifecycle.
2. Add a six-event signed outbound-webhook surface only after Tier A is green; it is the highest-value direct R53 comparator.
3. Pin pagination/max page size, `ETag`/`If-Match` 409s, one error envelope, standard rate-limit headers, and bulk result semantics before implementation.
4. Strengthen `check:api` so JSON/YAML/docs/CLI all derive from one route registry and operation counts/hashes must match.
5. Do not clone sponsors, exhibitors, generic metadata, agenda sandboxes, analytics, GDPR workflows, post-event media, OAuth, or MCP for Wednesday.
6. Net: **5 gaps recommended; 7 breadth families deliberately skipped.** Marquee remains narrower than Sessionboard and much more complete through the judged operating loop.

## Source ledger

Every live page consulted for this pass is linked here so the crawl is reproducible:

- [Documentation index / complete page list](https://sessionboard.mintlify.app/llms.txt)
- [Introduction: regions, pagination, caching](https://sessionboard.mintlify.app/introduction)
- [Authentication and scope catalog](https://sessionboard.mintlify.app/authentication)
- [OAuth 2.1 guide](https://sessionboard.mintlify.app/oauth)
- [Rate limiting](https://sessionboard.mintlify.app/rate-limiting)
- [Build an Integration](https://sessionboard.mintlify.app/integrations)
- [Webhooks](https://sessionboard.mintlify.app/webhooks)
- [API overview and complete rendered sidebar](https://sessionboard.mintlify.app/api-reference/overview)
- [Sessions & Composition](https://sessionboard.mintlify.app/api-reference/sessions-composition)
- [Create a session](https://sessionboard.mintlify.app/api-reference/session-writes/create-a-session)
- [Update a session](https://sessionboard.mintlify.app/api-reference/session-writes/update-a-session)
- [Bulk session operations](https://sessionboard.mintlify.app/api-reference/session-writes/bulk-session-operations)
- [Preview draft changes](https://sessionboard.mintlify.app/api-reference/agenda-planning/preview-draft-changes)
- [Session Files](https://sessionboard.mintlify.app/api-reference/session-files)
- [Reports & Dashboards](https://sessionboard.mintlify.app/insights/overview)
- [MCP Server](https://sessionboard.mintlify.app/insights/mcp-server)
- [Changelog](https://sessionboard.mintlify.app/changelog)
- [Published OpenAPI YAML](https://sessionboard.mintlify.app/api-reference/openapi.yaml)
- [Published OpenAPI JSON](https://sessionboard.mintlify.app/api-reference/openapi.json)
