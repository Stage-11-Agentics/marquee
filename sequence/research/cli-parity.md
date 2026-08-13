# CLI parity — is Marquee actually agent-native?

*Read of `github/main` @ `06977f4`, 2026-08-12. Read-only analysis; nothing was built or run.*

## The three-sentence answer

**A CLI exists and a `SKILL.md` exists**, both real and both tested — `cli/marquee.mjs` ships
11 commands over a scoped bearer token, and the repo-root `SKILL.md` is generated from the same
command registry so the two can never drift. **It is not at parity with the web: the CLI reaches
11 of the API's 133 operations (8%), covering roughly 3 of the 11 walkthrough-loop steps** —
triage, chase, and an agenda read — while form building, evaluation setup, reviewing, agenda
placement, publishing, settings, imports, tokens, venues and the speaker portal have no command
at all. **But the expensive half of "agent-native" is already done and it is the half nobody
would want to retrofit**: every single path the web UI calls is a documented, token-authenticated
`/api/v1` operation, so there is *no web-only capability anywhere in the product* — closing the
gap is writing CLI verbs over an API that already answers, roughly **one to two days** for full
loop coverage and about **half a day** for the four commands that actually matter.

---

## 1. What exists today

| Artifact | Status | What it is |
|---|---|---|
| `cli/marquee.mjs` | **Real CLI.** 305 lines, no dependencies. | Argv parser → command registry → `MarqueeClient` (bearer fetch) → JSON/CSV stdout. Not a code generator, not an aspiration. |
| `cli/registry.mjs` | **The single source of command truth.** | 11 commands, each with `usage`, `summary`, `options`, and the API `operations` it calls. Help text, dispatch, and `SKILL.md` all render from this table. |
| `cli/client.mjs` | Dependency-free HTTP client. | `MarqueeClient.request(path, {method, query, body})` with `get`/`post` sugar. Arbitrary methods work; there are no `patch`/`put`/`delete` helpers and **no ETag/`If-Match` handling**. |
| `cli/api-registry.json` | **Parity artifact, not a command registry.** | A frozen list of all 133 served OpenAPI operations plus the document SHA-256. `npm run check:api` fails if it drifts from the served `/api/openapi.json`. It asserts the API surface is pinned — it does **not** assert the CLI covers it. |
| `cli/generate-api-registry.mjs` | Regenerates the above from the built Worker. | |
| `SKILL.md` (repo root) | **Real, generated, tested.** | 102 lines. Six workflows — Seed, Triage, Chase, Agenda, Publish, Diagnose — each with runnable commands. `cli/generate-skill.mjs --check` fails the build if `SKILL.md` is hand-edited out of sync with the registry. Honest about its own gaps: Agenda and Publish are documented as raw `curl`, because no command exists. |
| `AGENTS.md` | **Absent.** | |
| MCP server | **Absent.** No MCP surface anywhere in the tree. | |
| `npm bin` entry | **Absent.** | Invocation is `node cli/marquee.mjs …`, not an installed `marquee`. AC-141 says `marquee --help`; the shipped ergonomics are one `"bin"` line short of that. |

### The 11 commands

`event seed` · `event show` · `submissions list` · `submissions show` · `submissions accept` ·
`submissions reject` · `tasks list` · `remind` · `agenda export` · `diagnose` · `logs --tail`

Global options `--url` / `--token` (or `MARQUEE_URL` / `MARQUEE_TOKEN`), `--json`, `--help`.
`logs` is the one command with no API operation behind it — it reads the platform's own log
stream, so it is the only place the CLI does something the web cannot.

### Auth is not a constraint

`securityFor()` in `src/api/route.ts` emits **both** `cookieAuth` and `bearerAuth` for every
non-public route. There is no cookie-only endpoint. A scoped token with the right grants
(`program:read`, `program:write`, `review:write`, `speaker:write`, `agenda:write`, `comms:send`,
`mirror:write`) can call anything the browser can, and tokens are mintable over the API itself
(`POST /api/v1/org/tokens`). This is the load-bearing fact behind everything below.

---

## 2. The parity matrix

Verdicts are **against the API and CLI both**. There is no WEB ONLY row, because there is no
web-only capability: every `/api/v1/...` string referenced anywhere under `src/ui/**` resolves to
an operation in the served OpenAPI document. The gap is uniformly CLI-shaped.

| Loop step / surface | Web route | API operations | CLI command | Verdict |
|---|---|---|---|---|
| **1 · Land & self-serve** | `/` landing, demo login | `demoLogin`, `enqueueDemoReset`, `getDemoResetJob` | `event seed` | **FULL PARITY** |
| **2 · Configure the event** | `/settings` | `updateEventSettings`, formats CRUD ×3, tracks CRUD ×3 | `event show` (read only) | **PARTIAL** — no `event set`, no `tracks`/`formats` verbs |
| 2b · Rooms & venues | `/settings/venues` | `listVenues`, `saveVenues` | — | **API ONLY** |
| **3 · Program dashboard** | `/dashboard`, `/board` | `getProgramDashboard`, `listProgramBoard` | — | **API ONLY** |
| **4 · Build the CFP form** | `/forms` | 14 ops: form CRUD, field CRUD, `reorderFormFields`, `publishEventForm`, `closeEventForm`, `reopenEventForm`, `duplicateEventForm`, form-admin CRUD | — | **API ONLY** |
| **5 · Submit from incognito** | `/f/{slug}` public form | `getPublicForm`, `submitPublicForm`, draft create/autosave, `signPublicUpload`, `completePublicUpload` | — | **API ONLY** |
| **6 · Speaker portal** | `/portal` | `getSpeakerPortal`, `updateSpeakerProfile`, `updateSpeakerTalk`, `completeSpeakerTask`, confirm/decline participation, task uploads, co-speaker ×2 | — | **API ONLY** |
| **7 · Evaluation plan & committee** | `/evaluation` | 10 ops: plan CRUD, `createEvaluationCommittee`, `addCommitteeReviewer`, reviewer track scopes ×2, `createEvaluationRound`, `updateEvaluationRound`, `replaceEvaluationCriteria`, `distributeEvaluationAssignments`, `removeRoundAssignment` | — | **API ONLY** |
| **8 · Work the review queue** | `/reviewer` | `getReviewerQueue`, `getReviewerQueueContext`, `getReviewerSubmission`, `writeReviewerEvaluation`, comparisons ×3, `exportReviewerQueue`, `promoteEvaluationSubmissions` | — | **API ONLY** |
| **9 · Accept & push to agenda** | `/submissions?status=…`, `/submissions/:id` | `listEventSubmissions`, `getSubmissionRecord`, `bulkDecideSubmissions`, `decideSubmission`, `publishSubmission`, `scheduleSubmission`, reversal ×2, `notifyDecidedSubmissions` | `submissions list` / `show` / `accept` / `reject` | **PARTIAL** — list, read and bulk decide are at full filter parity; single decide, schedule, publish, reverse, notify are API-only |
| **10 · Build the agenda** | `/agenda-builder` | `getAgenda`, `placeAgendaItem`, `updateAgendaItem`, `removeAgendaItem`, `updateAgendaSettings` | `agenda export` (read only) | **PARTIAL** — no write verb |
| **11 · Publish & embed** | `/agenda` public site, embeds | `publishSubmission`, `getPublicAgenda`, `getPublicSession`, `getPublicSpeaker`, `getPublicEmbed` | — | **API ONLY** |
| Chase / onboarding | `/onboarding` | `getOnboardingBoard`, `getOnboardingSpeaker` | `tasks list --overdue` | **FULL PARITY** (read side; there is no task-mutation API either) |
| Communications | `/communications` | `listCommunicationAudience`, `previewCommunication`, `sendCommunication`, template CRUD ×3, `listOutbox`, `listPersonMessages` | `remind` (send only) | **PARTIAL** — send has full selector parity; audience preview, message preview and templates are API-only |
| Delivery health | `/delivery-health` | `getDeliveryHealth` | — | **API ONLY** (`diagnose` is infrastructure probes, a different thing) |
| Sessionize import | `/import` | `createSessionizeImport`, `mapSessionizeImport`, `runSessionizeImport`, `undoSessionizeImport` | — | **API ONLY** |
| Saved views | list toolbar | saved-view CRUD ×4 | — | **API ONLY** |
| Quick search | ⌘K overlay | `searchEvent` | — | **API ONLY** |
| Task templates | `/settings/tasks` | `listTaskTemplates`, `updateTaskTemplate` | — | **API ONLY** |
| API tokens | `/settings/api` | `listApiTokens`, `createApiToken`, `revokeApiToken` | — | **API ONLY** |
| Calendar invites | record actions | `sendSubmissionCalendarInvites` | — | **API ONLY** |
| Manual submission entry | `/submissions/new` | `createAdminSubmission` | — | **API ONLY** |
| Diagnostics | — | `getDiagnostics` | `diagnose`, `diagnose --bundle` | **FULL PARITY** |
| Structured logs | — | *(none — platform stream)* | `logs --tail` | **CLI ONLY** |

**Counts.** 133 API operations, 81 of them writes. The CLI touches 11 distinct operations —
`enqueueDemoReset`, `getDemoResetJob`, `getCurrentAuth`, `getEventSettings`,
`listEventSubmissions`, `getSubmissionRecord`, `bulkDecideSubmissions`, `getOnboardingBoard`,
`sendCommunication`, `getAgenda`, `getDiagnostics`. Two of its verbs are writes.

**Where parity is genuinely complete, it is complete properly.** `submissions list`'s
`--filter` allowlist (`kind, status, track, format, wave, task, placement, q`) is character-for-character
`submissionFilterSchema` in `src/routes/submissions.queries.ts` — the exact set the UI list uses,
plus `--page`, `--per-page`, `--sort`. `remind`'s selector keys are exactly `reminderSelectorSchema`
in `src/routes/comms.routes.ts`. `submissions accept --filter` posts a server-side selector to
`bulkDecideSubmissions` rather than expanding a page into a guessed ID set. This is a CLI built by
someone who understood the API, not a wrapper bolted on afterward.

---

## 3. The honest gap

**The claim in `PHILOSOPHY.md` §3 has three bullets. Two are true and one is overstated.**

- *"A real API — the UI is built on it; nothing is UI-only."* — **True, and verifiable.** Every
  UI-referenced endpoint is in the OpenAPI document; `check:api` pins the document by hash against
  `cli/api-registry.json`; auth accepts a bearer token on every non-public route. This is the
  strongest form of the claim and the product actually holds it.
- *"A skill file … teaching any coding agent how to operate a conference."* — **True.** It ships,
  it is generated, it is tested, and it covers seed → triage → chase → agenda → publish → diagnose.
- *"A CLI — **every workflow** drivable from a terminal, scriptable, composable."* — **Overstated.**
  Six of the eleven workflow families have no command. As written, that bullet is a description of
  something that does not exist yet. It should read "the core operating loop — triage, chase,
  agenda export, diagnostics — with the full API behind everything else," or the commands should
  be built.

### Which missing commands matter, and which do not

**Matter — these are the agent's daily verbs:**

| Gap | Why it matters |
|---|---|
| **`agenda place` / `agenda move`** | Step 10 is the second half of the product's whole pitch (accept → schedule with no re-entry). An agent that can read the agenda but not write it can't finish the loop. `SKILL.md` papers over this with a raw `curl` — which works, and which is exactly the seam a reader notices. |
| **`submissions schedule` / `publish` / `decide`** | Single-record decisions are the granular case; bulk-only is a real limitation when an agent is acting per-submission. Both are already `curl`-documented in `SKILL.md`, which is the tell. |
| **`review` verbs** (`queue`, `evaluate`, `promote`) | Step 8 is where an agent is most obviously useful — first-pass scoring at scale is the AI-Engineer-judge-shaped use case, and it is entirely browser-bound today. |
| **`event set` / `tracks` / `formats`** | Step 2. Without it an agent cannot stand up a conference from zero; it can only operate one someone else configured. |
| **`search`** | One operation, huge leverage: it is how an agent resolves a human's "the LLM-evals talk" into an ID without paginating. |

**Do not matter (or matter much less):**

| Gap | Why it is fine |
|---|---|
| **Agenda drag-to-place UI** | The *gesture* is legitimately visual. The *operation* underneath (`placeAgendaItem`) is not, and is already exposed. There is nothing to add beyond a CLI verb — the visual surface is not the capability. |
| **Form builder** | Genuinely a design surface. An agent scripting 14 field-CRUD calls is worse than an organizer dragging fields. Leave it to the API for the scripted-setup case and don't build verbs. |
| **Venue map / geometry** | Spatial editing is spatial. API is the right and sufficient level. |
| **Dashboard, board, delivery health** | Read-only visual aggregations. `--json` over the API is already the agent's version; a CLI verb would just be `curl` with fewer characters. Cheap if wanted, no loss if not. |
| **Speaker portal** | The portal is the *speaker's* surface, not the operator's. An agent driving it is a test fixture, not a workflow. The API covers it for exactly that purpose. |
| **Embeds, saved views, task templates, tokens** | Configuration done once. API is fine. |
| **Public form submission** | Only interesting as a test path, and already reachable. Note one caveat: `submitPublicForm` enforces Turnstile when `TURNSTILE_SECRET_KEY` is set, with an explicit demo exemption — a headless submit against a Turnstile-enabled production instance needs a token the agent cannot mint. |

---

## 4. Cost to close

**Say this loudly: the API layer already covers 100% of it.** Every gap above is a dispatch branch
over an endpoint that already answers, already authenticates by bearer token, already validates,
already returns JSON. No new routes, no new auth work, no schema changes. The shape of the work is
*adding rows to `cli/registry.mjs` and branches to `execute()` in `cli/marquee.mjs`*, then running
`node cli/generate-skill.mjs` so `SKILL.md` regenerates itself.

Per-command cost is roughly one registry entry (~10 lines) plus one `execute()` branch (~8 lines).

| Work | Size | Shape |
|---|---|---|
| **Add `"bin": {"marquee": "cli/marquee.mjs"}`** | **Trivial** (minutes) | One line in `package.json` plus a shebang that already exists. Turns `node cli/marquee.mjs` into `marquee` and satisfies AC-141 as literally written. |
| **The four verbs that matter most**: `submissions schedule`, `submissions publish`, `agenda place`, `search` | **Small — half a day** | Four registry entries, four branches, regenerate `SKILL.md`, extend `tests/node/cli.AC-138-141-250.test.mjs`. Removes both raw-`curl` blocks from `SKILL.md`. |
| **Event configuration**: `event set`, `tracks list/add/remove`, `formats list/add/remove` | **Small — half a day** | Needs a `--set key=value` convention and `patch`/`delete` helpers on `MarqueeClient` (~15 lines). Straightforward. |
| **Review verbs**: `review queue`, `review evaluate`, `review promote`, `review assign` | **Medium — most of a day** | Four to six branches; the only real design question is how a criteria-scored evaluation body is expressed on a command line (probably `--score criterion=value`, repeated). |
| **Agenda writes with concurrency**: `agenda move`, `agenda remove` | **Small, with one wrinkle** | `updateAgendaItem` and `removeAgendaItem` are the **only two `if-match` routes in the product**. `MarqueeClient` neither reads ETags nor sends `If-Match`, so this needs a read-then-write helper — perhaps 20 lines. Do it once and it is done. |
| **Forms, imports, venues, tokens, views, templates** | **Medium — a day, and mostly not worth it** | Mechanical but broad. Recommend building only `forms list`/`publish`/`close` and skipping the field-level builder entirely. |
| **Full 133-operation coverage** | **Large — multi-day, and the wrong goal** | A generated-from-OpenAPI passthrough (`marquee api <operationId> --param …`) would get there in a day and would be worse than 20 hand-written verbs. Hand-write the loop; leave the long tail to `curl` and the documented schema. |

**Recommended cut: about one day.** `bin` entry + the four verbs + event configuration + agenda
writes. That takes the CLI from 3 of 11 loop steps to roughly 9 of 11, removes every `curl` block
from `SKILL.md`, and makes the philosophy bullet true without building a second, worse copy of the
form builder.

---

## 5. Can an agent drive the 11-step loop headlessly?

**Over the API: yes, all eleven steps, today.** Every step maps to a documented,
bearer-authenticated operation:

| Step | Reachable headlessly | How |
|---|---|---|
| 1 Land & self-serve | ✅ | `POST /api/v1/auth/demo`, or a scoped token |
| 2 Configure the event | ✅ | `PATCH /events/{id}`, tracks/formats CRUD, `PUT /venues` (buildings **and** rooms) |
| 3 Dashboard | ✅ | `GET /events/{id}/dashboard` |
| 4 Build the CFP form | ✅ | form + field CRUD, `reorderFormFields`, `publishEventForm` |
| 5 Submit from incognito | ✅ *with a caveat* | `POST /public/forms/{slug}/submissions`; Turnstile applies when configured, exempt in demo |
| 6 Speaker portal | ✅ | `POST /auth/magic-link` → `GET /auth/exchange` → `GET /me/portal` and the `/me/*` writes |
| 7 Evaluation plan & committee | ✅ | plan → committee → reviewers → round → criteria → `distributeEvaluationAssignments` |
| 8 Work the review queue | ✅ | `getReviewerQueue`, `writeReviewerEvaluation`, comparisons |
| 9 Accept & push to agenda | ✅ | `bulkDecideSubmissions` or `decideSubmission` |
| 10 Build the agenda | ✅ | `placeAgendaItem`; `updateAgendaItem` needs `If-Match` |
| 11 Publish & embed | ✅ | `publishSubmission`, `GET /public/agenda`, `GET /public/embeds/{slug}` |

**Over the CLI alone: no.** Steps 2, 4, 5, 6, 7, 8, 10 and 11 have no command. An agent handed
only `SKILL.md` reaches seed → triage → accept → *(curl)* schedule → *(curl)* publish. That is the
exact sequence `EVALUATION.md` gate 12 names — and `SKILL.md` gets there honestly, by printing
`curl` where it has no verb.

**Two gate stubs bear on this and should be read as open, not passing:**

- **Gate 12 · `npm run check:skill-agent`** — still `scripts/checks/stub-command.mjs`, owner MRQ-44,
  reason *"SKILL, CLI, and isolated agent runner are not implemented."* The SKILL and CLI halves
  now exist; the **isolated agent runner does not**, so AC-145 ("an agent given only `SKILL.md`
  and a running instance completes seed → triage → accept → schedule with no further instruction")
  has never actually been executed. It is very likely to pass — but it is unproven, and it is the
  one criterion that tests the agent-native claim as a claim rather than as an inventory.
- **`npm run e2e`** — also a stub, owner MRQ-50, *"the deployed 11-step Playwright loop has not
  landed."* `playwright.config.ts` exists; `tests/e2e/` does not. So the loop is not driven
  headlessly through the browser either, by any harness.

---

## Verdict

Marquee's agent-native claim is **substantially true at the layer that is expensive to retrofit
and overstated at the layer that is cheap to finish.** The API is genuinely universal — no
capability hides behind the browser, tokens work everywhere, the schema is pinned by a check.
That is the hard, structural half, and it was built correctly from the first commit exactly as
US-68's sequencing note argued it had to be.

The CLI is a well-made 8% slice. It is not a wrapper someone generated; the filter allowlists
match the server schemas exactly and the bulk path resolves selectors server-side. It just stops
after triage and chase. One day of work over an API that already answers takes it to nine of the
eleven loop steps.

Until then, the accurate sentence is: *"anything a human can do, a program can do — over the API.
The CLI covers the operating loop."*
