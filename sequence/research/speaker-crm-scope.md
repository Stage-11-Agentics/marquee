# Minimum-viable Speaker CRM — scope, cost, and verdict

**Question asked:** what does the smallest Speaker CRM look like that actually captures the eval kit's
extra-credit area, agent-optimized and modern, and what does it cost?

**Answer up front:** the area is cheaper to build than it looks — roughly two-thirds of it falls out of
`people` + the comms stack + the importer we already have — but **it is worth exactly zero points on the
kit's headline score**, because `buildReport()` drops optional areas before computing `overallPct`.
Recommendation is **skip**, with two free actions to keep the door open. The arithmetic is in §5.

Sources read: `.eval-kit/specs/07-speaker-crm.yaml`, `.eval-kit/docs/07-speaker-crm.md`,
`.eval-kit/src/{report,specs,cli,config}.ts`, `.eval-kit/evalconfig{,.example}.json`,
`sequence/EVAL-KIT.md`, `PHILOSOPHY.md`, and `github/main @ 4b2dc09` via the read-only worktree.

---

## 0. The finding that decides it

Two facts from the kit's own code, not from the docs:

```ts
// .eval-kit/src/report.ts:166-167 (and again at :305-309 in finalize)
const required = areas.filter((a) => !a.optional);
const { pct: overallPct, coveragePct: coverage } = aggregate(required);
```

1. **Optional areas are excluded from `overallPct`, `overallCoveragePct`, and `byType`.** The CRM renders
   as one extra row in the area table with its weight column printed as `—` (`report.ts:377`) and its own
   per-item section. It moves no number. The `area_weight: 10` in the spec is currently inert — nothing
   multiplies by it.
2. **The area does not run by default.** `includeOptional: false` in `evalconfig.example.json` (the file a
   grader starts from), and `specs.ts:144` filters optional specs out unless `--include-optional` is passed.
   Absent that flag, the CRM scenarios never execute.

Corollary that kills the usual counter-argument: **there is no coverage-cliff exposure.** Because
`aggregate()` receives only required areas, an unbuilt CRM cannot drag coverage toward the 60% withholding
threshold. This is the one area of the kit where "didn't build it" is genuinely free.

The kit is young (pinned at `2b0f795`, one commit) and swyx is still editing it, so this could change. §5
carries the hypothetical arithmetic and §6 the exact reopen trigger.

---

## 1. Per-item register (all 12, 19 weighted points)

`min capability` = the least thing that earns a **pass**, read against the item's own `pass_criteria`, not
against SessionBoard's feature. `(a)` near-free off a person-centric roster · `(b)` needs its own build ·
`(c)` skip.

| ID | w | type | Pass criterion, one line | Minimum capability that scores it | Verdict |
|---|--:|---|---|---|---|
| **CRM-01** | **3** | exists | Cross-event contact area at org level, table with name+email, search narrows and clears | A `/crm` route outside the conference nav, listing `people` rows (org-scoped already), server-side `q` search. **Fails outright if the only speaker list is per-event** — a `/speakers` roster alone scores 0 here | **(a)** |
| **CRM-02** | 2 | rule | Attribute filter beyond text search narrows consistently; clearable | One `company`/`title`/`tag` filter with visible chips + Clear all. Second filter is "stronger evidence", not required | **(a)** |
| **CRM-03** | 2 | roundtrip | Profile with identity + a note that survives reload + ≥1 history surface | Profile view over `people` fields; **new `person_notes` table**; connections list from `participations` (already cross-event) *or* activity from `audit_log`/`outbox`. Notes-only = partial (0.5) | **(a)** + small **(b)** |
| **CRM-04** | 1 | depth | Custom field *or* tag persists on a profile | **Tags satisfy this explicitly.** `person_tags` table + a tag input. Full field-definition UI is bonus evidence only — do not build it | **(a)** + small **(b)** |
| **CRM-05** | 2 | bulk | CSV upload completes; rows appear in the directory | Generalize the existing Sessionize importer to a contacts-only CSV path. Mapping/validation UI already exists and already flags `missing[]` columns | **(a)**, reuse |
| **CRM-06** | 1 | depth | Same-name/different-email duplicate surfaced and mergeable into one primary | Duplicate banner on name collision + a merge that re-points FKs. Cheap to *show*, expensive to do correctly (see §2 warning) | **(b)**, risky |
| **CRM-07** | 2 | crud | Kanban ≥4–5 named stages incl. terminal won/lost; enroll; move; **persists across reload** | Three new tables and a board page. Nothing existing to lean on | **(b)** |
| **CRM-08** | 1 | depth | Card detail: note persists across reload + timestamped stage transitions | Rides CRM-07's tables; the transition log is an insert-per-move | **(b)**, rides 07 |
| **CRM-09** | 1 | depth | Filtered view saved as named segment, reopens with members | `person_segments` mirroring the `saved_views` pattern. Dynamic-vs-curated choice is bonus, ~free to offer | **(a)** by analogy |
| **CRM-10** | 2 | handoff | Add-to-event action + event picker targeting "DevFlow Conf 2027"; contact appears in that event's speaker list with data intact | An `+ Add to event` action writing `memberships`/`participations`. **Blocked in spirit by single-event:** the shell hardcodes `evt_aie-ny-2026` in 17 files and there is no conference-creation route. A one-option picker plus the agent's own rename of the conference is a credible **partial**, an honest pass only with multi-event | **(b)**, gated |
| **CRM-11** | 1 | bulk (**auto-partial**) | Select 2+ → composer → send → in-app success or logged send | **Nearly free.** `/comms/send` already accepts a `person_ids` selector with a `canAddressPersonOnly` path (`comms.routes.ts:432`), `/comms/preview` renders `{{speaker.first_name}}`, and `outbox` + `listOutbox` is the sent-history log. Needs a directory-side entry point only | **(a)**, reuse |
| **CRM-12** | 1 | depth | KPI counts consistent with the directory + ≥1 populated analytics widget | `SELECT count(*)` + `GROUP BY company` over `people`. One bar list satisfies "at least one widget renders with data" | **(a)** |

**Manual-half items: exactly one.** `CRM-11` is the only `auto-partial` in the area; the other eleven are
`auto` and fully closable by the browser agent. Its manual half is a real-inbox delivery check
(mailinator-style address, subject match, `{{first_name}}` resolved). Note how the kit handles it: the auto
verdict is scored immediately and the manual check is *queued additionally* (`report.ts:93-95`), so an
unfinalized run keeps the auto verdict. We are not exposed to an ungraded half here.

**Scenario-shape risks worth pricing in, independent of features:**

- Both scenarios reload the page and re-screenshot to test persistence — CRM-03, CRM-07, CRM-08 each check
  it explicitly. Run 1's `Draft saved locally · just now` defect (client-only indicator, server never
  wrote) is exactly the failure mode this rubric is built to catch. Any CRM state must be server-persisted
  from the first commit.
- CRM-S1 is 11 steps and CRM-S2 is 9, both against a **70-turn cap** that ate all four CFP scenarios in run
  1. A CRM that scores every item on paper but takes three extra clicks per step will still lose the tail
  items to the cap — the same shape that put `rule` at 0% coverage in run 1.

---

## 2. Data-model delta

### What already carries the load

`people` is the single most important fact here: **it is org-scoped, not event-scoped**, with
`uq_people_org_email` and `idx_people_org_name` already in place, and the seed populates roughly **1,100
rows** (153 real accepted-speaker identities plus the ~940-person synthetic submitter pool from
`scripts/seed/pool.ts`). A directory over `people` is *filled on day one* — which matters, because the kit
grades filled-state and explicitly rewards it.

| CRM need | Already on `main` | Gap |
|---|---|---|
| Cross-event person record | `people(org_id, email, name, title, company, bio, headshot_attachment_id, social_links)` | none |
| Cross-event connections | `participations` (person→submission, 6 roles) + `memberships` (person→org/event, 5 roles) | none — this *is* CRM-03's history surface |
| Activity/history feed | `audit_log` (append-only, actor+entity), `outbox` (per-person sends), `GET /events/{id}/people/{personId}/messages` | event-scoped (see warning) |
| Files panel | `attachments` (polymorphic `owner_type`/`owner_id`, incl. `person_headshot`) | event-scoped |
| Bulk email + preview + history | `/comms/audience`, `/comms/preview`, `/comms/send` with `person_ids` + `recipient_pairs`, `{{...}}` merge in `render.ts`, `outbox`/`listOutbox` | directory-side entry point only |
| CSV import w/ mapping, flagged rows, undo | `imports`/`import_rows`, `POST /events/{id}/imports`, `manifestPreview` returning `missing[]` | requires *both* `sessions_csv` and `speakers_csv`; needs a contacts-only mode |
| Saved-view pattern | `saved_views` + `normalizeSavedViewConfig` | submission-shaped; needs a people-shaped sibling |
| Person-row list query | `getOnboardingBoard` already returns per-person rows with sessions, tasks, `last_contact` | scoped to one event's accepted speakers |

### Smallest schema addition

**Band A (directory layer) — 4 new tables, zero column changes to `people`:**

```
person_notes            (id, org_id, person_id →people, author_person_id, body, created_at, updated_at)
person_tags             (id, org_id, person_id →people, tag, created_at)            -- UNIQUE(person_id, tag)
person_segments         (id, org_id, name, kind 'dynamic'|'curated', config_json, created_at, updated_at)
person_segment_members  (segment_id, person_id)                                     -- curated kind only
```

**Band B (pipeline) — 3 more:**

```
pipeline_stages      (id, org_id, name, kind 'open'|'won'|'nurture'|'lost', position)
pipeline_cards       (id, org_id, person_id →people, stage_id, score, rationale, created_at, updated_at)
pipeline_card_events (id, card_id, from_stage_id, to_stage_id, actor_person_id, created_at)
```

Card notes reuse `person_notes` with a nullable `card_id` rather than a second notes table.

**Nothing needs adding to `people` itself.** CRM-12's "speaker source" widget would want a `people.source`
column, but "top companies" satisfies the one-widget requirement straight off `people.company`.

### ⚠ The hidden cost everyone underestimates

`imports`, `import_rows`, `outbox`, `email_templates`, `audit_log`, `saved_views`, `attachments`, and
`embeds` **all declare `event_id TEXT NOT NULL REFERENCES events(id)`.** An org-level CRM writing through
any of them has two options:

- **(a) Honest:** a migration relaxing `event_id` to nullable across those tables, plus backfill, plus every
  query that joins on it. Multi-hour, touches the blast radius of most of the app, and D1/SQLite makes
  column-nullability changes a table rebuild.
- **(b) Pragmatic:** attribute org-level actions to the single existing event id. One line, correct-enough
  while the product is genuinely single-event, and dishonest the moment multi-event lands.

For a minimum-viable extra-credit build, **(b)** is the right call — but it is a real, deliberate debt and
it should be a written amendment, not a quiet shortcut. Anyone budgeting this area at "just add a table"
has not priced this in.

### Constraints MRQ-D must honor for the CRM door to stay open

These are free if decided now and expensive to retrofit. They are also, independently, the right modeling —
`PHILOSOPHY` §5 ("own your conference") and the org-scoped `people` table already point this way.

1. **The roster row is a `people` row, not a per-event speaker record.** The roster's list query keys on
   `people.id` and joins outward to event scope; it never mints a parallel `speakers` table. This single
   choice is the difference between CRM-01 being a filter-removal and being a rewrite.
2. **Cut the fields correctly at the person/participation seam.** Properties of the *human* — bio,
   headshot, title, company, social links, pronouns, dietary/accessibility — belong on `people` (or an
   org-level `person_field_values`). Properties of *this event's participation* — workflow status
   (Invited/Confirmed/…), travel, honorarium, session assignment — belong on `participations` or a new
   event-scoped join. Putting workflow status on `people` is the one modeling error that forecloses the CRM
   permanently, because a person cannot then be Confirmed at one conference and Invited at another.
3. **Notes, tags, and custom values attach to `person_id` at org level**, never to the event-scoped roster
   row. If MRQ-D adds notes on the roster row, the CRM later either duplicates or migrates them.
4. **One list query, `event_id` optional.** The roster is that query with the filter applied; the directory
   is the same query with it dropped. Two queries means two filter implementations and two bugs.
5. **Server-side search, filter, sort, and pagination** over `people`, leaning on `idx_people_org_name` —
   at ~1,100 rows a client-side filter would work today and become a defect at real scale (R7; "speed is
   respect").
6. **Don't deepen the `attachments.event_id` wart.** A person's headshot is org-level
   (`people.headshot_attachment_id`) while the attachment row it points at is event-scoped. The roster
   doesn't have to fix this; it must not add more org-level concepts behind event-scoped storage.

---

## 3. What would make it *agent-native* rather than a form pile

The judge is itself an LLM browser agent on a 70-turn budget, so discoverability and labeling are not
polish — they are directly scoring surface. This section is the part that would be genuinely differentiated
work rather than CRUD.

**API — org-scoped, following the `/api/v1/org/tokens` precedent already on main:**

```
GET/POST      /api/v1/org/people                    ?q= &company= &title= &tag= &segment_id= &page=
GET/PATCH     /api/v1/org/people/{personId}
GET/POST      /api/v1/org/people/{personId}/notes
GET/PUT       /api/v1/org/people/{personId}/tags
GET           /api/v1/org/people/{personId}/history   -- participations + audit_log + outbox, merged
POST          /api/v1/org/people/{personId}/events/{eventId}   -- the CRM-10 handoff
GET/POST      /api/v1/org/segments  ·  GET /api/v1/org/segments/{id}/members
POST          /api/v1/org/imports  (+ /{id}/mapping, /run, /undo)   -- contacts mode of the existing importer
GET/POST      /api/v1/org/pipeline/cards  ·  POST /api/v1/org/pipeline/cards/{id}/move
POST          /api/v1/org/comms/send                 -- thin wrapper over the existing person_ids path
GET           /api/v1/org/dashboard
```

Because routes are declared through `defineApiRoute`, every one of these lands in `/api/openapi.json` and
the `/api/docs` page automatically, and `cli/generate-api-registry.mjs` folds them into
`cli/api-registry.json`. **The agent-discovery path is already built** — that is the real leverage here and
the reason this area is cheaper for us than for a typical clone.

**CLI — `cli/generate-skill.mjs` regenerates `SKILL.md` from the registry, so the skill affordance is
mechanical once the verbs exist:**

```
marquee people list --q Priya --filter company="Acme" --json
marquee people show <person-id>          marquee people note <person-id> --body "..."
marquee people tag <person-id> --add AI  marquee people import --csv speakers.csv
marquee segments save --name "AI Experts" --filter tag=AI --kind dynamic
marquee pipeline enroll <person-id> --stage identified --score 85 --rationale "..."
marquee pipeline move <card-id> --stage interested
marquee people add-to-event <person-id> <event-id>
marquee people email --filter tag=AI --subject "Speak at ...?" --body "Hi {{speaker.first_name}}, ..."
```

**Discoverability rules — each one is worth more than a feature, and each is nearly free:**

- **Nav label must be a literal string from the scenario.** CRM-S1 step 2 greps for "CRM", "Speaker CRM",
  "Directory", "Contacts", "People", "Speaker Database", "Speakers". Use **"Speaker CRM"** — it matches two
  of them — placed in a nav group visually *above and outside* the conference section, because CRM-01
  explicitly fails anything "nested inside one event's menu".
- **Alias the route.** `/crm`, `/directory`, `/contacts`, `/people` all resolve to the same page. Agents
  guess URLs; each 404 costs 2–3 turns out of 70.
- **Bulk actions appear on checkbox selection**, in the toolbar — the scenario literally says "select 2+
  contacts and look for a Communicate / Send Email action". Behind a kebab menu, it may simply not be found.
- **"Filter" button immediately right of the search box**, panel with grouped attribute values, active
  criteria rendered as removable chips — CRM-02's evidence line asks for "active criteria visible".
- **"Save Segment" top-right, appearing after a filter is applied**, with a Dynamic/Curated radio (bonus
  evidence, costs one radio group).
- **One profile view carrying all four surfaces** — identity, notes composer, connections, activity — not a
  tab chain. Tab *names* need not match SessionBoard's; the rubric says so explicitly.
- **Everything server-persisted, verified by reload.** Non-negotiable; see §1.
- **`submissionNotes` must be updated in the same change.** It currently ends with "There is no org-level
  speaker CRM outside a single conference" — a stale disclaimer would actively send the agent away from a
  CRM we built. Run 1's most expensive lesson was notes that described the prototype rather than the
  deployed build; this field is worth more than most features and costs nothing.
- **Empty states say what to do next** (PHILOSOPHY §1) — and the ~1,100 seeded `people` rows mean the
  directory is filled without any seeding work at all.

---

## 4. Effort estimate

Agent-hours = one delegator through plan → implement → review → fix → open PR, at this repo's conventions
(thin SQL layer, Zod/OpenAPI route definitions, Preact page, tests, `pr-gate`). Estimating basis is the
observed cost of comparable modules already on `main`; treat the ranges as ±40%.

| Cluster | Items | w | Agent-hours | Notes |
|---|---|--:|---|---|
| **C1** Directory: route, list, search, filters, profile, notes, tags, activity | 01, 02, 03, 04 | 8 | **6–10** | 4 endpoints + 2 tables + one substantial page; the filter panel is most of it |
| **C2** Contacts CSV import | 05 | 2 | **3–5** | Contacts-only mode on the existing importer; mapping/flagging UI already exists |
| **C3** Segments | 09 | 1 | **2–3** | Mirrors the `saved_views` pattern |
| **C4** Bulk email from directory | 11 | 1 | **2–4** | Mostly wiring; `person_ids` send, preview, and outbox log all exist |
| **C5** CRM dashboard | 12 | 1 | **2–3** | Two counts + one `GROUP BY company` widget |
| **C6** Kanban pipeline + card detail + stage history | 07, 08 | 3 | **8–12** | 3 tables, drag-and-drop board, card drawer, reload-persistence tests |
| **C7** Duplicate detect + merge | 06 | 1 | **4–6** | FK re-pointing across `participations`, `memberships`, `outbox`, `speaker_tasks`, `attachments`; irreversible; highest defect risk per point in the area |
| **C8** Add-to-event handoff | 10 | 2 | **2–3**, or **+10–20** | 2–3h for a single-option picker (partial-credit risk); a genuine pass wants multi-event, which is its own project |

| Band | Clusters | Items scored | Weighted | Area % | Agent-hours |
|---|---|---|--:|--:|---|
| **A — directory layer** | C1–C5 | 01,02,03,04,05,09,11,12 | 13 / 19 | **68.4%** | **15–25** |
| **B — A + pipeline** | +C6 | +07,08 | 16 / 19 | **84.2%** | **23–37** |
| **C — B + merge + handoff** | +C7,C8 | all 12 | 17.5–19 / 19 | **92–100%** | **29–46** |

Band C's range reflects CRM-10 landing as partial (0.5) rather than pass while the app is single-event.

### Score-per-hour, against the required areas

One unit of *item weight* converts to overall points at `area_weight / area_item_weight`:

| Area | Overall pts per item-weight unit |
|---|--:|
| Abstract Management | **0.714** |
| Public Widgets | 0.571 |
| AI Agenda | 0.556 |
| Call for Papers | 0.526 |
| Content Management | 0.484 |
| Speaker Management | 0.455 |
| **Speaker CRM (as the kit scores today)** | **0.000** |
| *Speaker CRM, if optional were folded in additively* | *0.526* |

The required side still has cheap, defect-shaped points on the board from run 1 — the public CFP headshot
upload that makes every submission fail, the Accepted-status filter returning 0 records, per-round
scorecards for `ABS-01` (w3 × 0.714 = **2.14 overall points** for one gap), and the reviewer seat whose
absent door leaves ~24.7 overall points sitting in `cannot_judge`. These are single-defect fixes on code
that already exists, in the 1–3 agent-hour range each — call it **0.5–2.0 overall points per agent-hour**.

Band A of the CRM is **0.00 points per agent-hour** as the kit scores today, and **0.27–0.45** under the most
generous hypothetical below. The triage's read that the required areas dominate **holds, and holds by a
wider margin than expected** — the roster landing does not change it, because the roster reduces CRM cost
from ~20 hours to ~10 without changing the numerator from zero.

---

## 5. Recommendation — **skip**

**As the kit scores today, every band buys 0.0 overall points.** Not "a little", not "a tiebreak percent" —
zero, by `report.ts:166`. And the graders' default config does not run the area at all.

| Band | Area % | Overall pts, **kit as written** | If folded in *additively* (`+10 × pct`) | If folded in *renormalized* (denominator 110), required at 45% |
|---|--:|--:|--:|--:|
| Skip | — (or ~5–16% if run) | **0.0** | +0.5–1.6 | −0.3 |
| A | 68.4% | **0.0** | +6.8 | +2.1 |
| B | 84.2% | **0.0** | +8.4 | +3.6 |
| C | 92–100% | **0.0** | +9.2–10.0 | +5.0 |

Two things about the hypothetical columns. The additive reading contradicts the README's own sentence
("renormalized over whichever **required** areas actually ran"), so it is the *least* likely of the three.
And under the renormalized reading there is a trap worth naming: the delta is `(10/110) × (C − R)`, so a CRM
scoring *below* the required average would **subtract** from the headline. If required climbs to ~68%, Band
A becomes exactly break-even; above that it is net-negative. A weak CRM is worse than no CRM under the one
hypothetical where optional areas count at all.

So: **skip the build.** Two free actions, and one trigger.

**Free action 1 — bind MRQ-D to the six constraints in §2.** Zero cost if decided before the roster is
built, and it is independently correct modeling that `people`'s org scoping already implies. It keeps a
future CRM at ~10 agent-hours instead of ~25, and it is the difference between CRM-01 being a
filter-removal and a rewrite.

**Free action 2 — keep the `submissionNotes` disclaimer precise.** It already says "There is no org-level
speaker CRM outside a single conference." Keep it. It costs nothing, saves the agent turns if a grader runs
`--include-optional`, and is exactly the kind of accuracy whose absence cost credibility in run 1.

**Reopen trigger — check before submitting, not before building.** `sequence/EVAL-KIT.md` already mandates a
re-pull of `.eval-kit` before any run. Add one grep to that step:

```sh
grep -n "filter((a) => !a.optional)" .eval-kit/src/report.ts   # 2 hits at 4b2dc09-era pin 2b0f795
```

If those hits disappear — i.e. a future kit commit folds optional areas into `overallPct` — Band A becomes
worth up to +6.8 overall points for 15–25 agent-hours, and the verdict flips to **build-as-roster-rider**:
C1 + C4 + C5 only (directory, bulk email, dashboard = 11/19 = 57.9% for ~10–17 hours), skipping the
pipeline, merge, and handoff entirely. Even then it ranks below unfixed required-area defects and should
queue behind them.

**One note on R8, for the record.** The prior ruling was a *buyer* requirement — swyx on tape saying he
only wants the program side. The eval kit is a separate instrument and could in principle have rewarded
what the buyer doesn't want. It doesn't. Buyer preference and scoring instrument agree here, which is the
comfortable case: R8 stands, unamended, on its own evidence and on the kit's.

---

## 6. If it gets built anyway — the ordered path

Should the trigger fire, or should the CRM be wanted as a *product* feature rather than a scoring one
(defensible under "own your conference"), build in this order — score-dense first, each step shippable:

1. **C1 directory** (8 of 19 pts) — the only step that unblocks any other, and the only one CRM-01's w3
   depends on. Nav label "Speaker CRM", routes aliased, filter chips, server-side search over
   `idx_people_org_name`.
2. **C4 bulk email** (1 pt, ~2–4h) — the best ratio in the area; the send path, the preview, the merge tags,
   and the sent log already exist.
3. **C5 dashboard** (1 pt, ~2–3h) — two counts and one `GROUP BY`.
4. **C2 import** (2 pts) — reuses the mapping/flagging UI.
5. **C3 segments** (1 pt).
6. **C6 pipeline** (3 pts) — the largest single build; the first step where cost outruns the reuse story.
7. **C7 merge / C8 handoff** — do not build. Merge is the highest defect risk per point in the area, and
   the handoff cannot honestly pass while `evt_aie-ny-2026` is hardcoded in 17 files.

Update `submissionNotes` in the same PR as step 1, and delete the no-CRM disclaimer the moment the route
ships — a stale note is worse than no note.
