# Marquee — Differentiation Matrix

**Built:** 2026-08-12, ~18:30 UTC · ~3.5 h before the 22:00 PT submission deadline
**For:** submission copy — README, submission-form answers, the pitch a judge reads in the first 60 seconds
**Owner:** Differentiation Analyst surface. Analysis only; no source, PRs, or board touched.

---

## Contents

| Section | What it answers |
|---|---|
| **Executive read** · **If there are three hours left** | What to do now, ranked |
| **The honesty ledger** (14 items) | What we currently claim that a judge can disprove |
| **Live defects** (D0–D6) | What is broken on the deployed site right now |
| **Part 1** | Sessionboard × Sessionize × Marquee, module by module + the competitive frame |
| **Part 2** | The `sbek` rubric, the coverage cliff, and the ranked cheap wins |
| **Part 3** ← *the main event* | ~60 unasked-for items in five groups, plus a top ten |
| **Appendix** | The synthesist's own live curl evidence |

**If you read three things:** the *three hours left* table, the **Live defects** section, and
**Part 3's top ten**.

---

## How to read this

Three parts. **Part 3 is the main event** — the long, deliberately over-inclusive list of what
Marquee has that nobody asked for, built to be pared down rather than padded out.

Every claim carries a **verification tag**, and the tags are not decorative. The graders' judge
has already docked this project once for notes that contradicted the deployed build, so a claim
that cannot survive a judge's curl is worse than no claim at all.

| Tag | Means |
|---|---|
| `verified-live` | Confirmed against `https://marquee.stage11.dev` today. Safe for public copy. |
| `verified-in-code` | The implementing code was read on `github/main`. True of the repo; **not necessarily true of the deployed site.** |
| `on main, not deployed` | Built and merged, but a judge hitting the site today will not find it. |
| `claimed-in-docs-only` | A doc asserts it and no implementing code was found. **Do not put in public copy.** |

---

## Three trees, and why the distinction is load-bearing

Everything below depends on knowing *which* Marquee is being described.

| Tree | State |
|---|---|
| **Deployed** — what a judge sees | sha `8dc17d304472d368309590ed60b8cc389851f1dc` = PR #103, built `2026-08-12T17:10:02Z` |
| **`github/main`** — what is merged | **25 commits ahead** of the deploy. Diff over `src/ cli/ migrations/ scripts/`: **66 files, +4,799 / −299** |
| **The primary checkout** | **91 commits behind main** (HEAD `13a77cb4`). 42 route modules vs main's 62. Any analysis run against it understates the product by a wide margin — this was caught early and every finding below was re-derived from `github/main`. |

### On main, invisible to a judge today

| Not deployed | Evidence |
|---|---|
| Attendee personal schedule (MRQ-132) | `src/ui/public/agenda/schedule-script.ts` **+1,078 new**, `PublicAgendaPage.tsx` +511, `src/routes/public-schedules.routes.ts` new |
| Multi-event switcher + create-with-copy UI (MRQ-129) | `EventSwitcher.tsx` +215 new, `event-context.tsx` +184 new, `event-selection.ts` +73 new, `NoConference.tsx` +45 new, `CreateConferencePage.tsx` +285 |
| Venue site map `/site`; agent-facing agenda `/agenda/agents` | Both absent from the deployed `public-agenda.route.tsx`; both present on main |
| Sign-in door (#110), evaluator dead-end fixes (#99), speakers-only import (#107), `check:clocks` (#109) | merged after the deploy |

**The multi-event and cold-start *APIs* are already live** — it is the organizer-facing UI that is
not. And **one deploy converts a large block of `on main, not deployed` into `verified-live`.**
That is the single highest-leverage action available before submission, and it costs one command.

**One caveat on that deploy.** Open PR #111 is titled in part *"…and three server pages the assets
router was swallowing."* `/site` and `/agenda/agents` may still fall through to the SPA shell after
a deploy of current main. Deploying alone may not make them reachable.

---

## The route-probing trap (matters for anyone verifying claims)

`src/index.ts:165` ends with `app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw))`. **Every unknown
path returns HTTP 200 with the SPA shell.** `GET /definitely-not-a-real-route-xyz` → `200`.

Consequences, all verified today:
- Status codes prove nothing about page existence. `/SKILL.md`, `/llms.txt`, `/openapi.json`,
  `/docs` all return 200 and all return the shell.
- The only honest 404 is the API router's JSON envelope:
  `{"error":{"code":"not_found",...},"request_id":"…"}`.
- Bare `/api` returns the shell too — `app.all("/api/*")` does not match `/api` itself.
- A grader's browser agent that probes by URL will be told "yes" every time. This is a real
  coverage risk, not a cosmetic one.

Distinguishing test used throughout this document: server-rendered pages carry distinct
`<title>` values (`Agenda · Marquee`, `Speakers · Marquee`), the shell carries
`Marquee — Program operations`.
---

## Executive read — the five things that matter

**1. The product is materially stronger than any document in this repo says it is.**
`github/main` carries 62 route modules, **194 API operations**, 251 source files / 59,574 lines,
982 tests passing, and **136 Lattice tickets across ~142 merged PRs in four days**. Every internal
map — `SITEMAP.md`, `STATEMAP.md`, the gap analysis — understates it, and the primary checkout is
91 commits behind. The instinct to trim claims for safety is exactly backwards here; the honest
claims are bigger than the ones currently written down.

**2. The unasked-for surface is the story, and it is large.** Part 3 lists roughly sixty items
across six groups. The five that no competitor and no rubric line touches at all: the
**agent-native surface** (187-operation API the UI is a plain client of, a 45-command CLI, a
generated `SKILL.md`, a content-addressed OpenAPI document); **operational honesty** (demo-safe
mail, the "616 speakers have not heard from you" ledger, a system that refuses to say
"delivered"); **the attendee as a fourth seat** nobody asked to exist; **physical geography** as a
third conflict class; and **the engineering artifacts** — checks that exist because someone got
burned, each with the incident written into the source.

**3. Most of what was broken this morning is now fixed — two things are not.** As of the 18:45Z
deploy the live site is level with `main`, the public agenda's day tabs work, and the ownership
ceremony renders. Still broken: **the speaker directory sorts by given name**, and **the
attendee/public seat has no door on the landing page** — the same failure class that already cost
~24.7 points on the reviewer seat. See the status banner in **Live defects**.

**4. The open-source deliverable is still not deliverable, and it outranks everything else here.**
The landing page's GitHub link 404s for every judge; the public orphan branch is 167 commits behind
main and its allowlist excludes `docs/` entirely.

**5. Deploy discipline is the recurring risk, not a one-off.** This document was written against a
site 25 commits behind main, and that gap closed only while it was being read. The reseed that
fixed the agenda dates can be undone by the next stray test agent. **Re-verify the public agenda
and the landing page immediately before submitting.**

---

## The ranked action list — revised 11:55 PDT, ~10 h to deadline

Items 1, 2 and 3 of the original list **were completed** by the 18:45Z deploy, PR #111 and a
reseed. What remains, re-ranked against the live site as it stands now. Costs are the eval agent's
estimates; points are its scoring model; ordering is mine.

| # | Action | Cost | Why it ranks here |
|---|---|---|---|
| **1** | ~~Publish the public artifact~~ — **SUPERSEDED, and owned elsewhere** | — | Atin ruled the public artifact is **not** the orphan assembly: **this repo flips public at ~21:30 ET**, keeping `.lattice` and `sequence/`, with two deletions (`OPERATOR-PRECONDITIONS.md`, `competitor-context-doc-2026-08-08.md`) and a README fix. Owned by Submission Prep, `workspace:5 surface:26`. **Do not mint or launch against this.** The landing-page 404 resolves itself when the repo flips. See the ⚠️ row in *Research* below for what that scope also exposes. |
| **2** | **Put `/agenda` and `/speakers` doors on the landing page** | ~10 min | The last unreachable seat. 20 weight of Public Widgets sits behind it, and an unreached surface scores `cannot_judge` — which under the current scorer drags toward the 60% cliff, where the headline is **withheld entirely**. Same failure class that already cost ~24.7 pts on the reviewer seat. |
| **3** | **Rewrite `submissionNotes`** | ~20 min | Currently tells the grader we have no reviewer door and no org-level CRM — **both false**. That one sentence forfeits a 10-weight extra-credit area. Curl every claim in it before submitting. |
| **4** | **Sort the speaker directory by surname** (`src/lib/public-site.ts:707`) | ~15 min | 2.9 pts (EMB-04 w3, EMB-12 w2), one line, still live-broken. |
| **5** | **Delete the `If-Match` sentence from the OpenAPI `info.description`** | ~2 min | The most checkable false claim we ship, and the API serves it about itself: one occurrence of `If-Match` in a 389 KB spec, 116 mutating operations, 0 header params. |
| **6** | **Serve `SKILL.md` (and consider `/llms.txt`)** | ~10 min | Converts "ships in the repo" into "an agent can fetch it from your deployment." Currently returns the SPA shell. |
| **7** | **Re-verify after every deploy** | — | The reseed fixed the dates; a later reseed or a stray test agent can break them again. `curl /api/v1/public/agenda` and compare `days[]` against session dates before submitting. |

**Not on this list, deliberately:** anything AI-shaped, and any new feature. swyx said *"I don't
care about the AI workflow thing,"* and every item above is worth more than a feature nobody can
reach.

### Research, not shipping

| Question | Why it matters |
|---|---|
| **Does the current scorer withhold our headline?** The `sbek` rescore showed CFP coverage falling 71% → 42% under commit `8109958`, because turn-capped scenarios no longer count as "looked." | If coverage lands under 60%, the score is suppressed regardless of quality. Worth re-running one scenario against the now-current deploy to see whether the fixes moved coverage. |
| ~~**Is `/signin` server-rendered or SPA-only?**~~ **ANSWERED — it is server-rendered.** 12,024 bytes, a real `<form>`, two `<input>`s, "Sign in" and the magic-link copy, all present with no JS. A no-JS grader sees the door. | Not a gap. The only residue is that its `<title>` is the generic *"Marquee — Program operations"* rather than naming the page — which is what a judge's tab bar shows. Cosmetic, cheap. |
| **⚠️ Does the 21:30 ET publication expose material it shouldn't?** The plan flips **this** repo public with `sequence/` and `.lattice` intact. That ships `sequence/research/sources/tweet-image.png`, which `competition-requirements.md` identifies as **AIE's internal budget proposal** — the judging organization's own confidential material, in the repo we hand them. Also swyx's brief PDF and his unlisted walkthrough captions, and this document's own "things to NOT say" section. | Owned by Submission Prep (`workspace:5 surface:26`), briefed. The budget-proposal image is a hard removal in my view; the rest is a strategy call. |
| **What is Sessionize's actual calendar-invite behaviour?** One unsourced sales bullet, open question L1. | We currently claim Sessionboard has zero calendar invites (well sourced). Do **not** extend that claim to Sessionize without evidence. |
| **Does the public assembly allowlist need `docs/`?** | `ROUTES.md`, `GETTING-STARTED.md`, `OBSERVABILITY.md` are the evidence behind several Part 3 items. If they stay excluded, those claims are unverifiable by a judge. |
---

# The honesty ledger — read this before writing a word of public copy

Fourteen claims that are currently made *somewhere in this repo or on the deployed site* and that
will not survive a judge checking them. Ranked by exposure. Each is cheap to fix; several are a
one-line edit.

### 1. The live OpenAPI overclaims optimistic concurrency — `verified-live`, and a judge can check it in one command

`GET https://marquee.stage11.dev/api/openapi.json` → `info.description` says, verbatim:

> *"Mutations carry strong `ETag`/`If-Match` optimistic concurrency."*

Counted directly from the served document today:

| Measure | Value |
|---|---|
| Occurrences of `If-Match` in the entire 389 KB spec | **1** — and it is that sentence |
| Mutating operations (POST/PUT/PATCH/DELETE) | **116** |
| Header parameters documented across all 187 operations | **0** |

Concurrency control is real but is **2 routes of 194, agenda only** (`src/api/concurrency.ts`).
The sentence generalizes it to every mutation. This is the most checkable false claim we ship,
it is served by the API itself, and it is one string edit. **Fix or delete the sentence.**

### 2. The Airtable mirror does not exist, and Airtable persistence is a *named brief bonus*

`sequence/research/sessionboard-gap-analysis.md:214` advertises *"a genuine two-way Airtable
mirror."* It was **cancelled** (MRQ-25/MRQ-26); `npm run check:mirror` is a stub that declares
itself unimplemented; PR #27 removed `/settings/airtable`. Only `last_write_source='airtable'`
and a delivery-state column survive.

The brief (p.2) names Airtable persistence as a bonus. **The bonus is forfeited — that is a
legitimate scope call. Claiming it anyway is the single largest factual exposure in the deck.**

### 3. `SITEMAP.md` advertises two modules that do not exist

- `#settings/airtable` (`SITEMAP.md:244`) — removed in PR #27.
- `#settings/webhooks` (`SITEMAP.md:246`) — **schema-only.** `webhook_endpoints`,
  `webhook_deliveries` and `WEBHOOK_EVENT_TYPES` exist; there is **no route module and no
  writer**, and the migration comment literally says *"the future webhook writer."*

PR #27's own commit message states the principle: *"An installed route claims a module exists."*
The same principle applies to a sitemap. `SITEMAP.md` documents the prototype, not the build —
which is exactly why this document verified against the deployed site instead.

### 4. `SKILL.md` is not served from the deployed site

`GET /SKILL.md`, `/llms.txt`, `/.well-known/ai-plugin.json` all return the SPA shell
(`verified-live`). The skill file is a repo artifact only. It is still a genuine differentiator —
but say "ships in the repo", not "an agent can fetch it from your deployment." **Serving it is
plausibly a ten-minute change and would make the claim unambiguous.**

### 5. `AGENTS.md` is not in the repository

It is an untracked local symlink. Do not cite it as a shipped artifact.

### 6. The CLI covers 23% of the API, not the API

45 commands against 187 operations. The honest and still-strong framing is that **the CLI covers
the operator's whole loop** — CFP → review → decision → schedule → chase → publish — not that it
covers the API. Note also that `/api/docs` is labelled "API & CLI" in the sidebar and contains
**zero CLI content**.

### 7. Pagination is offset-based, and there is no `Idempotency-Key` contract

Offset pagination, not cursor. Idempotency exists as outbox dedupe and a durable bulk
`operation_id`, which is real and worth claiming — but there is no request-level
`Idempotency-Key` header contract. Do not imply one.

### 8. The agent evaluator seat (MRQ-134) is unmerged and undeployed

It is the sharpest idea in the whole inventory (see Part 3, Group A). **It is `in_progress`.**
Frame it as design intent, or a judge will curl for it and find nothing.

### 9. Speed budgets are **not** enforced in CI

`check:speed` appears in neither `scripts/checks/pr-gate.mjs` nor `.github/workflows/ci.yml`, and
`speed-report.json` has never recorded a single one of the 14 budget ids. This one matters because
"speed budgets enforced in CI" is an attractive line and R7 makes speed a graded feature.

Say **"budgeted, and measurable in one command"** — which is true, unusual, and still strong.
Never "enforced in CI."

Related, same family: **GitHub CI is a strict subset of the local PR gate.** CI omits `check:api`,
`check:routes` and `check:shell-truth`, so a PR that skips `npm run pr-gate` can merge with API/doc
drift, route-map drift, or a hardcoded demo id.

### 10. The OpenAPI ETag is a parity digest, not a conditional GET

It is genuinely the SHA-256 of the served bytes (`verified-live`) and that is the interesting
claim. But live `If-None-Match` returns **200, not 304**. Claim content-addressing; do not claim
caching semantics.

### 11. There is no end-to-end browser test coverage

**`tests/e2e/` does not exist.** `npm run e2e` is a registered stub (MRQ-50); `playwright.config.ts`
is real but points at an empty directory. Every `e2e:` verification note in `EVALUATION.md` is
unexecuted. **No end-to-end claim of any kind is safe.**

### 12. Don't say "45-second suite," and don't say 100% AC coverage

- The suite is a **982-test, 0-failure** suite (807 vitest across 119 files + 175 `node:test`) —
  which is the impressive number. It **measured 62.5 s and 93.3 s** on a 16-core box under load.
  45 s is the declared *objective*, and the harness reports against it by design; it is not the
  observed time.
- **AC coverage is 216 of 229 live criteria — 94.3%**, with 425 AC→test links and 0 malformed test
  titles. `trace:ac --scope=all` currently **fails**. Nine of the ten gaps (AC-22, AC-167–169,
  AC-225–229, AC-241) are the **cancelled Airtable mirror**. Volunteering that is a strong answer;
  claiming 100% is a checkable falsehood.
- **Never quote a checked-out `ac-coverage.json`** — it is gitignored, and the stale copy in the
  primary checkout says 216 / 122 files / 2 errors against a real 229 / 182 / 0.

### 13. `STATEMAP.md` documents the Airtable mirror; both maps are 259 commits behind

`STATEMAP.md` §10 describes the Airtable mirror that `package.json` itself declares unimplemented.
Board stages are 8 not 7; form states 5 not 4; task states 6 not 3. Thirteen of fourteen verified
entries are otherwise exact — the stored-vs-derived discipline is genuinely good — but there is no
generator and no gate, so it will drift again.

**Cite the generated `docs/ROUTES.md`, never `SITEMAP.md`.** `SITEMAP.md` documents 27 hash-routes
against 51 real paths, six of which have no implementation. `check-routes.mjs`'s own rationale
names `#comms` and `#settings/webhooks` as known lies — and `SITEMAP.md` still lists both.

### 14. Six ruled "contract now" items never landed — all on the customer-annotated path

Rich-text toolbar; Tags/Level taxonomy; auto-redirect to portal (swyx annotated *"make sure this
works"*, p.14); admin↔portal impersonation (red-arrowed, p.17); per-plan ratings column;
submission pacing chart. Plus pronouns and the internal/external form names.

None is fatal alone. Together they are the difference between two claims:

> ❌ *"Marquee matches Sessionboard's Program module."* — not true; the surface is thinner.
> ✅ *"Marquee beats Sessionboard's Program **workflow**."* — true, checkable, and the stronger claim anyway.

---

## Two scope corrections that change what we should say

**The "Program only" ruling is video-only, and the PDF is softer than assumed.** R8 comes from the
walkthrough at [02:06]. The PDF never names CRM/Marketing/CMS as out of scope; it rules by
strikethrough and annotation — struck items 7, 8, 9; "NOT NEEDED" on Payments (p.13); **"CMS >
Embeds *(OPTIONAL)*"** (p.30); "Dashboard *(optional but nice to have, best efforts)*" (p.32).
CMS is therefore **optional, not excluded**.

**Multi-round review is a bonus, not a MUST.** Brief item 4's strikethrough is mid-sentence and
removes *"including optional AI-assisted review across multiple rounds"* in full.
`sequence/research/competition-requirements.md` §1.1 R4 is wrong on this and should be corrected.
Marquee ships rounds anyway — so this converts a "requirement met" into an "unasked-for bonus,"
which is a **Part 3 item, not a Part 1 row.**
---

# Live defects found while verifying

> ## ⚠️ STATUS UPDATE — re-verified 2026-08-12 18:55 UTC / 11:55 PDT
>
> **A deploy landed at `18:45:50Z` (sha `75b871d9`, PR #113) and the live site is now level with
> `main` — 0 commits behind.** PR #111 also merged, which rewrote `run_worker_first`. The board has
> **zero open PRs**. Re-checking every defect below against the new build:
>
> | Defect | Status now |
> |---|---|
> | **D2** empty agenda day tabs | ✅ **FIXED** — days are now `2026-10-12/13/14`, sessions `2026-10-12` ×4, `2026-10-13` ×19. The conference was reseeded. |
> | **D5** `/claim/:token` blank page | ✅ **FIXED** — `run_worker_first` now lists `/claim/*`, `/join/*`, `/site`, `/signin`. Returns 5,454 B of real claim markup with the correct "no longer valid" copy for a bad token. |
> | **D6** `/agenda/agents` swallowed | ✅ **FIXED** — `<title>For agents · Marquee`. |
> | `/site` | ✅ Now a deliberate **302 → `/agenda`**. Not a defect; note the venue map has no public page. |
> | **D0** open-source deliverable | ❌ **STILL OPEN** — `github.com/Stage-11-Agentics/marquee` still returns **404**, still linked from the landing page. |
> | **D3** speaker sort by given name | ❌ **STILL OPEN** — live: Aarush, Alexander, Aparna, Barr, Barry. |
> | **D4** no `/agenda` or `/speakers` door | ❌ **STILL OPEN** — landing hrefs are exactly `/`, `/f/cfp`, `/portal?demo=speaker`, `/reviewer?demo=reviewer`, `/submissions?demo=organizer`, and the 404ing GitHub link. |
>
> Honesty-ledger items still live: **#1** the `If-Match` sentence is still served (and the spec is
> now **194 operations**, up from 187); **#4** `/SKILL.md` still returns the SPA shell.
>
> **Everything about the deploy gap in the sections above is now historical.** It is retained
> because the *pattern* — merged work invisible to a grader — recurs, and because the tags in
> Part 3 marked `on main, not deployed` are now all `verified-live`.

The originals, as found earlier today:

These were not the assignment. They surfaced because every claim in this document was checked
against the deployed site, and they are the difference between the product a judge sees and the
product that exists. Ordered by cost-to-fix against damage.

### D0. The open-source deliverable is not delivered — `verified-live`

This is the largest single exposure in the whole document, and it is not a bug in the product.

1. **The landing page's "open source" link 404s for every judge.**
   `https://marquee.stage11.dev/` links to `https://github.com/Stage-11-Agentics/marquee`. That
   repo is **private**; the URL returns **404** to anyone outside the org — which is every judge.
2. **The public artifact is 167 commits behind main.** The orphan branch `mrq-42-assembly`
   (`f4240644`) carries **343 files against main's 2,157**, and **114 test files against 182**.
3. **Its allowlist excludes `docs/` entirely** — so `docs/ROUTES.md`, `docs/GETTING-STARTED.md`
   and `docs/OBSERVABILITY.md` are **not in the public tree**. Also excluded: `SPEC.md`,
   `BUILDPLAN.md`, `STATEMAP.md`, `DEPLOY.md`.

Read together: the competition requires an open-source repo; the link that answers that
requirement is a dead end; and the tree behind it — if published today — would omit most of the
engineering evidence Part 3 Group E is built on, including the privacy posture and the generated
route map. **A `fix-public-assembly-repoint` worktree exists, so this is known work in flight.**

**Nothing else in this document matters as much as this landing before 22:00 PT.**

### D2. Every day tab on the public agenda is empty — `verified-live`

`GET /api/v1/public/agenda`:

| | |
|---|---|
| `event.startsOn` / `endsOn` | `2027-05-12` → `2027-05-14` |
| `days[]` declared | `2027-05-12`, `2027-05-13`, `2027-05-14` |
| Actual session dates (25 sessions) | **`2026-10-13` ×20, `2026-10-12` ×5** |

`GET /agenda?day=2027-05-12` renders **"No published sessions match."** The conference record was
moved to 2027; the sessions were not. The public agenda is the single highest-weighted surface in
the eval (Public Widgets, area weight 20) and the most likely thing a judge clicks first.

`npm run reset:demo` **cannot fix this remotely** — `src/routes/admin-ops.routes.ts:164-170` gates
it behind a loopback-only header. Use `npm run seed -- --remote` (`DEPLOY.md:59`) or a targeted
`wrangler d1 execute`.

### D3. The speaker directory sorts by first name — `verified-live`

`src/lib/public-site.ts:707` sorts on `left.name.localeCompare(right.name)` — the full name, so
effectively the given name. Live output: *Aarush Selvan, Alexander Bricken, Aparna Dhinkaran, Barr
Yaron, Barry Zhang, Beyang Liu, Bruno Passos, Colin Flaherty, Diamond Bishop, Douwe Kiela, Grace
Isford, Hamel Husain…* Two rubric items (EMB-04 w3, EMB-12 w2) require **surname** order. One line.

### D4. The entire attendee/public seat is undiscoverable from the landing page — `verified-live`

Every `href` on the deployed landing page:

```
/f/cfp   /portal?demo=speaker   /reviewer?demo=reviewer   /submissions?demo=organizer
https://github.com/Stage-11-Agentics/marquee   (404, see D1)
```

**There is no link to `/agenda` and none to `/speakers`.** Both surfaces are live, anonymous and
healthy — `/agenda` serves 65 KB of real server-rendered sessions, `/speakers` 25 KB — and neither
is advertised anywhere a fresh agent starting at the root would find it.

This is the same class of failure as the reviewer-seat-with-no-door that cost ~24.7 points. That
one is now fixed (`Enter as reviewer` is on the landing page and mints Dario Quill). **This one is
still open, and 20 points of Public Widgets sit behind it.** A judge or scenario agent that never
reaches the surface scores `cannot_judge`, which drags toward the 60% coverage cliff — and under
the *current* scorer, withheld coverage is worse than a bad score.

### D5. **The entire ownership ceremony renders a blank page — in production *and* on main**

`/claim/:token` and `/join/:token` never reach the Worker. `wrangler.jsonc`'s
`assets.run_worker_first` lists `/`, `/api/*`, `/health`, `/__validation/*`, `/f/*`, `/agenda*`,
`/speakers*`, `/s/*`, `/p/*`, `/embed/*`, `/i/*` — **and neither `/claim/*` nor `/join/*`.** With
`not_found_handling: "single-page-application"`, Cloudflare's asset router answers those paths from
`index.html` before the Worker ever runs.

Verified today: `curl https://marquee.stage11.dev/claim/deadbeef` → the bare **1,486-byte** shell,
`<title>Marquee — Program operations`, no claim markup at all. Same for `/join/deadbeef`.

**This is not a staleness artifact.** `git diff 8dc17d30 github/main -- src/routes/claim.route.tsx
src/index.ts` is empty — main is broken the same way. `README.md`, `docs/GETTING-STARTED.md` and
`SKILL.md` all walk a new owner through this exact link. The API behind it is healthy and live
(`POST /api/v1/claim`, `POST /api/v1/setup/claim-link`, `GET /api/v1/instance/status` all return
real data) — it is only the page that is unreachable.

**The fix is one line in `wrangler.jsonc`.** This is the highest damage-to-effort ratio on the
page.

### D6. `/site` and `/agenda/agents` return the generic SPA shell — `verified-live`

Neither route is in the deployed tree; both exist on main. `/agenda/agents` should work once
deployed, because `/agenda*` is in `run_worker_first`. **`/site` will not** — it is not in
`run_worker_first` either, so it will hit the same wall as `/claim/*` the moment it ships. Fix both
in the same one-line edit. (Open PR #111 also reports "three server pages the assets router was
swallowing," which is the same defect seen from the other side.)

---

**Together D1–D4 are well under an hour of work and they are all on the two pages a judge sees
first.** None of them is a missing feature; all four are a built feature that cannot be found or
cannot render.

---
---

# PART 1 — Sessionboard's feature surface, and Sessionize's

> Module by module, with an honest Marquee column. Out-of-scope Sessionboard surface is
> marked `out of scope`, not as a Marquee gap — swyx ruled the Program module only (R8).


**Marquee state as of `github/main` @ `8098c380`** (62 route modules, 24 UI areas, 17 migrations).
**Two caveats that govern every row below:**

1. **The primary checkout is 90 commits stale.** Anything concluded from
   `/Users/atin/Projects/Stage11/deployments/Marquee/src` understates the product. All
   claims here are read from `github/main`.
2. **Merged ≠ live.** The deployed site is sha `8dc17d30`, ~25 commits behind main. Not yet
   live: multi-event (MRQ-129), attendee personal schedule (MRQ-132), the sign-in door,
   speakers-only import, the evaluator dead-end fixes. Rows are graded on **merged to main**;
   `not live yet` is called out where it applies.

**Scope ruling (correction to the working assumption).** The "Program in / CRM · Marketing ·
CMS out" ruling is **R8, and it is video-only** — `competition-requirements.md` §1.2, sourced to
the walkthrough at [02:06]. The PDF brief never names CRM/Marketing/CMS as out of scope; it
rules by strikethrough and annotation instead (struck items 7, 8, 9; "NOT NEEDED" on Payments
p.13; "CMS > Embeds **(OPTIONAL)**" p.30; "Dashboard **(optional but nice to have, best
efforts)**" p.32). CMS is therefore **optional, not excluded** — weaker than assumed. Also:
brief item 4's strikethrough is mid-sentence and takes *"including optional AI-assisted review
across multiple rounds"* out in full, so **multi-round review is a bonus, not a MUST**
(`competition-requirements.md` §1.1 R4 is wrong on this and should be corrected).

Verdicts: `has it` · `partial` · `doesn't` · `deliberately skipped` · `out of scope`.

---

## A. CFP / submission form builder — brief item 1 (MUST)

| Module/Feature | Sessionboard | Sessionize | Marquee | Verdict |
|---|---|---|---|---|
| Public CFP form, custom fields | Yes, 6+ types | Yes — text, files, links, consents (`landscape-features.md:191`) | 9 types: short_text, long_text, single_select, multi_select, url, email, file, number, date (`migrations/0001_init.sql` form_fields; `migrations/0008_form_field_dates.sql`) | **has it** |
| Conditional logic (R1) | Weak — only Checkbox/Dropdown/Number trigger; first match wins, no cascade | **Yes, and rated better than Sessionboard** — *"questions dynamically change based on previous answers"* (`landscape-features.md:191`) | Any field type triggers; one shared `isFieldApplicable` serves public form, builder preview, server validation, drafts queue (`src/routes/public-form-routing.ts`) | **has it** (beats both) |
| Category-based routing (R1) | Plan-level submission filters only | Not researched | `routing_rules` engine, applied at submit, applied rule named on the record (`src/routes/public-form-routing.ts`, `src/routes/submission-record.routes.ts`) | **has it** (unique) |
| Rich text / WYSIWYG editor | **Yes — on 6+ screens**; `Description · wysiwyg`, `Biography · wysiwyg` | Partial (◐, unsourced) | **None.** 0 hits for `wysiwyg`/`rich.?text` across `src/` + `migrations/`. Markdown fields only (`welcome_md`, `body_md`) | **doesn't** — ruled "contract now / build as markdown toolbar" (`sessionboard-gap-analysis.md:21`) and did not land. Most-repeated visual in the screenshot appendix |
| Section headers / dividers / rich-text blocks in form | **Yes** — `Add Section Element` | Partial (unsourced) | None — 0 hits for `section_header`; a long CFP is an undifferentiated wall of inputs | **doesn't** — was a ruled one-liner (`:249`) |
| Reusable field library (`Search fields…`) | Yes, event-level/global objects | Not researched | Whole-form duplicate only (`POST /forms/:id/duplicate`) | **doesn't** — "copy, not reference" was ruled and parked |
| Internal / External / Page Heading names | **Yes — three names** | Not researched | One `forms.name`; 0 hits for `internal_name`/`external_title` | **doesn't** |
| Per-submitter submission limit | Event-level default + form-level override; drafts count | Yes (`landscape-features.md:191`) | Form-level `per_submitter_limit` only (`migrations/0001_init.sql:226`) | **partial** — missing the event-level default and its override-resolution rule |
| Saved drafts + autosave + resume link | Yes (Drafts tab, a number) | Yes (matrix `:68`, unsourced) | Autosave, private resume token, plus a **drafts-needing-attention queue** computing missing required fields against what's *currently applicable* to that submitter | **has it** (beats both) |
| Multi-form per event | Yes (20-form cap) | Unknown — never researched | Yes | **has it** |
| Abstract vs Session as two entities (R9) | **Yes** — genuinely ahead of the market | **No** — *"one submission entity"* (`landscape-features.md:209`) | `forms.kind` + `bypass_evaluation` (`migrations/0001_init.sql:221`) | **has it** |
| Per-role min/max (Speaker/Chair/Moderator) + overall limits | Yes, plus conditional limits | No (matrix `:61`,`:62`) | Roles exist in `participations.role`; builder exposes only `min_speakers`/`max_speakers`/`max_sponsors`. No per-role editor | **partial** — schema half free, editor absent (R15: the min-2-speakers default swyx called "stupid") |
| `max_sponsors` control with no sponsor entity | Yes (Groups module behind it) | n/a | Still in schema *and* written by the importer (`src/db/schema.ts:305`, `src/lib/sessionize-import.ts:538`) | **partial** — ruled "drop the control, keep the column"; the column and its writer both remain |
| Form options bound to conference settings | Yes (Library) | n/a | Yes — MRQ-126 (`migrations/0010_bound_form_options.sql`) | **has it** |
| Auto-redirect to portal 10s after submit | **Yes** — swyx annotated **"make sure this works"** (p.14) | n/a | 0 hits for countdown/auto-redirect. Confirmation screen + magic link only | **doesn't** — a customer-annotated card |
| Submitter confirmation email | Yes — swyx: **"must have"** (p.14) | Yes | `submission_confirmation` template (`src/jobs/mail/templates.ts`) | **has it** |
| Admin notify on new submission | Yes — swyx: **"nice to have"** (p.14) | Yes | `forms.admin_notify_person_ids` | **has it** |
| Close date | Yes — swyx: **"kinda impt"** (p.13) | Yes | `forms.closes_at` + `form_closing_reminder` trigger | **has it** |
| Per-track / per-type deadlines | No | No (matrix `:65`) | No | **doesn't** (nobody ships it) |
| Payments & fees on the form | Yes | No | No | **out of scope** — red "NOT NEEDED" (p.13) |
| Multi-language | Yes | **Yes** (matrix `:73`) | No | **deliberately skipped** — R39 ("we only care about English") |

## B. Submissions list / grid

| Module/Feature | Sessionboard | Sessionize | Marquee | Verdict |
|---|---|---|---|---|
| Saved views + column chooser | Yes — Preferences drawer, 39 fields, 25-col cap, drag-reorder | **Never researched** — do not claim anything | `saved_views` + `src/routes/views.routes.ts` over the AC-248 registry | **has it** |
| Text filter operators (contains / starts with / is empty…) | **Yes, 8 operators** | Unknown | Equality-shaped filters only; 0 hits in `src/api/list.ts` | **doesn't** — ruled "build 2–3 operators", did not land |
| Per-plan ratings column, sortable | **Yes** — `Ratings: My Evaluation Plan` | Unknown | 0 hits | **doesn't** — ruled top-6 ("how anyone picks 60 of 1,000"). Partially compensated by the chair results table (§C) |
| `Notified` column / notification receipt | Yes (because status change does *not* notify) | Unknown | Yes — 4 derived states, `submission_decisions` ⟕ `outbox` (`src/ui/submissions/SubmissionsPage.tsx:204`, `STATEMAP.md` §7c) | **has it** (their receipt *on top of* our automatic cascade) |
| Bulk accept / decline | Yes | Yes (matrix `:127`) | Yes, with durable `operation_id` (`src/routes/submissions-bulk.routes.ts`, `src/api/bulk.ts`) | **has it** |
| CSV export | Yes | Yes — incl. evaluation results **and team comments** | Yes, incl. per-criterion chair export (`src/routes/evaluation-results.routes.ts:182`) | **has it** |
| XLSX export | Yes (red-arrowed by swyx, p.21) | "Spreadsheets" | No | **deliberately skipped** — CSV opens in Excel |
| Download files bundle | Yes (red-arrowed, p.21) | Yes — ZIP from Export page | Yes — streamed ZIP-STORE, 1 GB cap, `manifest.txt` lists what's missing (`src/routes/files-export.routes.ts:235`) | **has it** |
| Tags / Level taxonomy | **Yes** — first-class, chips on every row | n/a | **No tables.** `grep` finds only *people* tags (`migrations/0012_people_annotations.sql`) | **doesn't** — ruled "contract now", did not land |
| Language taxonomy | Yes | Yes | No | **deliberately skipped** (R39) |
| Client Session ID (external identifier, editable) | Yes | n/a | `external_ref` is editable through the record API (`src/routes/submission-record.routes.ts:71`) but was an import-matching key by design | **partial** — API-editable; not confirmed as a labelled, visible grid/record field |
| Per-session capacity | Yes | n/a | `rooms.capacity` only (`migrations/0001_init.sql:78`) | **doesn't** |
| Import Sessions | Yes | n/a | Sessionize importer with mapping, preview, idempotent match, **undo batch** (`src/routes/imports.routes.ts`, `STATEMAP.md` §12) | **has it** |

## C. Evaluation & review — brief item 4 (MUST; multi-round is bonus, see scope note)

| Module/Feature | Sessionboard | Sessionize | Marquee | Verdict |
|---|---|---|---|---|
| Multiple rounds | Yes — Funnel **or Parallel** | **No** — *"No rounds"* (`landscape-features.md:193`) | Funnel rounds + `round_promotions`; per-round scorecards (MRQ-108) | **has it** |
| Parallel round mode | **Yes** | n/a | No — 2 unrelated `parallel` hits | **doesn't** — ruled "a `mode` column and one branch", parked |
| Committees / teams as assignment target | Yes | **No** — *"assignment is individual-only"* (`:193`) | `committees`, `committee_members`, per-round committees (`migrations/0010_evaluation_round_committees.sql`) | **has it** |
| Reviewer track scoping | Per-user filters | **No** — *"None below role"* (`stakeholders.md:327`) | `reviewer_track_scopes` + one intersection predicate shared by queue, detail, files, exports, writes; out-of-scope probe 403s and leaks no metadata | **has it** (unique depth) |
| Multi-track submissions | Single-select Track | Not researched | `submission_tracks` with explicit primary | **has it** |
| Blind / anonymized review | Yes | **Yes**, + field-level hiding | Yes — stripped in the **query layer**, byte-scanned (AC-64), reviewer shell has no admin chrome | **has it** (stronger) |
| Field-level hiding from evaluators | Yes | **Yes** (matrix `:122`) | No | **doesn't** |
| Weighted rubric / multi-criteria | Yes | Partial (◐, unsourced) | `rubric_criteria` + criterion kinds (`migrations/0009_criterion_kinds.sql`); weighted aggregate + score basis (`src/routes/evaluation-results.routes.ts:151`) | **has it** |
| **Comparison mode** (rank 3 at a time, ties allowed) | **No** | **Yes — its signature feature**, *"the single most interesting UX idea in the whole landscape"* (`landscape-features.md:420`) | `comparisons` table + routes + `comparisonWinCounts` (`src/routes/evaluation.routes.ts:1400`), surfaced on the record | **has it** — parity with Sessionize's best idea, and the gap analysis's "spec'd but not demonstrated" caveat is now stale |
| Conflict of interest / recusal | Yes | Partial (◐, unsourced) | "Declare conflict" in the reviewer UI (`src/ui/review/ReviewerPage.tsx:376`); recusal counts on the plan | **has it** |
| Per-round reviewer pools + reminders | Yes | Bulk/random assignment (Stars & Yes/No only, **not** Comparison) | MRQ-110 — pools, recusals, `reviewer_reminder` trigger | **has it** |
| Plan intake filters ("this plan reviews only Agents track") | **Yes** | n/a | 0 hits for `intake_filter` | **doesn't** — ruled "build at least this one" (if-capacity band) |
| Max evaluations per submission | Yes | Choose N evaluators per session | No | **doesn't** |
| Reviewer progress / aggregate stats | Yes | Yes | Per-reviewer progress + chair results (MRQ-109) | **has it** |
| "Thought-Provoking Sessions" (widest score spread) | **Yes** | No | No | **doesn't** — one `MAX-MIN` ordering; called "best idea-per-line in the whole incumbent" (`:108`) |
| Rating icon styles (faces/stars/hearts) | Yes | Stars mode | No | **deliberately skipped** |
| AI-assisted review | Yes (+ AI personas) | No | No — `/evaluation/ai` route **removed** in PR #27; grep finds no AI code | **deliberately skipped** — the brief strikes the clause; swyx: *"I don't care about the AI workflow thing"* |

## D. Decisions, waves & notifications — R51

| Module/Feature | Sessionboard | Sessionize | Marquee | Verdict |
|---|---|---|---|---|
| Accept / maybe / decline | Yes (Accept/Decline Queues) | Yes | Yes; `waitlisted` displays as **"Maybe"** so the judge meets their own word (`STATEMAP.md` §1) | **has it** |
| Status change triggers notification | **No** — KB verbatim: *"Changing a session status does not automatically email"* | Undocumented | **Yes** — the cascade *is* the notification, every downstream effect enumerated in the modal before you press (`src/jobs/cascade/decisions.ts`, `STATEMAP.md` §7) | **has it** (headline differentiator vs Sessionboard) |
| Decision + feedback rendered once into both email and portal | No | Feedback emails scored ● but **unsourced** | `submission_decisions` carries approve/maybe/deny + `feedback_md`, written by both single and bulk paths, rendered from one row | **has it** — this is R51, the bonus swyx named himself |
| Waves / rolling mid-CFP acceptance | Staging queues, not waves | Practised on Sessionize by AIE today (Wave 1/2/Final) — `[INFERRED]`, `competition-requirements.md:125` | `waves` table with decision dates, targets, progress; "Accepted · Wave 2" + next-wave date in the portal, never bare "pending" | **has it** |
| **Un-accept / reversal cascade** | No | **Never researched** — no evidence either way | Dialog enumerates portal tasks, queued emails, calendar invites with cancel/retain per item; both branches stamped in attributed history (`src/routes/submission-reversal.routes.ts`, `STATEMAP.md` §7b) | **has it** — no competitor is documented to ship it |
| Task-cancellation tombstone | n/a | n/a | `speaker_tasks.cancelled_at` nullable timestamp, not an enum value (`migrations/0005_...`); invisible to the overdue trigger | **has it** |

## E. Speaker portal — brief item 2 (MUST)

| Module/Feature | Sessionboard | Sessionize | Marquee | Verdict |
|---|---|---|---|---|
| Bio, headshot, self-managed profile | Yes | Yes | `src/routes/portal.routes.ts:57,112` | **has it** |
| **Pronouns** | **Yes** — named in the reference's own caption | Not researched | 0 hits across `src/` + `migrations/` | **doesn't** — one column; ruled "build at minimum" |
| Discrete LinkedIn / X / Website fields | **Yes** — swyx red-arrowed **"update your own bio data"** (p.17) | Yes | `social_links` JSON blob | **partial** — data is there, discrete labelled fields are not |
| Per-role confirm / decline | Confirms **per session** | Not applicable | `participations.confirmation_status` per `(person, submission, role)` (`portal.routes.ts:140`) | **has it** (finer-grained) |
| **Admin↔portal impersonation** (`View Portal` / `Back to Admin Mode`) | **Yes** — swyx red-arrowed the account dropdown (p.17) | n/a | 0 hits for `impersonat` / "Back to Admin" | **doesn't** — ~40% of the walkthrough is the speaker's view; ruled top-6 |
| Portal branding (logo, accent, welcome) | Yes, per portal | **No** (matrix `:92`) | Inherits event accent; MRQ-125 event branding merged — full portal branding unconfirmed | **partial** |
| Multiple portals (People/Exhibitor/Sponsor) | Yes | No | One speaker portal | **deliberately skipped** |
| Resources / wiki pages | Yes | No | No | **out of scope** — struck brief item 8 |
| Cross-event reusable speaker profile | No | **Yes — 83,000+ profiles** (`landscape-features.md:187`) | Org-level `people` (§K) — but no public network | **doesn't** (structurally impossible to self-host) |
| Banners tab (auto social graphics) | No | **Yes** (`:441`) | No | **doesn't** |
| Post-event attendee Feedback tab | No | **Yes** (`:199`) | No | **doesn't** |

## F. Speaker onboarding / task tracking — brief item 6 (MUST) — **the moat**

| Module/Feature | Sessionboard | Sessionize | Marquee | Verdict |
|---|---|---|---|---|
| Speaker task system at all | Yes — Portals › Tasks; swyx red-arrowed `Add Task` (p.23) | **NOTHING** — *"No task list. No file-request task. No due dates."* (`landscape-features.md:199`); *"no speaker task system whatsoever"* (`:206`); *"Sessionize has no task system at all"* (`:35`) | `task_templates` + `speaker_tasks`, three kinds (acknowledge · file · form) (`migrations/0001_init.sql:582,605`) | **has it** |
| Task templates + multi-speaker assignment | Yes | No | MRQ-114 (`src/routes/task-templates.routes.ts`, incl. `/task-assignees`) | **has it** |
| Due dates + overdue automation | Yes (5-day + 1-day auto-sends) | No | `due_at` / `due_offset_days` + `task_overdue` trigger (`src/jobs/mail/templates.ts`) | **has it** |
| **Real-time outstanding-task dashboard** | **No** — the KB's answer is build a filtered Contacts view; the closest thing to real-time is a **Monday 07:00 UTC digest email** | **No** | Speaker × task-type matrix, severity-ordered, live counts, filter chips, per-speaker drawer with message history, compose-and-nudge in place (`src/ui/onboarding/`) | **has it** — *"Nobody in the field ships this"* (`:186`). This is brief item 6, named verbatim |
| File requests as first-class objects | Yes, separate module | No — substitute is: attach a form to a group mailing, speaker uploads, organizer downloads a ZIP | Task kind `file`; central Files library (§J) | **partial** — no first-class File Request object |
| **File-request approval state** ("yellow clock = pending approval") | **Yes** | No | 0 approve/reject hits in `src/routes/files.routes.ts`; upload completes the task immediately | **doesn't** — the 40MB-"headshot" case has no bounce-back |
| Weekly portal digest email | Yes | No | Replaced by the live board | **deliberately skipped** |

## G. Scheduling / agenda — brief item 5 (MUST)

| Module/Feature | Sessionboard | Sessionize | Marquee | Verdict |
|---|---|---|---|---|
| Drag-and-drop scheduling | Yes | **Yes — "the best hands in the field"** (`:394`): drag-tile-onto-tile to swap, edge-resize, cross-room duration auto-align | Yes, no save button — placement persists as it happens | **has it** (micro-interactions are Sessionize's edge, not ours) |
| List / Day / Week / **Track** / Room views | list · day · week · **month** · rooms — **no track view** | Day ●, Room ●; List ◐, Week ○, **Track ○**; month absent | All five the brief asks for, incl. a true **track swimlane** with lane totals and a day band (`src/ui/agenda/AgendaPage.tsx:775,789`) | **has it** — the brief asks for the one view the entire market lacks |
| Month view | Yes (their own KB admits track colours don't render in it) | No | No | **deliberately skipped** — `SPEC.md` §8; track swimlane is the trade |
| Room-overlap conflict detection | Yes | Claimed on the features page, **never documented**; *"may be room-overlap only"* (`:527`) | Yes | **has it** |
| Speaker double-booking | Yes | Partial (◐) | Yes | **has it** |
| **Transit / travel conflict between buildings** | No | No | Third conflict class; "leave by 10:14" computed from the speaker's **own previous session's building** (`src/lib/venue-geometry.ts` `TransitConflict`, `src/lib/venue-disclosure.ts`) | **has it** — in no brief and no competitor |
| Batch publish | Yes | n/a | MRQ-124 | **has it** |
| Schedule versioning / release changelog | No | **No** (pretalx only) | No | **doesn't** |
| Agenda list view with full table toolbar | Yes | n/a | Chronological rows | **partial** — parked |

## H. Calendar invites — brief item 3 (MUST), verbatim "Gmail, Outlook, iCal"

| Module/Feature | Sessionboard | Sessionize | Marquee | Verdict |
|---|---|---|---|---|
| Calendar invite to the speaker's own calendar | **Zero.** 26 automated email triggers, no calendar anything | **Disputed.** One sales-page bullet — *"automated calendar placeholders"* — with **no supporting article**; matrix ◐; open question L1 (`landscape-features.md:501`) unresolved. **Do not claim Sessionize has nothing** | ICS `METHOD:REQUEST` with `ATTENDEE`, stable `/i/{uid}.ics`, Google/Outlook deep links, `LOCATION` + `GEO` carrying room *and* building (`src/jobs/calendar/ics.ts:246`) | **has it** |
| `SEQUENCE` bump on material change | n/a | Unknown | Yes (`ics.ts:246`; re-sends retain UID, increment SEQUENCE — `calendar-invites.routes.ts:33`) | **has it** |
| `METHOD:CANCEL` on reversal | n/a | Unknown | Yes (`src/jobs/calendar/invites.ts:239`) | **has it** |
| OAuth calendar write | No | Unknown | No — documented extension point (`STATEMAP.md` §9) | **deliberately skipped** — swyx ruled ".ics good enough" |

## I. Public site / embeds — struck item 9, but built anyway

| Module/Feature | Sessionboard | Sessionize | Marquee | Verdict |
|---|---|---|---|---|
| Public agenda, session + speaker pages | Yes | Yes | `public-agenda.route.tsx`, `/s/:id`, `/p/:name`; public speaker directory (MRQ-121) | **has it** |
| Embeds | Yes, **refresh every 60 minutes** | **Yes, strong** — 4 views (schedule grid, session list, speaker list, speaker wall), one-line script tag, JSON/XML/text/iCal/HTML, **WordPress plugin** | Agenda + speakers kinds, organizer embed area (MRQ-123), saved embeds (`migrations/0010_saved_embeds.sql`) | **has it** — fewer view types than Sessionize, no WordPress plugin |
| Embed freshness | 60 min | Undocumented — **the 60-min figure is Sessionboard's, do not attribute it to Sessionize** | **30 s** `Cache-Control: public, max-age=30, s-maxage=30` (`src/routes/embed.route.tsx:112,141`) | **has it** |
| Attendee personal schedule + ICS feed | No | No | `src/routes/public-schedules.routes.ts` incl. `/schedules/{code}/calendar.ics` (MRQ-132) | **has it** — *not live yet* |
| Agenda JSON feed | Yes | Yes (read-only API) | `/agenda.json` | **has it** |
| CMS / program-site builder (custom HTML/CSS/JS) | Yes | No | No | **out of scope** — labelled **(OPTIONAL)** p.30, not excluded |

## J. Files

| Module/Feature | Sessionboard | Sessionize | Marquee | Verdict |
|---|---|---|---|---|
| Central files repository | **Yes** — `Program › Files` and `Portals › Files`, to 1.95 GB, versioned | Export page bundle only | `src/routes/files.routes.ts`, `src/ui/files/FilesPage.tsx` (MRQ-115) | **has it** |
| Version history | Yes | No | `src/lib/files/versions`, `FileVersions.tsx` | **has it** |
| Comments on deliverables | No | No | `src/routes/file-comments.routes.ts`, `migrations/0009_file_comments.sql` (MRQ-116) | **has it** |
| Bulk ZIP export | Yes (red-arrowed p.21) | Yes | Streamed ZIP-STORE, 1 GB cap, missing items listed in `manifest.txt` (`src/routes/files-export.routes.ts`) | **has it** |
| Approval / reject state | **Yes** | No | No | **doesn't** |

## K. People / speaker records — **note the scope tension**

| Module/Feature | Sessionboard | Sessionize | Marquee | Verdict |
|---|---|---|---|---|
| Org-level person record outliving the event | CRM module | Cross-event profile | `/api/v1/org/people` + notes, tags, stage (`src/routes/people.routes.ts:199+`, `migrations/0012_people_annotations.sql`) | **has it** — *not live yet*. **But R8 rules CRM out of scope**; the route table argues People is org-level, not CRM (`src/ui/shell/route-table.ts:1–8`). Flagging honestly: this is the one module built *past* the ruled scope line |
| Saved Lists | Yes | No | `src/routes/person-lists.routes.ts` | **has it** (same caveat) |
| Sourcing pipeline | Yes | No | `/api/v1/org/pipeline` | **has it** (same caveat) |
| Speaker roster + person CRUD | Yes | Yes | MRQ-111 (`/roster`, `src/routes/speakers.routes.ts`) | **has it** |
| Portal invites + speakers CSV | Yes | Yes | MRQ-112 (`src/routes/speaker-invites.routes.ts`) | **has it** |
| Year-round cross-event CFP collection | Yes | Yes | No | **out of scope** (R8) |
| Groups — exhibitors / sponsors as records | Yes | No | No | **out of scope** (R8) |
| Personas / audience segments | Yes | No | No | **deliberately skipped** |

## L. Communications — brief item 3 (MUST)

| Module/Feature | Sessionboard | Sessionize | Marquee | Verdict |
|---|---|---|---|---|
| Templated emails with merge variables | **Yes — 26 automated triggers** | **Contested.** Prose: *"No templates, no triggers, no automation"* (`:197`); matrix `:98` scores ● — merge vars inside a manually-composed group mailing. **The matrix row overstates it** | 13 template keys: acceptance, rejection, submission_confirmation, task_assigned, task_link, task_overdue, form_closing_reminder, reviewer_reminder, reminder_generic, draft_resume, magic_link_login, added_to_submission, custom (`src/jobs/mail/templates.ts`) | **partial** — real triggers and templates, but **13 vs their 26** |
| Bulk reminder / nudge | Yes | Group mailings | `enqueueBulkReminder` (`src/routes/comms.routes.ts:11`) | **has it** |
| Branded outbound mail wrapper | Yes (Email Themes module) | Unknown | Unconfirmed | **partial** — ruled if-capacity |
| Demo-safe outbox with honest "not delivered" label | No (demo-gated product) | n/a | Allowlist in the single queue consumer, exactly two audited bypasses; full render shown in the comms log | **has it** — judging-integrity feature |
| SMS | Yes | No | No | **out of scope** (R8) |

## M. API / CLI / agent surface — **explicit brief bonus**

| Module/Feature | Sessionboard | Sessionize | Marquee | Verdict |
|---|---|---|---|---|
| Public API | Yes (Mintlify docs, linked in the brief) | **Read-only** (`landscape-features.md:203`), and *"By default… shows only accepted sessions whose speakers have been informed"* — i.e. mid-CFP it omits the ~1,000 undecided submissions that are the entire point | Full read/write REST + OpenAPI; the admin SPA is a client of the same routes; `check:api` fails on any request path missing from the public document | **has it** (decisive) |
| Scoped API tokens | Yes | `Developer` role with API/Embed access | `api_tokens`, `src/routes/tokens.routes.ts` | **has it** |
| Optimistic concurrency (ETag / If-Match) | No | No | `src/api/concurrency.ts` | **has it** |
| Rate-limit headers, one error envelope, durable `operation_id` | Partial | No | `src/api/rate-limit.ts`, `src/api/errors.ts`, `src/api/bulk.ts` | **has it** |
| CLI | **No** | **No** | `cli/marquee.mjs` + `registry.mjs` + generated `api-registry.json` | **has it** |
| Agent skill file | No | No | `SKILL.md` (17.7 KB), generated by `cli/generate-skill.mjs`; copyable agent briefs on four operator surfaces (MRQ-130) | **has it** |
| **Outbound webhooks** | Integrations module (Cvent, Swoogo, Zoom) | No evidence either way | Schema only — `webhook_endpoints`, `webhook_deliveries`, `WEBHOOK_EVENT_TYPES` exist (`migrations/0005_...`, `src/db/schema.ts:102`), but **no `webhooks.routes.ts`, no writer** (migration comment: *"the future webhook writer"*), and `/settings/webhooks` was dropped from the route table | **doesn't** — `SITEMAP.md:246` still advertises the screen. **Stale doc, and it will be checked** |

## N. Platform, hosting, pricing

| Module/Feature | Sessionboard | Sessionize | Marquee | Verdict |
|---|---|---|---|---|
| Price | **>$40k/yr** (PDF p.1, the only pricing figure in 37 pages); $9,999 for one AIE event | **$499/event**, free for community events; *"Sessionize's $499 is confirmed"* (`:531`) | Self-host cost only | **has it** — but see the frame below |
| Open source / self-hostable | No | **No** | Apache-2.0, one Worker + D1 + R2 | **has it** — the entire premise |
| Self-serve demo, no sales gate | **No** — swyx on camera: *"You cannot do a self-guided tour"* | Yes | One-click organizer/speaker entry, ~1,000 seeded submissions on the real AIE shape, ≤20s idempotent reset | **has it** |
| Cold start (git clone → owned conference) | No first-run experience | n/a | `?empty=1` walk, 5-step checklist ticking from real work (MRQ-105, `src/ui/setup/`, `migrations/0011_cold_start.sql`) | **has it** — makes the open-source claim real |
| Multi-event under one org | Yes (org switcher) | **Yes** | Events collection + copy engine + switcher (MRQ-129, `src/lib/events/copy-event.ts`, `copy-manifest.ts`) | **has it** — *not live yet* |
| Cloudflare deploy | n/a | No | Yes — `marquee.stage11.dev` | **has it** — **"mild bonus"** per PDF p.2 |
| **Airtable persistence** | n/a | No | **CANCELLED** (MRQ-25/MRQ-26). `npm run check:mirror` is a *stub* declaring it unimplemented; PR #27 removed `/settings/airtable`. Only `last_write_source='airtable'` and a delivery state survive | **doesn't** — **a named brief bonus, forfeited.** `sessionboard-gap-analysis.md:214` (List B #15) claims a "genuine two-way Airtable mirror" and **is false as shipped** |
| Forgejo hosting | n/a | n/a | GitHub | **deliberately skipped** — "very teeny" bonus |
| Speed as a measured constraint | swyx complains **3× unprompted**; names it as why we can win | Not documented as slow | `npm run check:speed` + `speed-budgets.mjs`; per-surface p95 budgets against ~1,000 seeded submissions | **has it** vs Sessionboard; **unproven** vs Sessionize |
| Team roles + admin UI | `Event Team` nav item; multi-org switcher | 6–7 fixed roles (sources disagree) | 5 roles in `memberships`, enforced everywhere, **no admin UI** except committee membership | **partial** |
| Global History module | Yes, org-wide activity log | No | Per-record content history + restore (`src/ui/history/ContentHistory.tsx`, MRQ-118) + `audit_log`; no global list | **partial** |
| Dashboard builder (named dashboards, widget gallery, AI prompt) | Yes | No | One fixed Program pipeline dashboard | **deliberately skipped** — swyx: *"optional but nice to have, best efforts"* (p.32) |
| Submission pacing chart w/ edition comparison | Yes | No | 0 hits | **doesn't** — ruled top-6; the one analytic that drives "do we extend the CFP?" |
| CRM · Marketing · Reports · Studio · Awards | ~75% of their navigation | No | No | **out of scope** (R8) — *and the absence is the point* |

---

## The real competitive frame

**Thesis under test:** *"Sessionize's scope, self-hosted, owned, faster, plus the post-acceptance
workflow Sessionize lacks."*

**Verdict: the last clause is true, well-evidenced, and load-bearing. The other three each need
a correction before they go in public copy.**

### What survives contact

**"The post-acceptance workflow Sessionize lacks" is the strongest claim in the deck, and it is
the only one sourced four separate times in our own research.** Sessionize's own scope statement
is *"We don't handle anything that has to do with your event's audience"*
(`landscape-features.md:189`), and the corpus is unusually blunt: *"No task list. No file-request
task. No due dates. No wiki pages"* (`:199`), *"no speaker task system whatsoever"* (`:206`),
*"Sessionize has no task system at all"* (`:35`), *"This is the seat Sessionize does not serve at
all"* (`stakeholders.md:104`). Concretely, what Marquee ships into that void:

1. **A task system at all** — `task_templates` + `speaker_tasks`, three kinds, due dates,
   multi-speaker assignment: `migrations/0001_init.sql:582,605`, `src/routes/task-templates.routes.ts`.
2. **The real-time chase board** — brief item 6 verbatim — a speaker × task-type matrix ordered
   by severity with nudge-in-place: `src/ui/onboarding/`. Sessionboard's answer is a Monday
   digest email; Sessionize has no answer.
3. **The acceptance cascade** — the status change *is* the notification, with every downstream
   effect enumerated before you press: `src/jobs/cascade/decisions.ts`, `STATEMAP.md` §7.
4. **The un-accept cascade** — reversal with per-dependent cancel/retain and an attributed
   tombstone: `src/routes/submission-reversal.routes.ts`, `speaker_tasks.cancelled_at`. Nobody
   in the field is documented to ship reversal.
5. **A real calendar-invite lifecycle** — `METHOD:REQUEST`, `SEQUENCE` bump, `METHOD:CANCEL`:
   `src/jobs/calendar/ics.ts:246`, `src/jobs/calendar/invites.ts:239`. Sessionboard has zero;
   Sessionize has one undocumented marketing bullet.
6. **One decision record rendered into both the email and the portal** —
   `src/routes/submission-decisions.routes.ts`. This is R51, the bonus swyx named himself.
7. **Files with versions, comments and a streamed ZIP** — `src/routes/files.routes.ts`,
   `file-comments.routes.ts`, `files-export.routes.ts`. Sessionize's substitute is attaching a
   form to a group mailing.
8. **Per-role confirm/decline** — `participations.confirmation_status` per `(person, submission,
   role)`. Sessionboard confirms per session.

That is a defensible, checkable moat. Lead with it.

### Where the thesis has to be corrected

**"Sessionize's scope" — nearly true, with four named exceptions, and one of them cuts.**
Marquee now matches Sessionize's signature **Comparison mode** (`src/routes/evaluation.routes.ts:1400`
— the gap analysis's "spec'd but not demonstrated" caveat is stale) and beats it outright where
Sessionize is thin: Sessionize has **no rounds, no committees, and no reviewer track scoping**
(`landscape-features.md:193`, `stakeholders.md:327`) — all three of which Marquee ships. But
Marquee does **not** have: the cross-event speaker network (83,000+ profiles — structurally
impossible for a self-hosted tool), multi-language, the Banners tab, the post-event Feedback tab,
or Sessionize's schedule micro-interactions (drag-tile-onto-tile swap, edge-resize, cross-room
duration auto-align — `:396`, *"the best hands in the field"*). Say "Sessionize's scope for the
program you run" and the claim holds; say it unqualified and a Sessionize user will find the hole
in ten seconds.

**"Faster" — true against Sessionboard, unproven against Sessionize.** swyx complains about
Sessionboard's speed three separate times unprompted and names it as why he thinks we can win.
**Nothing in the corpus says Sessionize is slow.** We have real budgets
(`scripts/checks/check-speed.mjs`) but no comparative measurement against Sessionize. Frame speed
as *"fast, and measured"* — a property we hold ourselves to — not as *"faster than the tool you
use."*

**"Owned" — true and the sharpest wedge, but the price story inverts.** Sessionboard is
>$40k/yr (PDF p.1). **Sessionize is $499/event, free for community events.** Our own research is
blunt: *"AIE is not currently overpaying; they are being asked to overpay by 20×. Marquee cannot
win on 'cheaper than Sessionboard' — Sessionize already is, by an order of magnitude"*
(`landscape-features.md:23`). Against the incumbent-to-be-killed, price is the story. Against the
tool AIE actually runs, the story is **ownership, extensibility and the API** — a real read/write
REST surface plus a CLI and `SKILL.md`, against Sessionize's **read-only** API that *by default
returns only accepted sessions whose speakers have been informed*, i.e. mid-CFP it omits the
~1,000 undecided submissions that are the entire point (`stakeholders.md:277`).

### Three things to fix before this becomes public copy

1. **Delete the Airtable claim.** `sessionboard-gap-analysis.md:214` advertises *"a genuine
   two-way Airtable mirror"*. It was **cancelled** (MRQ-25/MRQ-26); `npm run check:mirror` is a
   stub that says so; PR #27 removed the settings screen. Airtable persistence is a **named brief
   bonus (p.2)** and it is forfeited. Claiming it is the single largest factual exposure here.
2. **`SITEMAP.md` advertises two things that don't exist** — `#settings/airtable:244` and
   `#settings/webhooks:246`. Webhooks are schema-only with no writer and no route module. A judge
   who reads the sitemap and clicks will find the dead end, and PR #27's own commit message
   articulates the principle: *"An installed route claims a module exists."*
3. **Six ruled "contract now" items never landed** and are all on the customer-annotated path:
   rich-text toolbar, Tags/Level, auto-redirect to portal (annotated *"make sure this works"*),
   admin↔portal impersonation (red-arrowed p.17), per-plan ratings column, pacing chart. Plus
   pronouns and the internal/external form names. None are fatal individually; collectively they
   are the difference between "matches the incumbent's surface" and "matches the incumbent's
   workflow." Do not claim surface parity with Sessionboard's Program module — claim **workflow
   superiority**, which is true and provable.

---
---

# PART 2 — What 100% on the eval actually requires


Ground truth read: `.eval-kit/` @ `8109958` (freshly pulled; our digest `sequence/EVAL-KIT.md`
is pinned at `2b0f795` and is now one commit stale — see §0).
Deployed build: `8dc17d304472` (PR #103, built 2026-08-12T17:10Z).
True `github/main`: `d520c320`. **Live is 25 commits behind main.**

---

## 0. RUBRIC DRIFT — the digest is wrong in one decisive way

Area weights, item counts and item weights in `specs/*.yaml` match our digest **exactly**.
No drift there. The drift is in the **scorer**, and it inverts our risk model.

`.eval-kit` commit `8109958` "Stop scoring absence of evidence as evidence of absence"
(swyx, 2026-08-12 09:11 PT) changed `src/report.ts`:

```ts
// src/report.ts:79-84
const looked = new Set(
  evidence.filter((e) => e.outcome === "completed" || e.outcome === "feature_not_found")
    .map((e) => e.scenarioId),
);
// src/report.ts:101-107
const backing = r.scenarios ?? [];
const everLooked = backing.length === 0 || backing.some((id) => looked.has(id));
if (!everLooked && (item.verdict === "not_found" || item.verdict === "fail")) {
  unproven.push(r.id);
  pendingManual.push(r.id);
  continue;          // ← NOT added to `judgeable`
}
```

A scenario that hits the turn cap ends `agent_error` (`src/agent.ts:232`, `:521`) — it is
**not** in `looked`. So every `fail`/`not_found` resting only on turn-capped scenarios is now
discarded from the numerator **and the denominator**. `pass`/`partial` still stand.

**Net effect: percentage goes up, coverage goes down.** Proven empirically — I rescored our
own run 1 with the new code (copy of the run dir, no API calls):

| | old scorer (`2b0f795`) | new scorer (`8109958`) |
|---|---:|---:|
| CFP pct | 40.7% | **68.8%** |
| CFP coverage | 71.1% | **42.1%** |
| headline | published | **WITHHELD** (42.1 < 60) |

Our digest's line "*a submission is never penalized for harness failures — but it is penalized
by the coverage cliff*" is now literally the scoring model. **Turn budget is no longer a
scoring variable; it is the scoring variable.**

---

## (a) Area / weight table — exactly as the specs define it

| Area | Spec file | `area_weight` | Scenarios | Items | Σ item weight |
|---|---|---:|---:|---:|---:|
| Call for Papers | `01-call-for-papers.yaml` | 20 | 4 | 18 | 38 |
| Abstract Management | `02-abstract-management.yaml` | 20 | 3 | 14 | 28 |
| Speaker Management | `03-speaker-management.yaml` | 15 | 3 | 16 | 33 |
| Content Management | `04-content-management.yaml` | 15 | 3 | 14 | 31 |
| AI Agenda & Schedule Builder | `05-ai-agenda.yaml` | 10 | 2 | 8 | 18 |
| Public & Embeddable Widgets | `06-public-widgets.yaml` | 20 | 3 | 16 | 35 |
| **Required total** | | **100** | **18** | **86** | **182** |
| Speaker CRM (`optional: true`) | `07-speaker-crm.yaml` | 10 | 2 | 12 | 19 |

**Point conversion.** Overall = area-weighted mean of area percentages
(`report.ts:aggregate`), where area pct = `earned / judgeable`. At full coverage one unit of
item weight is worth `area_weight / Σ item weight` of the final 100:

| Area | pts per item-weight unit |
|---|---:|
| Abstract Mgmt | **0.714** |
| Public Widgets | 0.571 |
| AI Agenda | 0.556 |
| Call for Papers | 0.526 |
| Content Mgmt | 0.484 |
| Speaker Mgmt | 0.455 |

Abstract Management is the richest area per unit of work — 20 weight over only 28 item-weight.

---

## (b) Per-area standing

Legend: **P** = confident pass · **F** = confident fail · **C** = coverage-dependent
(agent may never reach it). "live" = deployed `8dc17d30`; "main" = `d520c320`.

### Call for Papers — 20 wt, 18 items, 38 item-wt

| | Items | Notes |
|---|---|---|
| **PASS** | CFP-01 (w3), CFP-03 (w3), CFP-12 (w3), CFP-15 (w2) | CFP-01/03 already scored `pass` in run 1. `/f/cfp` is SSR and rich. |
| **PASS on main, FAIL on live** | CFP-05 (w3), CFP-06 (w3), CFP-07 (w1), CFP-17 (w2), CFP-18 (w2) | PR #99 fixes the headshot dead end + the self-inflicting abstract cap; MRQ-129 lands multi-event. **11 item-wt = 5.8 pts sitting on main, invisible to a grader.** |
| **PARTIAL** | CFP-02 (w1), CFP-10 (w2), CFP-14 (w2) | CFP-10 softened: `/reviewer?demo=reviewer` is a real live door (see §e); the un-provable half is admin-nav absence. |
| **COVERAGE** | CFP-04 (w2), CFP-09 (w2), CFP-11 (w2), CFP-13 (w2), CFP-16 (w2) | All five were `cannot_judge` in run 1. All are `rule`/`roundtrip` reached at the tail of CFP-S3/S4 — exactly the items the 70-turn cap eats. **10 item-wt = 5.3 pts of pure coverage risk.** |
| **MANUAL** | CFP-08 (w1) | `testability: manual`, never auto-judged. |

### Abstract Management — 20 wt, 14 items, 28 item-wt

| | Items | Notes |
|---|---|---|
| **PASS** | ABS-05 (w3), ABS-08 (w2), ABS-10 (w3), ABS-11 (w2) | MRQ-107 (reviewer provisioning), MRQ-109 (weighted aggregates, score sort, export, per-reviewer progress) are merged **and deployed**. |
| **PASS on main** | ABS-02 (w2), ABS-12 (w1), ABS-09 (w1) | MRQ-110 "per-round reviewer pools, recusals, and reminders" (#90) — deployed. |
| **HALF-SATISFIED → likely PARTIAL** | ABS-01 (w3), ABS-03 (w3) | Digest's structural finding: **one shared scorecard per evaluation plan, not per round**. ABS-01 requires two+ rounds *each with its own scorecard*; migration `0009_criterion_kinds.sql` + `0010_evaluation_round_committees.sql` exist but I could not confirm per-round scorecard binding. **Adversarial read: this is a real gap, not a reach problem.** |
| **PASS/PARTIAL** | ABS-04 (w1), ABS-07 (w2), ABS-13 (w2) | Weighted criteria + anonymization exist in `EvaluationPage.tsx`/`ReviewerPage.tsx`; ABS-07/ABS-13 are `auto-partial` so half routes to manual regardless. |
| **FAIL** | ABS-14 (w1) | AI triage is a declared non-goal (R27). Correct call — 0.7 pts. |
| **COVERAGE** | ABS-06 (w2) | Bulk assignment tooling; deep in ABS-S2. |
| **NEW RISK** | ABS-S3 is `persona: reviewer` | Fixed — see §e. Was worth ~20 pts of coverage. |

### Speaker Management — 15 wt, 16 items, 33 item-wt

| | Items |
|---|---|
| **PASS** | SPK-01 (w3, `/roster` + search), SPK-02 (w3), SPK-03 (w2, CSV import), SPK-04 (w2), SPK-05 (w2, MRQ-114 templates + multi-speaker), SPK-08 (w3), SPK-09 (w2), SPK-11 (w2), SPK-12 (w2) |
| **PARTIAL** (`auto-partial`, half always manual) | SPK-06 (w2), SPK-07 (w3), SPK-10 (w2), SPK-13 (w2) |
| **COVERAGE** | SPK-14 (w1 merge fields), SPK-15 (w1 travel/logistics fields) — tail of SPK-S3 |
| **MANUAL** | SPK-16 (w1) |
| **DEPLOY GAP** | #107 "speakers-only import + onboarding matrix overlap" is on main only — touches SPK-03. |

### Content Management — 15 wt, 14 items, 31 item-wt

| | Items | Notes |
|---|---|---|
| **PASS** | CNT-01 (w3), CNT-02 (w3), CNT-04 (w2 versions), CNT-05 (w2 comments), CNT-07 (w3), CNT-09 (w2), CNT-10 (w2), CNT-11 (w2 history+restore), CNT-13 (w1 files library) | `files.routes.ts`, `FileVersions.tsx`, `FileComments.tsx`, `BulkExportDialog.tsx`, MRQ-118 named history + restore — all deployed. Strongest area on the board. |
| **PASS** | CNT-14 (w2 ZIP) | MRQ-117 `files-export.routes.ts` — deployed. `auto-partial`. |
| **PASS** | CNT-03 (w3 speaker scoping) | |
| **COVERAGE / UNVERIFIED** | CNT-12 (w3 approval gate) | I found **no `content_status`/approval reference in `public-agenda.route.tsx`**. EMB-S1 step 2 has an explicit precondition assuming this gate exists. Adversarial read: the gate may not be wired to public output. **w3 × 0.484 = 1.5 pts at risk.** |
| **COVERAGE** | CNT-06 (w1 file constraints), CNT-08 (w2 bulk reminders) |

### AI Agenda — 10 wt, 8 items, 18 item-wt

| | Items | Notes |
|---|---|---|
| **PASS** | AIA-02 (w2), AIA-03 (w3), AIA-04 (w3), AIA-05 (w2), AIA-06 (w2), AIA-07 (w2) | Conflict machinery is real: `agenda.queries.ts` overlap logic, 8 seeded live conflicts, MRQ-124 batch publish. |
| **AT RISK** | AIA-01 (w3) | Requires "day navigation" across a **multi-day** event. Live event dates are 2027-05-12→14 but all sessions sit on 2026-10-12/13 — see §d#2. |
| **FAIL** | AIA-08 (w1) | No auto-schedule assist (`grep -rln "auto.schedule\|autoPlace"` → nothing). 0.6 pts. Correct to skip. |

### Public Widgets — 20 wt, 16 items, 35 item-wt (joint-heaviest)

| | Items | Notes |
|---|---|---|
| **PASS** | EMB-01 (w3), EMB-02 (w2), EMB-03 (w2), EMB-05 (w2), EMB-08 (w2), EMB-14 (w3), EMB-16 (w3) | Verified by curl: `/agenda` ships day tabs, Track/Format/Location facets, search, Show more, speaker name+title+company, Format/Track tags. `/embed/config` ships format+output+filter+accent+snippet+saved embeds. |
| **FAIL — LIVE, TODAY** | **EMB-06 (w3), EMB-07 (w2)** | `curl "/agenda?day=2027-05-12"` → **"No published sessions match."** All three declared day tabs are empty. See §d#2. **5 item-wt = 2.9 pts.** |
| **FAIL — one line of code** | **EMB-04 (w3), EMB-12 (w2)** | Both specs say "ordered alphabetically **by surname**". Live `/speakers` renders Aarush Selvan, Alexander Bricken, Aparna Dhinkaran, Baptiste Rozière… — first-name order. Cause: `src/lib/public-site.ts:707`. **5 item-wt = 2.9 pts.** |
| **FAIL on live, PASS on main** | EMB-09 (w2), EMB-10 (w1), EMB-11 (w1) | MRQ-132 personal schedule (`/agenda?view=mine`, `[data-schedule-star]`, `.ics`) is merged, **not deployed**. `/api/v1/public/schedules` → 404 on live, 200-shaped on main. **4 item-wt = 2.3 pts.** |
| **PARTIAL** | EMB-13 (w1), EMB-15 (w3) | Embed builder offers 4 formats (Agenda / Sessions / Speakers / CFP) against the rubric's five surfaces — itinerary and gallery are not selectable kinds. |

---

## (c) The 60% coverage cliff, precisely

Threshold (`src/config.ts:11`):
```ts
export const MIN_COVERAGE_PCT = 60;
```

Per area (`src/report.ts:128`):
```ts
coveragePct: totalWeight > 0 ? Math.round((judgeable / totalWeight) * 1000) / 10 : 0,
```
`judgeable` accumulates `r.weight` **only** for items that survive three filters:
`testability === "manual"` → skipped; `cannot_judge` / missing item → skipped; and (new)
`fail`/`not_found` whose every backing scenario ended `blocked`/`agent_error` → skipped.

Overall (`src/report.ts:aggregate`, area-weighted the same way as the score):
```ts
const coveragePct = presentWeight > 0
  ? Math.round((areas.reduce((s, a) => s + a.coveragePct * a.areaWeight, 0) / presentWeight) * 10) / 10
  : 0;
```

Withholding (`src/report.ts:buildReport`):
```ts
scoreWithheld: coverage < MIN_COVERAGE_PCT,
```

The cliff is evaluated **once, on the overall area-weighted mean**, over required areas only.
A single area below 60 does not withhold; the weighted mean below 60 withholds everything.

**Our current coverage risk: severe.** Three compounding facts:

1. Run 1: **4 of 4 CFP scenarios hit the 70-turn cap** (`report.json` → all `agent_error`).
   70 is the graders' default (`config.ts:8`).
2. Under the new scorer that same evidence yields **42.1% coverage → withheld**.
3. Structurally unreachable-by-design weight: 5 `manual` items (CFP-08 w1, SPK-16 w1) plus
   11 `auto-partial` items whose manual half never scores automatically.

If the other five areas behave like CFP did, the overall lands in the low 40s and **the
headline score is withheld entirely** — the worst possible outcome, worse than a bad number.
Every hour spent shortening the agent's path is worth more than an hour spent on features.

---

## (d) THE MONEY SECTION — ranked by points per hour

| # | Action | Est. | Points at stake | pts/hr |
|---|---|---:|---:|---:|
| 1 | **Deploy `main`** | 40 min | **~10.5** | ~16 |
| 2 | **Fix the live demo's event dates** | 25 min | **~4.6** | ~11 |
| 3 | **Sort speaker directory by surname** | 15 min | **2.9** | ~11.5 |
| 4 | **Rewrite `submissionNotes`** | 20 min | ~3–10 + coverage | ~15 |
| 5 | **Public-site door on the landing page** | 10 min | coverage on 20 pts | very high |
| 6 | Wire the CNT-12 approval gate to public output | 60 min | 1.5 | 1.5 |
| 7 | Add itinerary + gallery as embed kinds | 60 min | ~1.7 | 1.7 |

### 1. Deploy `main` — ~10.5 points, 40 minutes. Do this first.
Live `8dc17d30` is 25 commits behind `d520c320`. Sitting on main, invisible to a grader:

- **PR #99** "Close five dead ends an outside evaluator walked into" — fixes the *critical*
  headshot-upload defect that made **every** public submission fail, plus the self-inflicting
  abstract cap (drafts counted against the limit, so the 4th draft 409'd forever), plus draft
  save/resume, plus `/site`→`/agenda`, plus reviewer identity on the queue.
  → unblocks CFP-05 (w3), CFP-06 (w3), CFP-07 (w1) and the whole downstream chain
  CFP-09/13/16 (w2 each). **~6.8 pts.**
- **MRQ-129 multi-event** (#104/#108) → CFP-17 (w2), CFP-18 (w2). **2.1 pts**, and it deletes
  the judge's "advertised but not implemented" major defect.
- **MRQ-132 attendee personal schedule** (#102) → EMB-09/10/11. **2.3 pts.**
- `/agents` (the agent-facing route map) currently returns the 1484-byte SPA shell on live;
  on main it is a real page. Pure coverage.

Procedure is already written down: `DEPLOY.md` lines 35-55. Deploy from a clean worktree,
`npx vite build` before `npx wrangler deploy` (not optional), verify by `/health` sha.
`git diff --name-only 8dc17d30 github/main -- migrations/` is **non-empty** (0011_cold_start,
0011_public_schedules, 0012_people_annotations), so the schema step at `DEPLOY.md:58-59`
applies.

### 2. Fix the live demo's event dates — ~4.6 points, 25 minutes.
Run 1 renamed the demo event to "DevFlow Conf 2027" and moved its dates to 2027-05-12→14.
The 25 seeded sessions never moved; they are still on 2026-10-12/13. Verified:

```
GET /api/v1/public/agenda?event=aie-ny-2026
  days declared : ['2027-05-12', '2027-05-13', '2027-05-14']
  session dates : 2026-10-13 ×20, 2026-10-12 ×5
GET /agenda?day=2027-05-12  →  "No published sessions match."
```

Every day tab is empty. Kills **EMB-06 (w3)** and **EMB-07 (w2)** = 2.9 pts, endangers
**AIA-01 (w3)** = 1.7 pts, and keeps the judge's live branding-mismatch defect (venue reads
"Moscone West, San Francisco" while every room is at the New York Marriott Marquis).

**`npm run reset:demo` will not work against production** — `admin-ops.routes.ts:164-170`
gates it on the loopback-only `x-marquee-local-validation` header, and `scripts/reset-demo.mjs`
requires `LOCAL_VALIDATION_TOKEN`. Remote invocation auth is explicitly deferred to MRQ-57.
Use the documented remote path instead: `npm run seed -- --remote` (`DEPLOY.md:59`,
"deterministic upserts: converges, does not duplicate"), or a targeted
`wrangler d1 execute DB --remote` restoring `events.name/starts_on/ends_on/venue`.
**Verify afterwards with the two curls above — do not trust the deploy.**

### 3. Sort the speaker directory by surname — 2.9 points, 15 minutes.
File: `src/lib/public-site.ts:707`
```ts
speakers: [...speakersById.values()].sort((left, right) => left.name.localeCompare(right.name)),
```
Sorts on the full name, i.e. first name. EMB-04 (w3) and EMB-12 (w2) both state
"ordered alphabetically **by surname**" as a pass requirement. Change the comparator to key on
the last whitespace-delimited token (falling back to the full name for mononyms), and pin it
with a test. Highest points-per-minute item on the board.

### 4. Rewrite `submissionNotes` — 3–10 points plus broad coverage, 20 minutes.
`.eval-kit/evalconfig.json` currently tells the grader four things that are false:

| Claim in the notes | Reality |
|---|---|
| "there is no one-click reviewer door … role 'reviewer' returns 400" | **False.** `POST /api/v1/auth/demo {"role":"reviewer"}` → **200**, mints Dario Quill; the landing page carries "Enter as reviewer". |
| "MULTI-EVENT — NOT IMPLEMENTED … do not spend turns hunting for it" | False once #1 ships. This sentence alone forfeits CFP-17 + CFP-18. |
| "There is no org-level speaker CRM outside a single conference." | **False.** `/people`, `/lists`, `/pipeline` all live; `/api/v1/org/people`, `/org/lists`, `/org/pipeline`, `/org/summary` all return 200. This sentence forfeits the entire 10-weight Speaker CRM extra-credit area. |
| ROUTES list | Omits `/people`, `/lists`, `/pipeline`, `/roster`, `/files`, `/tasks`, `/agents`, and the `/crm` `/directory` `/contacts` aliases that were added *specifically* so an agent's guesses land. |

Our digest's own hardest-won lesson applies: **verify the notes against the deployed build,
never against `SITEMAP.md`.** Write them last, after #1 and #2 land, and curl every route you
claim. Note the notes are also the only lever that directly buys coverage.

### 5. Public-site door on the landing page — 10 minutes, protects ~20 points.
The landing page's only links are `/submissions?demo=organizer`, `/reviewer?demo=reviewer`,
`/portal?demo=speaker`, `/f/cfp` (`src/routes/landing.route.tsx:179-182`). **Nothing points at
`/agenda` or `/speakers`.** EMB-S1 and EMB-S2 are `persona: attendee` starting logged-out at
the root, and Public Widgets is area weight 20 with 15 of 16 items behind that surface. The
agent's system prompt does list `/agenda` among its guesses (`agent.ts:166`), so this is a
turn tax rather than a wall — but turns are now literally the score. One `<a class="button
ghost" href="/agenda">View the conference site</a>` beside "View public CFP".

---

## (e) Scenario personas, entry points, and seat reachability

The specs declare no `entry_point` field. Every scenario starts the agent at the config `url`
(`agent.ts:248`) with `PERSONA: <persona>` and either a restored session or fixture
credentials (`agent.ts:251-254`). **The persona is a role the agent must talk its way into
from the site root** — which is exactly why a missing door costs whole areas.

| Persona | Scenarios | Weight behind it | Door from `https://marquee.stage11.dev` | Verdict |
|---|---|---:|---|---|
| **organizer** | CFP-S1/S3/S4, ABS-S2, SPK-S1/S3, CNT-S1/S3, AIA-S1/S2, EMB-S3, CRM-S1/S2 | majority | "Enter as organizer →" → `/submissions?demo=organizer`; `POST /api/v1/auth/demo {"role":"organizer"}` → 200 | **REACHABLE** |
| **speaker** | CFP-S2, ABS-S1, SPK-S2, CNT-S2 | ~30 | "Enter as speaker" → `/portal?demo=speaker`; demo auth → 200 | **REACHABLE** |
| **reviewer** | ABS-S3 (+ CFP-S3/S4 tails) | ~24.7 | "Enter as reviewer" → `/reviewer?demo=reviewer`; demo auth → **200**, mints `per_reviewer-dario-quill` with `memberships:[{role:"reviewer"}]` | **REACHABLE — the digest's ~24.7-point hole is CLOSED.** Landed via MRQ-107 (#82), deployed. |
| **attendee** | EMB-S1, EMB-S2 | 20 (all of Public Widgets) | **NO DOOR.** No landing link to `/agenda` or `/speakers`. The surfaces are fully anonymous (200, SSR, no auth) — they are simply not advertised. | **REACHABLE BUT UNADVERTISED** — the remaining seat-reachability defect. Fix #5. |

**MRQ-133 / MRQ-134 status.** MRQ-133 is **PR #111, still open** ("Sign in — the universal
door, a 401 that leads to it, and three server pages the assets router was swallowing").
What merged as #110 is only the *prototype* (`4d0e6f4d`, "Prototype the sign-in door and the
session wall") — and it is **not deployed**. I found **no MRQ-134 PR at all**; the branch
`mrq-134-agent-evaluator` exists locally but has no open or merged PR. So neither ticket has
changed live seat reachability. The reviewer seat was fixed earlier and independently, by
MRQ-107. `/login`, `/signin`, `/sign-in` all return the 1484-byte SPA shell on live — no
sign-in door exists on the deployed build, which is fine only because the three demo doors do.

---

## Bottom line

The build is far stronger than the digest describes — the reviewer seat works, People/CRM
ships, Content Management is close to a clean sweep. Two things stand between that and a
score: **a deploy that never happened** and **a demo database still wearing the damage from
our own first eval run**. Neither is engineering. Both are under an hour, and together they
are worth roughly 15 points plus the difference between a published score and a withheld one.
---
---

# PART 3 — What Marquee has that nobody asked for

> *"What items does Marquee have that aren't even asked for by the competition? Because I think
> that's particularly important. Let's really go broad and list lots of things and then I can pare
> it down as necessary."*

This part is deliberately over-inclusive. Marginal items are **kept and marked marginal** rather
than dropped, because the operator asked for a list to pare down. Six groups, ~60 items.

**The test applied to every item:** does any R-number in
`sequence/research/competition-requirements.md` (R1–R54) ask for this? If yes, it belongs in
Part 1, not here. If no, it is in scope for Part 3 — even if it is small, and even if a competitor
happens to ship it.

---

## The top ten — if only ten survive the pare-down

Ranked by *judge-visible differentiation per second of a judge's attention*, with the deployment
caveat applied. Every one of these is unasked-for.

| # | Item | Tag | Why it earns the slot |
|---|---|---|---|
| 1 | **The UI is a plain client of a 187-operation API** — a UI-only capability is structurally un-writable (`src/api/route.ts`) | `verified-live` | The brief said "bonus points for API." This is a different category of answer. |
| 2 | **The `marquee` CLI — 45 commands, zero dependencies** | `verified-in-code` | Nobody asked for a CLI. Neither competitor has one. |
| 3 | **A content-addressed OpenAPI doc** — its ETag *is* the SHA-256 of its own bytes | `verified-live` | Ten-second demo, impossible to fake, and no conference SaaS does it. |
| 4 | **"Marquee never phones home"** — a privacy posture stated structurally, not as policy: the log builder *has no field* for an email address | `verified-in-code` | The only item here that speaks to the speaker rather than the organizer. |
| 5 | **The un-accept cascade** — reversal with per-dependent cancel/retain and an attributed tombstone | `verified-in-code` | No competitor is documented to ship reversal at all. |
| 6 | **The "decided but not told" surface** — live: *"616 speakers have not heard from you."* | `verified-live` | A number no other product computes, on a screen no rubric asks for. |
| 7 | **`SKILL.md`, generated from the CLI registry and gated by a test** that fails if the file mentions `curl` | `verified-in-code` | The gate is the story: a fallback to curl means the CLI has a hole. |
| 8 | **Demo-safe mail mode + the outbox** — an allowlist in the single queue consumer, exactly two audited bypasses | `verified-live` | Judging integrity. A judge can press Send without mailing 900 real people. |
| 9 | **Transit conflicts between buildings** — *"leave by 10:14"*, computed from the speaker's own previous session | `verified-in-code` | A third conflict class that exists in no brief and no competitor. |
| 10 | **The traceability chain** — R-number → US → AC → MRQ ticket → PR → test title, enforced by `trace:ac` | `verified-in-code` | swyx called this "somewhat of a recruiting exercise." This is the answer to that. |

**Deliberately not in the top ten:** anything AI-shaped. swyx: *"I don't care about the AI workflow
thing."* Marquee's AI story is that it **removed** the AI reviewer route (PR #27) — and the one
genuinely novel AI-adjacent idea, the agent evaluator seat, is unmerged. See Group A.

---

## Group A — The agent-native surface

*What Marquee has that the competition brief never asked for.*

The brief's entire ask on this axis is **"bonus points for API."** Everything below
that line is unasked-for.

---

#### Verification ground truth (read this before quoting anything)

Three trees are in play and they do not agree. Every claim below is tagged
against the right one.

| Tree | State |
|---|---|
| **Deployed** `https://marquee.stage11.dev` | sha `8dc17d30` (PR #103), built `2026-08-12T17:10:02Z`. **25 commits behind main.** |
| **`github/main`** | tip `d520c320`. The real repo. 62 route modules, 45 CLI commands. |
| **Primary checkout** `deployments/Marquee` | **91 commits behind main.** Do not read source from it. |

Not yet deployed (built and merged, but behind the live sha): MRQ-129 multi-event
(#104/#108, added the CLI conference verbs), MRQ-105 cold-start (#97 — setup CLI
verbs + SKILL setup chapter), MRQ-132 (#102), sign-in (#110), evaluator dead-end
fixes (#99).

Verification vocabulary used below:
- `verified-live` — curled against the deployed site, output quoted.
- `verified-in-code` — read the implementing code on `github/main`; not on the live sha.
- `claimed-in-docs-only` — a doc asserts it; no implementing code found.

**Headline live numbers, all curled 2026-08-12:**
- `GET /api/openapi.json` → **200, 389,299 bytes, `application/json`**
- **148 paths / 187 operations**, OpenAPI **3.1.0**
- ETag `"1c4505c1859203b7a33b0dc03ec4477031068498090be9be08c12d0752a0f82d"` — **byte-identical to `shasum -a 256` of the response body.**
- `GET /api/docs` → **200, 58,674 bytes**, `<meta name="marquee-openapi-operations" content="187">`, same digest printed in the footer.

---

### TIER 1 — The loud ones

#### 1. A 187-operation REST API where the UI is just another client

**What it is.** 148 paths, 187 operations across 31 tags (Submissions 14,
Evaluation 19, Forms 17, People 17, Comms 8, Agenda 6, Speaker portal 11, Uploads
8, Public 4, Meta 2 …). 163 secured, 24 deliberately public.

**Why it exists.** `src/api/route.ts` makes it structurally impossible to ship a
UI-only capability: `defineApiRoute` is the *only* way a route enters the
registry, and it takes the OpenAPI definition and the handler as **one object**.
There is no way to register a contract without a handler, and no way to ship a
handler the document doesn't describe. `src/routes/_manifest.ts` is a bare
`import.meta.glob("./**/*.routes.ts")` — nobody maintains an import list, so
"forgot to document it" isn't a failure mode that exists.

**Who it serves.** Any agent, any script, any second frontend. And the organizer
who wants out later — the API *is* the export.

**What it beats.** Sessionize has no public write API at all. Sessionboard's API
is a partial, sales-gated bolt-on. Neither ships an API that the vendor's own UI
is a plain client of.

**Judge pitch.** *"The bonus was 'has an API.' Marquee's UI is a client of its own
187-operation API — there is no privileged surface, and the architecture makes a
UI-only feature un-writable."*

**Status:** `verified-live` (187 operations enumerated from the deployed document).

---

#### 2. A live, machine-readable OpenAPI 3.1 document whose ETag is its own SHA-256

**What it is.** `GET /api/openapi.json`, public, unauthenticated, 389KB, generated
at boot from the same route objects the router registers (`src/api/openapi.ts`).
The document is **canonicalized** (keys recursively sorted), serialized exactly
once, and SHA-256'd over those exact UTF-8 bytes. That digest is the ETag.

```
$ shasum -a 256 <(curl -s .../api/openapi.json)
1c4505c1859203b7a33b0dc03ec4477031068498090be9be08c12d0752a0f82d
$ curl -sI .../api/openapi.json | grep etag
etag: "1c4505c1859203b7a33b0dc03ec4477031068498090be9be08c12d0752a0f82d"
```

**Why it exists.** So an agent can verify byte-for-byte that the schema it cached
is the schema the deployment is serving — and so `check:api` can compare served
JSON, rendered docs, and the emitted CLI registry *mechanically* rather than by
eye.

**Who it serves.** Every agent's first call. The four in-product agent briefs all
open with *"Read /api/openapi.json first."*

**What it beats.** Nobody in this category serves a live generated spec. Sessionize
publishes an embed API doc page; Sessionboard publishes PDF-grade docs behind a
sales motion. A content-addressed spec is not something conference SaaS does.

**Judge pitch.** *"The schema is served live, generated from the running route
table, and content-addressed — its ETag is the SHA-256 of its own bytes, so an
agent can prove the contract it holds is the contract being served."*

**Status:** `verified-live`.

---

#### 3. `/api/docs` — a rendered reference with zero external dependencies

**What it is.** A self-contained HTML reference (58KB) rendered from the same
bundle. It **fetches** `/api/openapi.json` rather than embedding a copy, prints
the digest it rendered and the operation count in `<meta>` tags, and carries **no
`<script>` tag and no `https://` src or href** — enforced by a check.

**Why it exists.** R8: it has to render inside a clean self-host container with no
public network access. A Swagger UI CDN script would break exactly the operator
Marquee is built for.

**Who it serves.** The human on the way to the API, and the agent that would
rather read a table than a 389KB JSON blob. Linked from the app sidebar
(`⌘ API & CLI`) and from Settings → API tokens ("Read API & CLI docs").

**What it beats.** Every competitor's docs are a CDN-hosted Swagger/Redoc page or
a marketing site. Neither survives an air-gapped self-host.

**Judge pitch.** *"An API reference that renders with no CDN, no external font, no
script — because a self-hosted conference platform shouldn't need the public
internet to explain itself."*

**Status:** `verified-live` (200, 58,674 bytes, meta digest matches served digest,
187 operations declared).

> **Adversarial:** the sidebar label and the README both say **"API & CLI"
> reference**. The page is **API-only** — `grep -c "marquee.mjs"` on the live
> page returns **0**, and `renderDocsShell` never touches `COMMAND_REGISTRY`.
> Do not claim `/api/docs` documents the CLI. Say "rendered API reference."

---

#### 4. `check:api` — a three-way parity gate that runs on every PR

**What it is.** `scripts/checks/check-api.mjs`, wired into `pr-gate`. It boots the
**built Worker bundle in-process**, fetches both meta endpoints for real, and
asserts:
- served ETag === SHA-256 of served body
- the document passes `@scalar/openapi-parser` validation
- no duplicate operation signatures, no operation missing an `operationId`
- rendered `/api/docs` digest === served digest, and rendered operation count === served count
- `/api/docs` contains no `<script>` and no external `src`/`href`
- **no unversioned path drift** — anything outside `/api/v1` must be on a named 3-entry allowlist (`/i/{uid}.ics`, `/agenda.json`, `/api/v1/public/agenda.ics`) plus the two meta paths
- the emitted `cli/api-registry.json` signature set === the served signature set, and its `documentSha256` === the served digest

**Why it exists.** A generated spec drifts silently. This makes drift a red PR.

**Who it serves.** Every future contributor. This is the thing that keeps the
agent-native claim true after the competition.

**What it beats.** Nobody ships their spec-parity harness. This is a
maintainer-grade artifact in a hackathon submission.

**Judge pitch.** *"The claim 'the docs match the API' is a CI gate, not a promise —
it boots the real Worker and compares three artifacts by digest."*

**Status:** `verified-in-code`. The report it emits names what it does **not**
cover (`notCoveredHere`: full-loop recorded-traffic parity is MRQ-9, unbuilt) —
that honesty is itself quotable.

---

#### 5. The `marquee` CLI — 45 commands, zero dependencies

**What it is.** `cli/marquee.mjs` + `registry.mjs` + `client.mjs` +
`diagnostics.mjs`. **45 commands** in 10 skill groups (`setup, conferences, seed,
configure, triage, agenda, publish, chase, diagnose, people`), referencing **44
distinct API operationIds**. Declared in `package.json` as `"bin": {"marquee":
"cli/marquee.mjs"}`. Pure Node ≥22 — `fetch`, no npm dependencies at all.

Full surface: `setup claim-link|health|instance` · `event
create|list|seed|show|set` · `forms create|list` · `evaluation plan` ·
`organizers list|invite` · `tracks list|add|remove` · `formats list|add|remove` ·
`submissions list|show|accept|reject|schedule|publish` · `tasks list` · `files
list` · `remind` · `diagnose` · `logs --tail` · `agenda
export|place|move|remove` · `search` · `people
list|show|note|tag|import|email` · `lists list|save` · `pipeline board|move`

Design details worth quoting:
- **`--filter` selects server-side.** `submissions accept --filter status=submitted` posts the *filter* to the bulk endpoint. The CLI never paginates a list and guesses an ID set — the server resolves the selection. Same parsed filter object serves UI list reads and bulk selectors.
- **`--json` discipline:** exactly one parseable JSON value on stdout.
- **`--set key=value`** is allowlisted per command against the route's own schema, so a typo fails locally naming the legal keys instead of as a server 400.
- `setup claim-link` and `setup health` are the two commands that run **before a credential exists**.

**Who it serves.** An agent operating a conference without a browser; an organizer
scripting their own workflow.

**What it beats.** Sessionize: no CLI. Sessionboard: no CLI. Nobody in this
category ships one.

**Judge pitch.** *"45 commands, no dependencies, `npx marquee` — the whole
operating loop from claiming a fresh instance to publishing the agenda, drivable
from a terminal or an agent."*

**Status:** `verified-in-code` (on `github/main`). **43 of its 44 operationIds
exist in the live deployed document** — I cross-checked every one. Only
`listEvents` (`marquee event list`, from MRQ-129) is main-only and would 404
against the current deploy.

> **Adversarial — the coverage number.** 44 operations of 187 is **23%**. The CLI
> is a *loop* CLI, not an API mirror: it covers configure → triage → chase →
> schedule → publish → diagnose end to end, and deliberately leaves the form
> builder, the venue map, and the review scorecards at the API. PHILOSOPHY §3
> states that boundary explicitly ("a command line is a worse way to draw a room
> than a room is"). **Say "the whole operating loop," never "the whole API."**

---

#### 6. `SKILL.md` — an agent skill file generated from the CLI registry

**What it is.** A 12-chapter operating manual **written to an agent**, at the repo
root. Chapters: Authentication · Set up a new instance · Next year's conference ·
Seed · Triage · Chase · People · Configure · Agenda · Publish · Diagnose.

**It is generated, not written.** `cli/generate-skill.mjs` renders it from
`COMMAND_REGISTRY`. `tests/node/skill.AC-142-144.test.mjs` asserts
`SKILL.md === renderSkill()` — so a command added to the CLI and not to the skill
is a **red test**, not a stale doc.

The same test enforces four more things, and these are the interesting ones:
- **`assert.doesNotMatch(skill, /\bcurl\b/)`** — every workflow must be a CLI command. The stated reasoning: *"an agent that has to drop to `curl` mid-loop has found a gap, and the absence of curl is what proves there is not one."*
- Six specific workflows must be *demonstrated with a worked example*, not merely listed (`submissions schedule`, `submissions publish`, `agenda place`, `agenda move`, `search`, `event set`).
- Product vocabulary is pinned (Abstract, Session, Evaluation plan, Committee, Portal, Task, Agenda) and off-vocabulary words are banned (`/proposal|talk submission|CFP entry|panel review/i`).
- **Leak guard:** the skill may not contain "Stage 11", "Lattice", `marquee.stage11.dev`, "session cookie", or "cookie auth" — it is public-repo-safe by test.

Best line in it, from the setup chapter: *"**Never open the claim link yourself.
Ownership must land on a person, not on an agent.**"*

**Who it serves.** Any coding agent handed the repo.

**What it beats.** Nobody ships a skill file. This is a 2026-native artifact that
did not exist as a category when Sessionboard was built.

**Judge pitch.** *"A skill file that teaches any coding agent to run a conference —
generated from the CLI's own command table, and gated by a test that fails if the
skill ever needs the word `curl`."*

**Status:** `verified-in-code` on `github/main` (12 chapters, 45 commands listed).
The setup chapter arrived in PR #97 (MRQ-105) and is **on main, not on the live
sha**.

> **Adversarial — discoverability.** `SKILL.md` is **not served by the deployed
> site.** `curl https://marquee.stage11.dev/SKILL.md` returns the SPA shell (HTTP
> 200, `text/html`, 1,486 bytes), as do `/llms.txt`, `/.well-known/ai-plugin.json`,
> and `/agents`. It is discoverable **in the repo only**. Say "shipped in the
> repo," never "served from the site."

> **Adversarial — `AGENTS.md`.** The task brief asked about it. **`AGENTS.md` is
> not in the repo.** `git ls-tree github/main -- AGENTS.md` → empty; it exists in
> the primary checkout as an **untracked local symlink to `CLAUDE.md`** (`git
> status` reports `?? AGENTS.md`). Do not cite it as a shipped artifact.

---

#### 7. "Hand this to your agent" — copyable agent briefs on four operator surfaces

**What it is.** A launcher button on **CFP forms, Communications, Agenda builder,
and Onboarding** that opens a panel containing a paste-ready, plain-English brief
written *to* an agent, plus a full-width Copy button and a muted line naming the
underlying endpoint for anyone who'd rather drive it themselves. Source:
`src/ui/shell/agent-briefs.ts`, `AgentBrief.tsx`, `agent-brief.css`.

Every brief carries four load-bearing items or it isn't paste-ready:
1. **Where this instance lives** — resolved from `window.location.origin` at render, never a placeholder.
2. **The machine-readable entry point, told as an instruction** — *"Read /api/openapi.json first."*
3. **The auth path and where to mint a token** — Settings → API tokens.
4. **A definition of done including the undo handle** — *"give me the form_id … If I don't like it, I want to delete that form_id and have you start again."*

Only the second paragraph is shared across the four; a test fails if any two
briefs share a sentence. The closing claim is a constant:
`AGENT_BRIEF_PARITY = "Everything the screen can do, it can do — there is no
capability here the API lacks."`

The chase brief is the best single quote in the whole surface:
> *"Count before you send. The audience endpoint resolves a selector to an exact
> number of recipients; show me that number and wait for me before anything goes
> out … tell me how many were selected, how many were queued, and how many were
> skipped as duplicates, and give me the outbox_ids so I can read what each
> speaker actually received and stop anyone being chased twice."*

**Why it exists.** PHILOSOPHY §3 claims agents are first-class operators. This is
that claim made a control instead of a sentence.

**Who it serves.** The organizer who has an agent but doesn't know what to say to
it. This is the onboarding ramp for agent-native operation.

**What it beats.** Nobody ships this. It is not a category anyone else is in.

**Judge pitch.** *"Four screens carry a button that hands your own agent a
paste-ready brief — origin resolved live, schema named, token path given,
definition of done including how to undo it."*

**Status:** `verified-live`. PR #95 merged `2026-08-12T16:05Z`, merge commit
`f605a51d`, confirmed an **ancestor of the deployed sha `8dc17d30`**. Confirmed in
the deployed JS bundle: `curl .../assets/index-lkzKF28F.js | grep -c "Hand this
to your agent"` → **5**; the parity sentence and the openapi instruction are both
present verbatim.

Also worth noting: 12 contract tests, ~160ms, no Worker isolate. And the PR body
documents that the affordance is **strictly additive** — a per-surface table of
every pre-existing control confirmed still present and operable, so the brief
cannot be read as having displaced anything.

---

### TIER 2 — The API is a serious API

#### 8. Scoped bearer tokens with intersection semantics

Seven fixed grants (`src/api/grants.ts`): `program:read`, `program:write`,
`review:write`, `speaker:write`, `agenda:write`, `comms:send`, `mirror:write`.
Two documented security schemes — `bearerAuth` (scoped org token) and `cookieAuth`
(`mq_session`) — and the same routes accept both. **Effective authority is the
intersection of the token's grants and its issuer's membership**, so a token can
never out-rank the human who minted it, and demoting that human immediately
narrows every token they issued. Secret shown once through a shown-once panel.

The authorization step **conceals rather than discloses**: a 404 never
distinguishes "absent" from "hidden."

**Beats:** the usual conference-SaaS pattern is one all-powerful API key per
account.
**Pitch:** *"Scoped tokens whose authority is the intersection of their grants and
their issuer's membership — demote the human and every token they minted narrows
with them."*
**Status:** `verified-in-code`; scheme descriptions and the intersection wording
are `verified-live` in the served document.

#### 9. One error envelope, with a correlation id that reaches the log line

Every failure with a body is `{error: {code, message, field?, details?},
request_id}`. Eight pinned codes. Live:

```
$ curl .../api/v1/events/evt_aie-ny-2026/submissions
HTTP/2 401
x-request-id: a2a180819c81de96
{"error":{"code":"unauthenticated","message":"missing or invalid credential"},"request_id":"a2a180819c81de96"}
```

The `request_id` in the body **equals** the `X-Request-Id` header **equals** the
correlation id on the server's own log lines — and `marquee logs --tail
--request-id 8f2a4c` matches on a **prefix**, so the six characters an organizer
reads off an error screen are enough to find the line. 500s never leak a stack,
SQL, binding, or secret to the caller; the stack goes to the log behind the same
id. Validation failures route through the same envelope with a safe dotted field
path.

**Pitch:** *"One error envelope, and the reference code on the organizer's screen
is a prefix of the correlation id that greps straight to the log line explaining
it."*
**Status:** `verified-live` (envelope + header equality confirmed on three
different failing requests).

#### 10. Rate limiting with standard headers on *every* response

Four buckets (`read` 600/min, `write` 120/min, `send` 30/min, `import` 12/min),
keyed to the effective principal (`person:`/`token:`), falling back to IP; public
form submission uses an `ip_submission` composite key. `RateLimit-Limit`,
`RateLimit-Remaining`, `RateLimit-Reset` land on **every** response — including
successes and including `/api/openapi.json`:

```
ratelimit-limit: 600
ratelimit-remaining: 600
ratelimit-reset: 1786558800
```

When no limiter adapter is installed the allow-all limiter still emits **truthful**
headers rather than lying or omitting them.

**Pitch:** *"Standard RateLimit headers on every response, so an agent paces itself
from the first call instead of discovering the limit by tripping it."*
**Status:** `verified-live`.

#### 11. `Server-Timing` on every response — including the D1 query count

```
server-timing: total;dur=11, d1;dur=11;desc="1 queries"
```

Total duration *and* the database query count, per request, in the browser's own
network panel. The query count is an N+1 detector: duration says a request was
slow, `d1_queries` says why. The same numbers go to the `http_request` log line,
one per completed request, keyed by route **template** (never the raw URL — a raw
URL carries whatever free text a caller typed into a query param).

**Why it's unasked-for.** R7 makes speed a graded feature; this makes it visible
where a developer already looks, to a human and an agent alike.
**Pitch:** *"Every response tells you how long it took and how many database
queries it cost."*
**Status:** `verified-live` (observed `total;dur=0` on a cached meta route and
`total;dur=11, d1;dur=11;desc="1 queries"` on a real D1 read).

#### 12. One list contract across every list in the product

`page`, `per_page` (max 100), `q`, `sort` (endpoint-owned whitelist — a caller
string is **never** interpolated as a SQL identifier) plus typed per-endpoint
filters; out comes `{data, page, per_page, total, total_pages}`. Every order
appends the ULID `id` as a stable secondary key so pagination cannot skip or
repeat a row across pages. Out-of-range pages return `data: []` with authoritative
totals rather than silently rewriting the requested page. The same parsed filter
object feeds UI list reads and the filter arm of bulk selectors — which is the
structural reason a bulk action from the API selects exactly what the UI would.

**Pitch:** *"Learn one list contract and you have learned all 71 of them."*
**Status:** `verified-in-code`; the contract is stated in the served document's
`info.description`, `verified-live`.

> **Adversarial — pagination is offset, not cursor.** The brief asked. It is
> `page`/`per_page` offset paging with a ULID tiebreaker. The only `cursor` in
> the entire 389KB document is `next_cursor` on **one** endpoint
> (`notifyDecidedSubmissions`, the batched decision-notify retry loop). **Do not
> claim cursor pagination.**

#### 13. ULIDs everywhere, validated at the boundary

Crockford base32, 26 chars, regex-validated at every path param
(`src/api/ids.ts`). Sortable by creation time, which is what makes the
pagination tiebreaker stable.
**Status:** `verified-in-code`; the pattern and example appear in the served
document.

#### 14. Optimistic concurrency: one CAS primitive, narrowly applied

`src/api/concurrency.ts` is genuinely good engineering: strong quoted ETags
(`"<id>:<updated_at>"`, never weak), a `requireIfMatch` decoder that 400s on
missing/weak/wrong-resource preconditions, and **one** `compareAndSwapResource`
primitive that performs the version check *inside* the conditional write (D1 has
no interactive transactions), computes `nextUpdatedAt = max(now, expected+1)` so
two writes in the same millisecond still produce distinct versions, and
classifies `meta.changes`: 1 → updated, 0 → re-read to distinguish 404 from a 409
carrying the current ETag. The module comment declares route-level
read-then-unconditional-write a **defect**.

**Status:** `verified-in-code`.

> **Adversarial — this is the weakest claim in the section, and the API's own
> description overstates it.** The served `info.description` says *"Mutations
> carry strong `ETag`/`If-Match` optimistic concurrency."* In fact:
> - `concurrency: "if-match"` appears on **2** route policies out of **194** (both in `agenda.routes.ts`).
> - `requireIfMatch`, `compareAndSwapResource`, and `strongEtag` are called from **`agenda.routes.ts` only**.
> - **Zero** operations in the served document declare an `If-Match` header parameter — total header parameters across all 187 operations: **0**. An agent reading only the spec cannot learn which mutations need a precondition.
>
> **Safe framing:** *"Agenda placement — the one surface where two organizers
> collide — is guarded by strong-ETag compare-and-swap through a single named
> primitive."* Do not say "mutations carry optimistic concurrency," and do not
> claim it is documented in the spec.

#### 15. Idempotency — partial, and not what the brief means by it

There is **no `Idempotency-Key` request-header contract** anywhere in the API.
What exists: outbox rows carry an `idempotency_key` field (the comms dedupe that
makes "don't chase anyone twice" true), and the Sessionize import run is
*described* as reconciling idempotently.

**Safe framing:** *"Reminder sends are deduplicated by idempotency key, so a
retried chase never mails a speaker twice."* **Do not claim API-level idempotent
writes.**
**Status:** `verified-in-code` for the outbox field (`verified-live` as a schema
property in the served document); the general claim is **unsupported**.

---

### TIER 3 — Agent-facing operations and honesty

#### 16. `marquee diagnose` + `marquee logs --tail` — the debugging loop, for humans and agents

`diagnose` probes **every binding** — D1, KV cache, R2 media, four queues,
scheduled work — and answers `ok` or `degraded` with per-probe timings, the
running build sha, and cron staleness. `--bundle` renders a **pasteable Markdown
support report** ("### Marquee diagnostic report / Verdict / Build / Migration /
Bindings / Scheduled work") — the server-side twin of the browser's "Copy
diagnostic report" button, deliberately containing nothing an organizer would be
uncomfortable posting in public.

`logs --tail` shells out to `wrangler tail` — *"the logs belong to the operator's
account, and this command is a reader, not a second copy of them"* — filters to
Marquee's own structured lines, and supports `--request-id` (prefix match),
`--level`, `--event`.

**Who it serves.** The organizer at 2am, and equally the agent asked "why did that
fail" — both get one command instead of a dashboard tour.
**Pitch:** *"`marquee diagnose --bundle` produces the support ticket. `marquee logs
--tail --request-id 8f2a4c` finds the line behind the code on the screen."*
**Status:** `verified-in-code`. Live `GET /api/v1/telemetry/diagnostics` returns
**401** unauthenticated (correct — it's a secured route), so the probe surface
exists on the deploy but I could not read its body without a token.

#### 17. Structured logs on a field allowlist — nothing sensitive, by construction

One JSON object per event. Route **templates**, opaque IDs, statuses, timings,
principal *kind*. **Never** request bodies, query strings, credentials, or mail
addresses. `500`s log the stack; expected failures don't (*"a stack on every 404
is noise that buries the unexpected ones"*).

**Pitch:** *"The logs an agent reads to debug are built from a field allowlist, so
they can't leak a speaker's email even by accident."*
**Status:** `verified-in-code`.

#### 18. Telemetry that does not phone home, with a real off switch

`src/routes/telemetry.routes.ts`, two governing rules stated in the file header:
**nothing is persisted** (no table, no migration, no retention policy to get
wrong, nothing to leak later) and **nothing phones home** (the beacon posts to the
organizer's own Worker; no vendor, no DSN, no third-party script). Every field is
hard-capped at the schema before anything is logged, because a public endpoint
with an uncapped free-text field is a cost incident waiting for a bored visitor.
`CLIENT_TELEMETRY=0` stops recording **server-side**, so an operator who turns it
off doesn't have to trust that every browser honoured it.

**Pitch:** *"Error and Web-Vitals telemetry that writes to your own deployment's
logs and nowhere else — and the off switch is enforced on the server, not
requested of the client."*
**Status:** `verified-in-code`; the endpoint is in the live document as a public
operation (`postClientErrorReport`).

#### 19. Cold start: the agent provisions, the human claims

`marquee setup health` (**unauthenticated** — names the build sha, so it's the
first thing you can ask a fresh instance), then `marquee setup claim-link`
(**unauthenticated**) prints a one-time claim URL. SKILL.md's setup chapter is
explicit: *"Never open the claim link yourself. Ownership must land on a person,
not on an agent."* A used link is inert, and re-running the command is the
recovery path for a locked-out instance, forever. The chapter also names the three
questions that belong to the operator (domain, seed the demo, Resend key) and
instructs the agent to **ask before acting**.

**Who it serves.** The judge cloning the repo. This is the "git clone → running
conference" path, agent-driven, with the ownership boundary drawn on purpose.
**Pitch:** *"An agent can stand up a Marquee instance end to end — and is
instructed, in the skill file, that it may not claim ownership of it."*
**Status:** `verified-in-code` on `github/main` (PR #97, MRQ-105). `mintInstanceClaimLink`
and `getInstanceStatus` **are** in the live document; the SKILL chapter and the
`setup` CLI verbs are **not on the deployed sha**.

#### 20. `/health` — unauthenticated build stamp

```
$ curl .../health
{"service":"marquee","status":"ok","build":"8dc17d304472","built_at":"2026-08-12T17:10:02.169Z"}
```

Names the exact sha running. This is how I established the 25-commit deploy gap
in the first place — the honesty is load-bearing.
**Status:** `verified-live`.

#### 21. 24 deliberately public operations

Enumerated from the live document: public agenda, public form fetch + draft create
+ **autosave** + submit, public session/speaker pages, public embeds, media serve,
signed public uploads, magic-link request/exchange, claim, demo login, telemetry.
A public **draft autosave** endpoint is notable — a speaker's half-written
abstract survives a closed laptop, and it's a first-class API operation with its
own IP+draft-keyed rate limit rather than a UI trick.
**Status:** `verified-live`.

---

### TIER 4 — In flight

#### 22. The agent evaluator seat (MRQ-134) — the sharpest idea here

**What it is.** Marquee ships **no built-in AI reviewer**. It ships **the seat an
external agent sits in**: the organizer's own model, own prompt, own rubric, on
the organizer's own credential. An agent evaluator is a `people` row with
`kind='agent'` holding a reviewer membership and track scopes — **assigned through
the control that already assigns reviewers, counted in the coverage that already
counts reviewers, badged everywhere a reviewer name renders.** The ticket is
emphatic: *"THERE IS NO PARALLEL AI SUBSYSTEM. If you find yourself writing `if
(isAgent)` inside the evaluation write handler, the design has been lost."*

Mechanism: `api_tokens.acts_as_person_id` binds a token to an agent seat; auth
resolves it *as* that person and every existing authorization check runs unchanged
against the resolved identity. **No authorization check is weakened** — the ticket
supplies an identity where `reviewerPersonIdForEvent` previously had none.

Settled rulings: agent scores are **excluded** from the human aggregate and
rendered as their own labelled line; agent completions **do** count toward
assignment coverage; **Marquee never invokes a model** — no cron, no queue
consumer, no run-the-agent button; one seat per agent, not per run; the
user-facing word is **"Agent," never "AI."**

Six named security invariants, each with its own test — the two load-bearing
ones: a token may act only as a `kind='agent'` person, checked at issue **and
re-checked at resolution** so a row edited under a live token fails closed; and a
bound token acts only as the seat, never additionally as the issuing human, with
scopes constrained to `review:write` at issue.

**Judge pitch.** *"Every competitor is bolting on an AI reviewer. Marquee ships the
**seat** — your agent, your model, your rubric, on your credential, holding a real
reviewer membership, badged in the UI, scored on its own line, and Marquee never
calls a model itself."*

**Status: `verified-in-code` for the design only — NOT BUILT, NOT DEPLOYED.**
Lattice `task_01KZVFJPZF83N697KNMPQEWF8J`, status `in_progress`, on branch
`mrq-134-agent-evaluator`. Binding design at `sequence/agent-evaluator-design.md`;
AC-288–293 and US-87 minted on the branch. **If this is quoted in submission copy
it must be framed as design/roadmap, or the judge who curls for it will find
nothing.** This is exactly the notes-vs-build contradiction we were docked for
before.

---

### Things to NOT say (the adversarial list, consolidated)

1. **"Cursor pagination."** It's offset (`page`/`per_page`). One endpoint has a cursor.
2. **"Idempotent writes / Idempotency-Key."** No such header contract. Only outbox dedupe.
3. **"Mutations carry ETag/If-Match concurrency."** Two routes out of 194, agenda only, and **zero** operations document the header in the spec. The API's own `info.description` overstates this — a diligent judge diffing description against spec will catch it.
4. **"The CLI covers the API."** 44 of 187 operations = 23%. It covers the *loop*.
5. **"`/api/docs` is an API & CLI reference."** The sidebar says so; the page has zero CLI content (`grep -c marquee.mjs` → 0). Fix the label or fix the claim.
6. **"SKILL.md is served from the site."** It is not. `/SKILL.md`, `/llms.txt`, `/.well-known/ai-plugin.json`, `/agents` all return the SPA shell.
7. **"AGENTS.md."** Not in the repo at all — an untracked local symlink in one checkout.
8. **"The agent evaluator seat."** In flight, unmerged, undeployed.
9. **"MCP server."** There is none. `mcp` appears only in board files, seed sources, and research notes. If a judge asks "is there an MCP server," the honest answer is "no — the OpenAPI document plus the skill file is the integration path, and any MCP shim can be generated from the served spec."
10. **The deploy gap itself.** The live site is 25 commits behind main. Any claim resting on MRQ-129 (multi-event, `event list`/`event create` CLI), MRQ-105 (setup chapter, setup verbs), MRQ-132, or sign-in must be tagged "on main, deploying." **Deploy before submitting, or tag every one of them.**

---

### Suggested framing for the document

The through-line that survives every adversarial check:

> **The competition asked for bonus points for having an API. Marquee's UI is a
> client of its API — one of its callers, never a privileged one. 187 operations,
> a live content-addressed OpenAPI 3.1 document whose ETag is its own SHA-256, a
> CI gate that proves the docs match the code by digest, a 45-command
> dependency-free CLI covering the whole operating loop, a skill file generated
> from that CLI and tested to never need the word `curl`, and a button on four
> screens that hands your own agent a paste-ready brief. None of that was asked
> for. All of it is running right now.**

And the honesty note the graders' judge will actually reward:

> **Every claim above carries a verification tag, and the ones that are design
> rather than deployment are labelled as such.**

---

## Groups B and C — Craft the incumbent lacks · Operational honesty

**Scope note (read first).** All source citations below are against the **true `github/main` tree**,
exported read-only to
`/private/tmp/claude-501/…/scratchpad/main-tree/`.
The primary checkout at `/Users/atin/Projects/Stage11/deployments/Marquee` is 91 commits behind main
(42 route files vs 62) and understates the product; an earlier pass against it produced two wrong
findings, corrected inline below.

**Three environments, kept distinct in every verification status:**

| | what it is | how far behind |
|---|---|---|
| `main` | `Stage-11-Agentics/marquee@main` — the exported tree | — |
| deployed | `https://marquee.stage11.dev`, sha `8dc17d30` (PR #103, built 2026-08-12T17:10Z) | 25 commits |
| stale checkout | the primary Lattice-board checkout | 91 commits (not used for claims) |

**Verification vocabulary**
- `verified-live` — confirmed by curl against `marquee.stage11.dev`
- `verified-in-code` — read the implementing code on `main`
- `verified-by-running` — ran the check script against the `main` tree and read its verdict
- `verified-in-code (on main, not yet deployed)` — exists on main; the deployed sha predates it
- `claimed-in-docs-only` — a doc asserts it, no implementing code found

**Corrections to the earlier stale-tree pass**
1. ~~"`cli/api-registry.json` is deleted, so `check:api` fails"~~ — **wrong.** On main the registry is a
   deliberately *untracked build artifact*, generated on demand by `check-api.mjs` (main
   `scripts/checks/check-api.mjs:165–178`) precisely because a tracked copy conflicts on every
   concurrent branch. The deletion in the stale checkout is the correct state.
2. ~~"`ac-coverage.json` shows 2 trace failures"~~ — **stale artifact** from 2026-08-11, gitignored;
   the offending `MRQ-93 ·` test titles no longer exist.

Raw scale, `main`: **45 API route modules · 194 `defineApiRoute` registrations · 187 live OpenAPI
operations across 148 paths · 182 test files / 26,102 lines · 17 migrations carrying 153 CHECK,
107 REFERENCES, 42 UNIQUE, 418 NOT NULL, 99 indexes.**

---

### (A) Craft the incumbent lacks

swyx's complaint set is craft, not features: *"doesn't even have full validation"* (R14),
*"I should not have a minimum of two speakers, that was stupid"* (R15), *"oh my god, this is so
slow"* (R7). Everything in this section answers one of those, or answers a question nobody on the
rubric thought to ask.

---

#### A1. Validation is enforced at a boundary that cannot be bypassed

**What it is.** Every route enters the registry as one object carrying *both* its OpenAPI definition
and its handler — `defineApiRoute(definition, handler)` (`src/api/route.ts:108–123`). There is no
API for registering a contract without a handler, and the definition is inferred (`const Definition
extends ApiRouteDefinition`), so a handler returning a shape the document does not declare is a
**compile error**, not a runtime surprise. The document is then assembled from the very same route
objects (`src/api/router.ts:createApiRouter`), which is why parity is structural rather than
audited.

**Why it exists.** R14. Sessionboard's validation is decorative and swyx noticed on camera. The
usual failure mode is Zod-at-the-edge with a hand-written OpenAPI doc drifting beside it; this
design makes that drift unrepresentable.

**Who it serves.** The submitter who gets a real error instead of a silent truncation; the agent
reading `/api/openapi.json` and trusting it; the engineer who cannot ship a lying doc.

**What it beats.** Sessionboard (explicitly — R14). Also most hand-rolled Hono/Express APIs, where
the schema and the docs are two artifacts maintained by hope.

**Judge pitch.** *"A route cannot be registered without its schema, and the docs are generated from
the same object that serves the request — so the API cannot lie about itself."*

**Status.** `verified-in-code` + `verified-live` (187 operations served; `/api/docs` renders 200
`text/html`, 58,674 bytes).

---

#### A2. One error envelope, one status map, and a correlation id the user can read aloud

**What it is.** `src/api/errors.ts` pins eight codes to eight statuses (`ERROR_STATUS_CODES:29–38`)
and one envelope `{error:{code,message,field?,details?}, request_id}`. Zod validation failures land
in the *same* envelope via `OpenAPIHono`'s `defaultHook` (`src/api/router.ts`, step 5), with a safe
dotted `field` path and a `details[]` of every issue. 500s never leak stack, SQL, bindings or
secrets — only the request id (`app.onError`). `resolveRequestId` trusts the edge `cf-ray` when
present and **never** a client-supplied id (`errors.ts:118–122`).

**Why it exists.** So a failing screen produces a reference an organizer can quote and an engineer
can `grep`. `envelopeResponse` is the single funnel for validation failures, thrown `ApiError`s,
unexpected throws *and* 404s — which is what makes it the correct place to log.

**Who it serves.** The organizer at 2am on a decision wave; the support path; the agent parsing
failures programmatically.

**What it beats.** Nobody ships this at hackathon scale. Sessionize/Sessionboard surface HTTP
statuses and generic toasts.

**Judge pitch.** *"Every failure — including a schema rejection — comes back in one envelope with a
request id, and that same id is on the log line that explains it."*

**Status.** `verified-live`:
```
$ curl -i https://marquee.stage11.dev/api/v1/events/evt_demo/submissions?per_page=99999
HTTP/2 401
x-request-id: a2a17e56a8a86a59
ratelimit-limit: 600 / ratelimit-remaining: 600 / ratelimit-reset: 1786558860
server-timing: total;dur=0, d1;dur=0;desc="0 queries"
{"error":{"code":"unauthenticated","message":"missing or invalid credential"},"request_id":"a2a17e56a8a86a59"}
```

---

#### A3. The browser speaks the envelope back in the organizer's language

**What it is.** `src/ui/shell/api-client.ts` restates the eight codes (deliberately not imported, so
the client bundle never pulls the Worker schema; `tests/unit/client-error-handling.test.ts` asserts
the two lists never drift) and maps **every** code to a sentence + a recovery + a `retryable` flag
(`ERROR_TREATMENTS`). Three client-only failures — `offline`, `unreachable`, `unreadable` — are
distinguished from server faults, because *"they are the same screen in most software and they call
for opposite reactions."*

Sample copy, verbatim:
- `conflict` → *"Someone else changed this while you were working on it." / "Reload to see their version before saving yours."*
- `rate_limited` → *"Going faster than the system allows." / "Retrying shortly — nothing is lost."*
- `offline` → *"Your connection dropped." / "The conference is fine — this device is offline."*

Adding a code to the envelope without adding a treatment is **a test failure, not a silent fallback
to a number on screen**.

**Who it serves.** The non-technical program manager. R26 (judge on job-to-be-done).

**What it beats.** Everyone. The industry default is `Error: 429`.

**Judge pitch.** *"There is no status code anywhere in this product's UI. Every failure has a
sentence and a next move, and a test fails if a new one doesn't."*

**Status.** `verified-in-code`.

---

#### A4. Stale-while-error: a failing refresh never blanks a working screen

**What it is.** `src/ui/shell/ErrorSurface.tsx` — `StaleBand` keeps last-good data on screen with a
quiet band saying how old it is (*"Showing data as of 4 min ago · retrying"*), and reserves its row
whether or not it has anything to say. The error banner carries a **short reference code that is a
prefix of the server's correlation id**, plus a fixed-width "Copy diagnostic report" button whose
label swaps between `Copy diagnostic report` / `Copied — paste into an issue` / `Copy failed —
select the text` without changing size.

Comment, verbatim: *"A screen that is already failing is the worst possible moment to move the
controls under the operator's cursor."*

**Judge pitch.** *"When a background refresh fails, you keep your data and get told how old it is —
instead of watching a working screen turn into a spinner."*

**Status.** `verified-in-code`.

---

#### A5. "Elements never jump" is a written rule with per-file enforcement

**What it is.** `DESIGN.md` (main) makes it binding: *"Reserve space for swapped text; fixed-width
toggles; '—' over removed rows; tabular numerals."* It shows up as an implementation constraint in
places nobody would check:
- `src/lib/delivery-health.ts:41–46` — `CapabilityStatus.detail` is **always present** *"so the row
  never changes height."*
- `src/ui/submissions/record-copy.ts:20–33` — `decidedNote()` is held *strictly shorter* than the
  copy it shares a slot with, so the header cannot re-wrap at any width; a test pins the invariant.
- `src/lib/instance-status.ts:11–14` — *"An unconfigured row never disappears and a configured one
  never appears — only the status changes, so nothing on the panel moves under the reader."*
- `src/ui/health/DeliveryHealthPage.tsx` — tabular numerals on every count.

**What it beats.** Nobody ships this as a rule. It is a taste position that costs real
implementation effort at every call site.

**Judge pitch.** *"Toggling anything in Marquee moves nothing else on the page — that's a written
rule, enforced down to the length of individual strings."*

**Status.** `verified-in-code`.

---

#### A6. The design contract is executable — including theme correctness

**What it is.** `npm run check:design` (`scripts/checks/verify-design-contract.mjs`, main version,
71 lines) fails the build on:
1. the canonical token block in `prototypes/skins/skin-c.html` differing from `src/styles/tokens.css`;
2. sidebar ≠ 224px, topbar ≠ 52px, compact rail ≠ 68px @1000px, mobile rail ≠ 54px @760px;
3. any of **19 named route labels** missing from the route table;
4. the string `PROTOTYPE` appearing in shipped shell source;
5. **any literal color in `components.css`** — *"A hardcoded color is invisible to the theme system:
   it looks correct in Day and is simply wrong in Night, with nothing to catch it but a human's eye";*
6. **any color token Day introduces that Night does not redefine** — *"night theme does not redefine
   `--x`; it would inherit the Day color."*

**Judge pitch.** *"The design system isn't a doc — it's a check that fails the build if a pixel
measurement or a single hardcoded color drifts from the prototype."*

**Status.** `verified-by-running` against main:
```
$ node scripts/checks/verify-design-contract.mjs
{"command":"check:design","status":"pass","findings":[]}
```

---

#### A7. Day/Night themes without the flash, and without hijacking the OS preference

**What it is.** `src/ui/shell/theme.ts` + a pre-paint inline script in `index.html`. A theme is
*palette only*: one `html[data-theme="…"]` block in `tokens.css` plus one row in `theme.ts`. Spacing,
radius, hairline, type stacks and `--shadow: none` are theme-invariant — *"what keeps Night a re-lit
instrument rather than a generic dark mode."*

Two deliberate, defensible refusals:
- **`prefers-color-scheme` is not consulted.** *"A visitor whose laptop happens to be in dark mode
  should not silently get a palette nobody chose for them."*
- **Theme is stamped before first paint.** *"Resolving a palette after hydration flashes white on
  every load — the jump the craft rules forbid."*
- **Scope is the admin shell only.** Public agenda, embeds and API docs own their palettes, because
  *"an embed inherits its host page, and an attendee's page must not be re-lit because an organizer
  picked Night."*
- Night's contrast floor is **6.3:1** (Day's is 4.5:1), measured not eyeballed. Track colors are
  never rewritten — *"they are the organizer's data."*

**Status.** `verified-in-code`; `verified-live` (the deployed page's HTML contains the
`marquee-theme` pre-paint key). Night was client-chosen 2026-08-12 over "Midnight Ops" and
"Red-Shift".

---

#### A8. Honest empty states everywhere — with an action, not a shrug

**What it is.** A shared `EmptyState` component (`src/ui/shell/components.tsx:29`) plus per-surface
copy. Every one names the situation and offers the next move, and filtered-empty is distinguished
from genuinely-empty:

| surface | genuinely empty | filtered empty |
|---|---|---|
| Dashboard | *"Your program starts here"* + **+ Add session** / **Import from Sessionize** | — |
| Program board | *"No submissions on the program board yet"* + **+ Add session** | *"No submissions match these filters"* + **Clear filters** |
| Public agenda | *"The conference team has not published the program yet."* | *"Clear a filter to bring the program back into view."* + **Show full agenda** |
| Reviewer | *"Queue clear — there are no unreviewed submissions in your authorized tracks."* + **Check again** | — |
| API tokens | *"Secrets are shown once and stored only as hashes."* | — |
| Forms builder | *"Add the first question to give the public form a place to start."* + **＋ Add first field** | — |
| Venues | *"Add a building before creating its rooms."* (state-aware) | — |
| Speaker portal | *"No tasks are assigned to you right now."* | — |

There is a dedicated test: `tests/node/empty-state.AC-161.test.mjs` (AC-161).

**What it beats.** R25 — swyx resents the demo gate and wants a self-serve product; an empty state
that says "you'd normally have data here" is exactly the moment that burns a judge.

**Judge pitch.** *"Every empty screen tells you what would be here and gives you the button to make
it happen — and knows the difference between 'nothing yet' and 'your filter hid it'."*

**Status.** `verified-in-code`.

---

#### A9. Loading discipline: skeletons, `aria-busy`, `role=status`, `role=alert`

**What it is.** 282 accessibility/keyboard attributes across `src/ui`. Loading states are typed
skeletons with `aria-busy="true"` and an `aria-label` (`EventSettings.tsx:104`, `ApiTokensPage.tsx:54`,
`DashboardPage.tsx:150`), not spinners. Errors are `role="alert"` with a **Retry** button; notices
are `role="status"`; live regions (`aria-live="polite"`) on quick-search results, upload progress,
the delivery-health verdict, and the public agenda list.

The forms loading state is characteristically honest — it says what it is doing:
`<div class="forms-loading" aria-busy="true"><span>Loading conference forms</span><strong>—</strong><span>Reading D1</span></div>`.

**Status.** `verified-in-code`.

---

#### A10. Keyboard: global search on `/`, escape-to-dismiss, overlay focus management

**What it is.** `src/ui/shell/QuickSearch.tsx` + `OverlayHosts.tsx` + `AppShell.tsx` +
`ReviewerPage.tsx` + `ProgramBoardPage.tsx` + `identity.tsx` all carry real `keydown` handling. The
speed harness itself drives it: `scripts/checks/speed.ts:65–103` presses `/`, types, asserts the
result paints, presses `Escape`, and **fails if the page navigated while typing**.

**Judge pitch.** *"Press `/` anywhere and search the whole conference; the budget says it must paint
in under 200ms p95, and the harness fails if typing ever navigates you away."*

**Status.** `verified-in-code`. The AC-103 budget's *measurement* is not in any automatic gate — see
**A13**.

---

#### A11. Sane defaults, in the schema, exactly where swyx was burned

**What it is.** R15 verbatim: *"that was stupid. Obviously, I should not have a minimum of two
speakers."* Marquee's form defaults live in `migrations/0001_init.sql:226–241`:
```sql
per_submitter_limit INTEGER NOT NULL DEFAULT 3,   -- matches AIE's own CFP (R48)
min_speakers        INTEGER NOT NULL DEFAULT 1,   -- the thing Sessionboard got wrong
max_speakers        INTEGER NOT NULL DEFAULT 4,
turnstile_required  INTEGER NOT NULL DEFAULT 1,
CHECK (min_speakers >= 0), CHECK (max_speakers >= min_speakers),
CHECK (opens_at IS NULL OR closes_at IS NULL OR opens_at <= closes_at)
```

**Judge pitch.** *"The default minimum is one speaker — the exact default that made you say 'that
was stupid' on camera — and the database refuses a max below the min."*

**Status.** `verified-in-code`.

---

#### A12. Validation is *also* in the database, not only at the edge

**Adversarial question asked and answered.** "Is this Zod-at-the-edge with a schemaless DB
underneath?" No. Across 17 migrations: **153 CHECK constraints, 107 FK references, 42 UNIQUE, 418
NOT NULL, 99 indexes.** Representative:
- `CHECK (json_valid(av_capabilities) AND json_type(av_capabilities) = 'array')` — JSON columns are
  type-checked by SQLite, not trusted.
- `CHECK (status <> 'ready' OR r2_etag IS NOT NULL)` — an attachment cannot claim readiness without
  the object's etag.
- `CHECK (starts_on <= ends_on)`, `CHECK (min_duration_min <= default_duration_min <= max_duration_min)`.
- `CHECK (role <> 'reviewer' OR event_id IS NOT NULL)` — a reviewer membership must be scoped.
- `CHECK (url LIKE 'https://%')` on webhook endpoints.
- `migrations/0005` enumerates the six legal webhook event names **per array slot** in SQL, with a
  written explanation of why: *"SQLite CHECK constraints cannot contain a table-valued subquery, so
  validate each possible array slot explicitly."*

**Judge pitch.** *"The validation isn't a Zod veneer — the database refuses the same bad states, 153
CHECK constraints deep."*

**Status.** `verified-in-code`.

---

#### A13. Speed budgets are real, measured by a real browser — **and not wired into any gate**

**What it is.** `scripts/checks/speed-budgets.mjs` declares **14 budgets**, split into 7 `acceptance`
(traced to AC-16/36/85/62/103/89/69) and 7 `objective` (client-set). `check-speed.mjs` +
`speed.ts` (383 lines) drive a real Chromium against a real local Worker: 10 warm samples, 5 cold
samples with a fresh browser context per run and CDP cache disabled, 20 review-queue samples, 10
distinct search queries including diacritics and a no-match term. `classifySpeedMeasurements`
fails on an acceptance miss and prints `⚠ OBJECTIVE MISSED` on an objective miss.

Representative budgets: dashboard p95 ≤ 1000ms · review "next" median ≤ 300ms · global search
painted p95 ≤ 200ms · agenda view-switch p95 ≤ 200ms · bulk-accept long task max ≤ 100ms.

**The adversarial finding, stated plainly.** `check:speed` appears in **neither** gate.
- `scripts/checks/pr-gate.mjs` (main) runs 11 checks — worker/client/test typechecks, production
  build, `check:shell-truth`, `check:design`, `check:api`, `check:routes`, `check:clocks`,
  `npm test`, `trace:ac`. **No `check:speed`.**
- `.github/workflows/ci.yml` (main) runs typechecks, build, `check:design`, `check:clocks`,
  `npm test`, `trace:ac`. **No `check:speed`, no `check:api`, no `check:routes`, no
  `check:shell-truth`.**
- `speed-report.json` contains **only** the two harness timings (`pr_gate`, `suite`). Not one of the
  14 budget ids has ever been written to it.

So: the budgets are defined, traced to ACs, and measurable on demand — but nothing runs them
automatically, and there is no recorded measurement of any of them. Treat "speed is enforced in CI"
as **false**; "speed is budgeted, instrumented, and measurable in one command" is true.

Live spot-checks (not a substitute for the harness): `/` 169ms, `/agenda` 295ms, `/api/v1/public/agenda`
`server-timing: total;dur=12, d1;dur=12;desc="1 queries"`.

**Judge pitch (honest version).** *"Fourteen speed budgets, seven of them acceptance-grade, measured
by a real browser against a real Worker in one command — `npm run check:speed`."* Do **not** claim
CI enforcement.

**Status.** `verified-in-code` for the harness; **the gate-wiring gap is `verified-by-reading` both
gate definitions and `speed-report.json`.**

---

#### A14. Two numbers, two jobs — the suite budget that refuses to lie

**What it is.** `scripts/checks/run-test.mjs:7–33` is one of the most honest pieces of engineering
in the repo. It separates:
- `BUDGET_MS = 45_000` — an **objective**. Exceeding it prints
  `[test] OVER BUDGET: …ms against a 45000ms objective. Tests passed; the suite is slow. Check
  machine load before treating this as a defect.` It does **not** fail.
- `HARD_LIMIT_MS = 600_000` — a **hang detector**, and it does fail, because *"a killed suite has
  unknown results, and unknown is not passing."*

The comment records the incident that produced the number: 240s *"was not generous"*, two PRs
tripped it on one evening with zero failing tests, and *"a detector that fires on the healthy case
teaches people to re-run instead of look, which is the one thing it must never do."*

The same reasoning is repeated in `pr-gate.mjs:26–36`: the 120s gate budget is an objective that
warns loudly and never blocks, because *"a red that does not mean 'broken' teaches a fleet to re-run
instead of read."*

**Judge pitch.** *"The test suite has a speed budget that warns and a hang detector that fails, and
the code explains at length why conflating them is a defect."*

**Status.** `verified-in-code`. Observed live: suite 32.5s against the 45s objective (main tree,
2026-08-12).

---

#### A15. `check:clocks` — banning tests that expire on a calendar date

**What it is.** `scripts/checks/check-clocks.mjs` (180 lines, main-only, PR #109). Two rules, both
written from real incidents:

**Rule 1 — absolute anchors feeding real-clock comparisons.** A fixture writing
`const NOW = Date.UTC(2026,7,11,15)` then `expires_at: NOW + 86_400_000` reads as "expires tomorrow"
and stops being true when the wall clock passes it. Verbatim: *"On 2026-08-12T15:00:00Z the portal
suite went red with no diff behind it… A sweep then found twelve more suites armed the same way —
eleven of them minting `auth_sessions` rows whose `expires_at` was an offset from the fixture
anchor, which turn the whole file into 401s on a date nobody wrote down."* The rule only fires where
fixtures are actually persisted (`env.DB.prepare|batch`), because an injected clock cannot drift.

**Rule 2 — bursts that race a fixed window.** Spending a rate limit with limit+1 requests races the
window boundary. The comment does the arithmetic: *"with a limit of 30 and a 35-request burst:
inside one window the counts reach [30] and it trips; with a boundary ten requests in they reach
[10, 25] and it does not… Once a request takes longer than the window is wide — ordinary when
several agents share a machine — no window can fill and the limiter is untestable rather than
flaky."* Fix: seed the counter to its limit, send one request.

Escape hatch requires a reason: `// clock-check: allow — <why this one is actually safe>`.

**Who it serves.** Every future maintainer of a fork. This is the class of failure that makes a
weekend-clonable OSS project rot in six months.

**What it beats.** Nobody ships this. It's a lint rule for time-bombs.

**Judge pitch.** *"A CI check that fails any test which would go red on a future Tuesday — written
after one did."*

**Status.** `verified-by-running` against main:
```
$ node scripts/checks/check-clocks.mjs
[check:clocks] no calendar-pinned deadlines, no burst-spent limits
{"command":"check:clocks","status":"pass","findings":[]}
```
In both `pr-gate` and GitHub CI.

---

#### A16. `check:routes` — because a SPA answers 200 on every path that doesn't exist

**What it is.** `scripts/checks/check-routes.mjs`. The framing is the finding:

> `src/index.ts` ends in `app.all("*", … ASSETS.fetch(…))`, so every unmatched path answers HTTP 200
> with the SPA shell. `/site`, `/settings/webhooks`, and `/comms` all looked alive to a probe while
> being nothing at all, and the hand-written route list that named them shipped twice. **Nothing that
> reads a response can catch that class of lie; only generation from the route sources can.**

It generates `docs/ROUTES.md` from three sources — the SPA route table (imported directly, Node
≥22.18 type-stripping), the `isPublicPage` predicate **parsed back out of `app.tsx` and rebuilt as a
predicate**, and every `.get("/…")` in `src/routes/*.route.tsx` — then fails on drift. If it can't
parse every clause of `isPublicPage` it **throws** rather than emitting a confidently-wrong
public/organizer split.

**Judge pitch.** *"The route map is generated from the code, because in a SPA a route that doesn't
exist returns 200 and looks exactly like one that does."*

**Status.** `verified-by-running`: `{"command":"check:routes","status":"pass","spaRoutes":40,"serverPages":11}`.
In `pr-gate`, **not** in GitHub CI.

---

#### A17. `check:shell-truth` — the multi-tenant lie detector

**What it is.** `scripts/checks/check-shell-truth.mjs` scans every tracked file under `src/`,
`scripts/`, `cli/` (excluding seed and fixtures) for two literals: the demo conference's **name**
and its **id**. Rationale, verbatim: *"a page that defaults to the seeded conference's id renders
conference A's data while the organizer is standing in conference B, which is worse than a page that
renders nothing."*

**Who it serves.** R45 (multi-event under one org — AIE runs 4 concurrent events). Also anyone
self-hosting: a demo-id leak makes a fresh install show someone else's conference.

**Judge pitch.** *"A check that fails the build if the demo conference's name or id is hardcoded
anywhere outside the seed."*

**Status.** `verified-in-code`; in `pr-gate`, not in GitHub CI. (Not runnable against the export —
it needs `git ls-files`.)

---

#### A18. `check:api` — served JSON ↔ rendered docs, byte-for-byte

**What it is.** Boots the **built Worker bundle** in-process and fetches both endpoints for real.
Asserts: `ETag` equals the SHA-256 of the served body; the document validates as OpenAPI 3.1
(`@scalar/openapi-parser`); no duplicate operation signatures; no operation without an
`operationId`; no unversioned path outside a **named 3-entry allowlist** (`/i/{uid}.ics`,
`/agenda.json`, `/api/v1/public/agenda.ics` — SPEC §4.2, for calendar clients that can't follow a
versioned prefix); the rendered docs page embeds the **same** document hash and operation count; and
— for R8 self-hosting — the docs shell contains **no `<script>` and no external `src`/`href`**, so it
works in a clean container with no public network.

Its report is honest about its own limits: `notCoveredHere: "Full-loop network-recorded traffic
parity … is MRQ-9."`

**Status.** `verified-in-code`. Live evidence of the ETag half:
```
$ curl -D- https://marquee.stage11.dev/api/openapi.json
etag: "1c4505c1859203b7a33b0dc03ec4477031068498090be9be08c12d0752a0f82d"
```
**Adversarial note:** the deployed `/api/openapi.json` returns **200, not 304**, for a matching
`If-None-Match`. The ETag is a *content digest for parity checking*, not a conditional-GET
optimization. Don't oversell it as caching.

---

#### A19. AC traceability enforced by AST, not by grep

**What it is.** `scripts/checks/trace-ac.mjs` + `trace-ac-core.mjs`. Every test title must be
prefixed `AC-nnn · ` (or `CONTRACT · `); titles are read by **TypeScript AST**, and there is a
recorded bug-fix in the comment explaining why the *root* of a property access is read rather than
the property name — *"`/pattern/.test(value)` is a RegExp call whose PROPERTY happens to be named
`test`, and reading the property made every such call look like a test with a dynamic title."*
Dynamic titles are an error. Duplicate AC owners across tickets are an error. Struck criteria
(`AC-239`) referenced anywhere are an error. `--scope=merged` enforces only criteria some ticket has
claimed, so the very first PR isn't failed by the whole register.

Last recorded run: **216 live criteria, 122 test files, 57 ticket claims, 0 uncovered auto-tagged
criteria**, one `felt`-tagged criterion (AC-16) awaiting an operator pass.

**Judge pitch.** *"Every acceptance criterion is claimed by a ticket and covered by a named test —
and a check fails the build if one isn't."*

**Status.** `verified-in-code`; in both `pr-gate` and GitHub CI.

---

#### A20. `run-test:changed` — the inner loop scoped by module graph

**What it is.** `scripts/checks/run-test-changed.mjs` (main-only). Vitest `--changed` from the
**merge-base** (not the branch tip — *"a branch that is a few merges behind scopes to 'everything
that differs' — safe, but useless on a repo where main moves several times an hour"*), plus the
`tests/node/` suite **unconditionally**, because most `.tsx` coverage there is source-text contracts
that `readFileSync` a component — *"text-reading leaves no import edge, so vitest `--changed`
correctly selects zero suites for a component edit."* Costs ~6s. Explicitly *"a pre-push
convenience, never a merge gate."*

**Judge pitch.** *"The inner-loop suite is scoped by real dependency graph, and it knows which of its
own tests that graph can't see."*

**Status.** `verified-in-code`.

---

#### A21. Undo that names what it will and will not touch

**What it is.** Sessionize import undo — `POST /api/v1/events/{eventId}/imports/{importId}/undo`
(`src/routes/imports.routes.ts:197–212`, `src/lib/sessionize-import.ts:908–939`). It returns
`{undone: n, retained_manifest: true}`. The confirm copy is precise: *"Undo this import? Only this
import's rows will be reversed; the manifest stays available for audit."* Undo is idempotent
(re-undoing returns `{undone: 0}`), and an undone import refuses remap (`409`) and refuses re-run
(`409`).

**Content-level undo** is separate and lives in `src/lib/history.ts`: `CONTENT_ACTIONS` are
restorable from `audit_log`, and — the load-bearing bit — *"History is append-only by construction —
a restore is a forward edit that adds a row … never an update or a delete of an old one."* A speaker
editing their own title and an organizer editing it are the same kind of fact, written with the same
before/after shape, and **both are restorable from the organizer's History card**.

**What it beats.** Sessionboard has no batch-import undo documented. Sessionize has no
post-acceptance workflow at all.

**Judge pitch.** *"Import a year of Sessionize data, look at it, undo it — and the audit manifest
survives the undo."*

**Status.** `verified-in-code`; `/api/v1/events/{eventId}/imports/{importId}/undo` is in the live
OpenAPI document.

---

#### A22. Optimistic concurrency — one excellent primitive, narrowly wired

**What it is.** `src/api/concurrency.ts` (130 lines): strong quoted ETags `"<id>:<updated_at>"`
(never weak), `requireIfMatch` (missing/malformed/weak/wrong-resource → 400; a *stale but
well-formed* tag is explicitly **not** rejected here — that's the CAS write's 409 job), and one
`compareAndSwapResource` primitive. It computes `nextUpdatedAt = max(now, expected+1)` so two writes
in the same millisecond still produce distinct versions, classifies `meta.changes` (1 → updated,
0 → re-read to distinguish 404-absent from 409-stale, other → invariant throw), and returns 409 with
the **current ETag in the header** plus only the safe summary needed to recover. D1 has no
interactive transactions, so the version check happens *inside* the conditional write.

The module's own doc comment declares the rule: *"Route-level read-then-unconditional-write and
per-call-site CAS variants are defects."*

**The adversarial finding.** Of **194** registered routes, exactly **2** declare
`concurrency: "if-match"` — both in `src/routes/agenda.routes.ts` (:440 and :511, the agenda item
move/update pair). Everything else is `concurrency: "none"`. So: the primitive is well-designed and
correctly used where drag-and-drop creates genuine write contention, but submission edits, event
settings, form definitions and venues are **not** protected by it. The client-side `conflict`
treatment ("Someone else changed this…") exists and is honest, but the server can only produce that
409 on the agenda.

**Judge pitch (honest).** *"The agenda — the one surface two organizers drag at the same time —
uses strong-ETag compare-and-swap, so a stale drag is refused with the current version rather than
silently overwriting."* Do **not** claim optimistic concurrency across the API.

**Status.** `verified-in-code`, including the negative.

---

#### A23. `Server-Timing` and an N+1 detector on every request

**What it is.** `src/api/router.ts` sets `Server-Timing: total;dur=…, d1;dur=…;desc="N queries"` on
every response, and logs one `http_request` line per completed request carrying `duration_ms`,
`d1_queries`, `d1_ms`. The comment names the purpose: *"`d1_queries` is the N+1 detector. Duration
alone says a request was slow; the query count says why, and 'once per row in a loop' is the usual
answer."* And: *"Speed is a graded feature; making it visible where a developer already looks is most
of what makes it stay fast."*

The route is logged as a **template** (`/api/v1/events/{eventId}/dashboard`), never a raw URL,
recorded *before* anything can throw so a rate-limited or unauthorized request still logs which
route it was aimed at. A request that throws still emits its line — *"the failing requests, the ones
that matter, would be the only ones missing from the request log."*

**Judge pitch.** *"Open DevTools on any request and the server tells you how long it took and how
many database queries it cost."*

**Status.** `verified-live`: `server-timing: total;dur=12, d1;dur=12;desc="1 queries"` on
`/api/v1/public/agenda`.

---

#### A24. Real-ugly seed data as a design rule

**What it is.** `DESIGN.md`: *"Real-ugly data always: long diacritic names, truncating titles,
1,000-row lists. A screen that only works with pretty data doesn't work."* Implemented in
`scripts/seed/ugliness.ts` — `Casey O'Connell-Singh`, `Mei-Ling de la Fontaine`, `Aïcha
Ndiaye-Kovács`, `Łukasz Żółć-Wiśniewski`. The speed harness deliberately searches for `Aïcha`,
`Dhinkran` and the typo `retrieval systms` among its 10 queries.

`npm run check:seed` asserts the seed produces ≥2 pinned buildings, non-zero building access time,
an unpinned `Online` building, and **at least one live Transit conflict** — the seed is required to
contain a real problem for a judge to find.

**Who it serves.** R25/R46 — a judge poking a seeded demo, and the 1,000–3,000 submission volume.

**Judge pitch.** *"The demo data ships with diacritics, hyphenated names, and a genuine scheduling
conflict — because a screen that only works with pretty data doesn't work."*

**Status.** `verified-in-code`.

---

### (B) Operational honesty

Things a system that will actually run AIE NYC 2026 needs, that no rubric item asks about.

---

#### B1. Demo-safe mail — outbound mail that cannot escape by accident

**What it is.** `outbox.send_policy` defaults to `'demo_safe'` **in the schema**
(`migrations/0001_init.sql:300–301`, `CHECK (send_policy IN ('demo_safe','always_live'))`). The
enqueue helper is built so ordinary code *cannot* opt into live delivery:

```ts
// src/jobs/mail/outbox.ts:120–137
/** Normal send paths take the schema default and cannot opt into live delivery. */
export function enqueueOutbox(input) { return insertOutbox(input); }

/** Live site 1: a public-form confirmation may deliver only to the address typed in that request. */
export function enqueuePublicFormConfirmation(input & {typedAddress}) {
  if (input.toEmail.trim().toLowerCase() !== input.typedAddress.trim().toLowerCase())
    return Promise.reject(new Error("public-form live mail must target the address typed in that request"));
  return insertOutbox(input, "always_live");
}

/** Live site 2: the smoke:mail/smoke:ics harness is the only other live-policy writer. */
export function enqueueSmokeHarnessMail(input) { return insertOutbox(input, "always_live"); }
```

**Exactly two** call sites in the entire codebase can write `always_live`, and one of them is
constrained to the address a human just typed in that very request. Even auth mail is denied
(`src/lib/auth/auth-mail.ts:11–12`: *"only the two call sites named in SPEC §3.8 may write
`always_live`, and auth mail is not one of them"*).

At send time, `shouldSuppress` (`src/jobs/mail/consumer.ts`) checks `events.demo_mode` and a
per-event `demo_safe_allowlist` setting; anything not allowlisted is written to the outbox with
`status='suppressed', suppressed_reason='demo_mode_not_allowlisted'` — **the message is still fully
rendered and stored**, it just doesn't leave.

**Why it exists.** Because a demo that emails 1,000 real speakers is not a demo, it's an incident.
And because R25 demands a judge can poke a seeded conference with real speakers in it.

**What it beats.** Nobody ships this. It is the single most obviously-load-bearing thing in the repo
for the actual competition scenario: judges will click "Accept 37 abstracts" on live seed data.

**Judge pitch.** *"Click 'Accept 37 abstracts' on the live demo. All 37 messages get written,
rendered, and shown to you — and not one of them leaves the building, because only two call sites in
the whole codebase can send live mail and neither is this one."*

**Status.** `verified-in-code`.

---

#### B2. Demo-safe truth at the moment of action, not after the fact

**What it is.** Main-only refinement (`src/jobs/mail/consumer.ts:144–155`): `demoMailWouldBeSuppressed`
is exported so a **route** can answer the question before the operator commits. Verbatim:

> *Exported so a route can tell an operator the truth at the moment they act. A UI that says
> "invitation sent" while the consumer will suppress it is a label that lies, and the operator only
> finds out when nobody replies.*

Paired with a copy change on main: the held-back guidance moved from *"Turn demo mode off…"* to
*"Nothing to do. Open the message in Communications to read exactly what this speaker would have
received."*

**Judge pitch.** *"The button doesn't say 'sent' when the system knows it won't send — and it tells
you where to read the message that didn't go."*

**Status.** `verified-in-code (on main)`.

---

#### B3. The "decided but not told" surface — the debt no incumbent names

**What it is.** The single best operational-honesty artifact in the product, and it exists at three
levels.

**Level 1 — the SQL predicate.** `src/routes/submissions.queries.ts:325–327`:
```sql
latest_decision.id IS NOT NULL
  AND latest_decision.resulting_status IN ('accepted','rejected')
  AND COALESCE(notification_outbox.status,'') <> 'sent'
```
Exposed as a first-class list filter, `status=not_notified`, with its own query path.

**Level 2 — the dashboard tile.** `src/routes/dashboard.routes.ts:226–233` —
`"Decided · not notified"`, count = *sendable*, note =
`"N can be notified now · M need an address first"`. It distinguishes the ones you can act on from
the ones blocked on missing data, in the tile.

**Level 3 — the ledger.** `src/lib/delivery-health.ts` derives **nine distinct owed states** from
the same facts, each with a level, an organizer sentence, and a next action:

| state | level | reason (verbatim) | what to do |
|---|---|---|---|
| `never_prepared` | alarm | "The decision is recorded but no message was ever written." | "Open the record and send the decision — **this speaker does not know yet**." |
| `send_blocked` | alarm | classified from provider text (conference-scope) | "Nothing is wrong with this address. Send it again tomorrow, or split the wave." |
| `undelivered` | alarm | classified from provider text (address-scope) | fix the address |
| `no_address` | alarm | "There is no usable email address on file." | "Add an address to this speaker's record, then send the decision." |
| `held_back` | alarm | "Cancelled because the acceptance was reversed." / generic | "…send the decision again once the reason no longer applies." |
| `held_back_demo` | **ok** | "Held back on purpose — this conference is in demo mode." | read it in Communications |
| `waiting_too_long` | warn | "Written and waiting longer than it should be." | "Give it a few minutes. If it is still here, send it again." |
| `changed_elsewhere` | warn | "The record changed in Airtable after the decision was made." | "Confirm the decision still stands, then send it." |
| `waiting` | ok | "Written and on its way out." | "Nothing to do — this one is in flight." |

The ordering is deliberate — *"a hard failure outranks an expected hold"* — and the reason-summary
is keyed on the **sentence**, not the state, because *"one state can carry several distinct reasons
… and collapsing them would print one of them over the other."*

Test: `tests/node/decided-not-notified.AC-268-269.test.mjs`.

**Why it exists.** This is the exact failure that ruins a conference: the decision is in the
database, the speaker is still refreshing their inbox, and nothing in the software knows the
difference.

**What it beats.** Nobody. Sessionboard's ~25 automated email triggers have no concept of a
notification debt; Sessionize has no post-acceptance workflow.

**Judge pitch.** *"One screen answers the question that actually ends conferences: who did we decide
about and never tell — and for each one, why, and what to do about it."*

**Status.** `verified-in-code`; `verified-live` — `/api/v1/events/{eventId}/delivery-health` is in
the deployed OpenAPI document (401 unauthenticated, i.e. the route exists).

---

#### B4. Delivery health that refuses to say "delivered"

**What it is.** `src/lib/delivery-health.ts` opens with three binding rules, of which the third is
the honest one:

> *A successful send means the message was accepted by the mail provider, not that it arrived.
> Nothing on this screen says "delivered" about a message past that point, because nothing here
> knows.*

And rule 2: *"Amber and red are earned. A screen read by an anxious person during a decision wave
has to be trusted, so an expected state (demo mode holding mail back exactly as configured) stays
green and says so plainly."*

Rule 1: *"Nothing technical reaches an organizer. No status codes, no SQL, no provider error text,
no internal reason token."* Reason tokens are mapped through `heldBackReason()`; anything
unrecognised falls through to a sentence that is true of every case.

The whole module is **pure** — facts in, sentences out, no bindings imported — so *"the judgement
calls … are unit-testable without a Worker."* SQL lives in `health-surface.routes.ts`; the screen
renders sentences *"without adding meaning of its own."*

**Judge pitch.** *"Marquee will tell you a message was accepted by the mail provider. It will never
tell you it was delivered, because it doesn't know — and a system that guesses about that is worse
than one that says so."*

**Status.** `verified-in-code`.

---

#### B5. Send-failure classification by *whose problem it is*

**What it is.** `src/lib/mail-failure.ts`. Six classes (`quota_exhausted`, `not_configured`,
`provider_unavailable`, `address_rejected`, `address_suppressed`, `unknown`) collapsed onto one
decision axis: `scope: "address" | "conference"`. Rationale, verbatim:

> *A spent daily allowance, a broken credential and a provider outage are conference-level facts.
> Filing them under a speaker's name sends an organizer to check an address that was never the
> problem — while the real cause, one setting or one wait, goes unnamed.*

Every conference-scope sentence **opens by clearing the speaker**: *"Nothing is wrong with this
address."* And the module documents its own blind spot: *"A hard bounce on a first send is invisible
to this classifier — the row stays `sent` with no error at all. The one bounce it can see is a
repeat send to an address the provider has since suppressed."*

**Judge pitch.** *"When a message fails, Marquee tells you whether it's that speaker's address or
your whole conference — because those are opposite actions."*

**Status.** `verified-in-code`. Test: `tests/unit/delivery-health-failure-classes.test.ts`,
`tests/unit/mail-failure.test.ts`.

---

#### B6. Send quota as a first-class conference-planning fact

**What it is.** `DAILY_SEND_LIMIT = 100` — Resend's free tier — described as *"A hard ceiling, not a
cushion — a wave that exceeds it silently strands speakers."* `deriveQuota` computes remaining and
shortfall and produces planning advice, not a number:
- *"N messages are waiting and none can go out until tomorrow."*
- *"N waiting and only M can go out. **Send the rest tomorrow, or split the wave.**"*
- *"A wave larger than M messages will not finish today."*

Main adds provenance to every one of those sentences: *"This allowance comes from your connected
email configuration. A conference using its own production Resend key sets its own ceiling."*

**Judge pitch.** *"It knows your mail provider's daily ceiling and tells you your acceptance wave
won't fit — before you send it."*

**Status.** `verified-in-code`.

---

#### B7. Idempotent mail, at the level of the business action

**What it is.** `buildIdempotencyKey = sha256(templateKey : entityId : personId)`
(`src/jobs/mail/outbox.ts:34–41`) — the comment is precise: *"the canonical AC-117 identity;
entityId is the business action, not a UUID generated for the row."* A duplicate insert trips the
UNIQUE constraint, is caught, and returns the **existing** row with `inserted: false` rather than
erroring. The key is also passed to Resend as an `Idempotency-Key` header on both the single and
batch endpoints, and stamped into the outgoing message's own headers.

So the chain is idempotent end-to-end: re-running an acceptance cascade cannot double-mail a
speaker, and a retried provider call cannot either.

**Judge pitch.** *"Run the acceptance cascade twice and nobody gets two emails — the identity is the
business action, not a row id, all the way through to the provider."*

**Status.** `verified-in-code`.

---

#### B8. A lease-based claim so two queue consumers can't send the same message twice

**What it is.** `claimRow` (`src/jobs/mail/consumer.ts:155–166`) writes a `__mail_processing__`
sentinel into `outbox.error` with a conditional `UPDATE … WHERE id = ? AND status='queued' AND
(error IS NULL OR (error = ? AND updated_at < ?))`, and treats `meta.changes !== 1` as "someone else
has it." The lease is 5 minutes, so a consumer that dies mid-send releases the row rather than
stranding it. Every subsequent transition (`markSent`, `markFailed`, `suppressRow`) is itself
conditional on still holding the sentinel.

Also honest about cost shape: ICS-bearing messages are sent **one at a time with a 100ms sleep**
between them (calendar attachments can't batch), while plain messages go as one provider batch.

**Judge pitch.** *"Two workers can pull the same message off the queue; only one of them will send
it, and a worker that dies mid-send releases it in five minutes instead of losing it."*

**Status.** `verified-in-code`.

---

#### B9. Reversal — cancel an acceptance with a preview of exactly what will be undone

**What it is.** `src/routes/submission-reversal.routes.ts` (258 lines). `GET .../reversal` returns a
**preview**: the submission, its agenda placement, every task (with `status`, `due_at`,
`completed_at`, `cancelled_at`), every scheduled email (with `status`, `scheduled_for`,
`suppressed_reason`), and every calendar invite (with `uid`, `sequence`, `last_method`). `POST`
takes four independent `cancel | retain` choices — `tasks`, `emails`, `calendar` — plus the outcome
(`withdrawn | rejected`), and returns both the result counts *and the preview again*.

The semantics are recorded in the migration that enabled them (`migrations/0004`): *"reversal state
is additive: **completed task work remains immutable**, while open work and scheduled outbox rows
can be reconciled by ownership."* Cancellation is a nullable tombstone (`speaker_tasks.cancelled_at`),
never a delete. Cancelled outbox rows get
`status='suppressed', suppressed_reason='acceptance_reversed'`
(`src/jobs/cascade/decisions.ts:655`), which the health ledger then renders as *"Cancelled because
the acceptance was reversed."*

The speaker portal shows cancelled tasks in a grouped, labelled section with the reason
(`PortalPage.tsx` — `portal-cancelled-set` / `data-cancelled-task-count`) rather than making them
vanish.

**What it beats.** Nobody. "We accepted them by mistake" is a real conference event with real
downstream artifacts — tasks, emails, calendar invites — and no competitor models the reversal.

**Judge pitch.** *"Reverse an acceptance and Marquee shows you every task, email and calendar invite
it's about to cancel, lets you keep any of them, and never deletes work the speaker already
finished."*

**Status.** `verified-in-code`; route present in the live OpenAPI document. Tests:
`cascade-reversal.AC-121-123.test.ts`, `submission-reversal.AC-123.test.mjs`,
`task-cancellation.AC-264-267.test.mjs`, `decision-history-reversal.MRQ-82.test.ts`.

---

#### B10. Calendar invites that CANCEL properly

**What it is.** `src/jobs/calendar/{ics,invites}.ts` track `uid`, `sequence` and `last_method`
(`REQUEST` / `CANCEL`) per invite. The mail consumer reads the ICS body's `METHOD:` line and sets
`content_type: text/calendar; charset=utf-8; method=REQUEST|CANCEL` plus
`Content-Class: urn:content-classes:calendarmessage` — the header pair Outlook actually needs to
process a cancellation rather than render an attachment.

**Why it matters.** R3 asks for calendar invites *"delivered directly to each speaker's own calendar
(Gmail, Outlook, iCal)"*. R3's research note is the tell: **Sessionboard's ~25 documented email
triggers contain no calendar-invite feature at all** — the brief is asking for something they wanted
and could not get. Marquee ships the *hard* half: the cancellation.

**Judge pitch.** *"Sessionboard has no calendar invites at all. Marquee sends them — and, when a
session moves or an acceptance reverses, sends the CANCEL that actually removes it from the
speaker's calendar."*

**Status.** `verified-in-code`. Tests: `calendar-invites.AC-95-97-124-252.test.ts`,
`calendar-ics.AC-95-96-97.test.ts`.

---

#### B11. Idempotent task reconciliation

**What it is.** `reconcileTaskSet` (`src/jobs/cascade/decisions.ts:304+`), documented as *"safe to
re-run because it reconciles the task set idempotently rather than [re-creating it]."* Notably, it
**un-cancels**: an open task carrying a `cancelled_at` tombstone gets
`SET cancelled_at = NULL … WHERE id = ? AND status='open' AND cancelled_at IS NOT NULL` — so
reverse-then-re-accept restores the speaker's task list instead of duplicating it. It emits a
`submission.tasks_reconciled` audit action.

**Judge pitch.** *"Accept, reverse, re-accept — the speaker's task list ends up correct, not
tripled."*

**Status.** `verified-in-code`.

---

#### B12. `audit_log` with exactly one writer, and a correlation column

**What it is.** `src/lib/audit.ts` is the only place the eleven audit columns are named. The doc
comment records the defect it fixed: *"Every audit row used to be a hand-written INSERT at its call
site — seven of them across four files… That shape is why the correlation column did not exist for
so long."*

Three deliberate design points:
- `auditStatement()` exists **alongside** `writeAudit()` because callers must compose the row into an
  existing `D1.batch()` — *"an audit row that lands in a separate transaction from the change it
  describes is worse than no audit row, because it reads as authoritative while being able to
  disagree with reality."*
- Ids are **ULIDs, not UUIDv4**: *"audit history is read in write order and paginated on a stable
  secondary sort by id, which a v4 identifier cannot give."*
- Main adds `auditStatementFromSelect()` — a **conditional** audit row via `INSERT … SELECT`, so an
  audit row is emitted only when the write it describes actually landed.

**`migrations/0006`** adds `request_id` + `CREATE INDEX idx_audit_request ON audit_log(request_id,
created_at)`, and the migration comment is itself an honesty artifact:

> *Nullable by necessity, not by laziness: rows written before this migration have no request to
> point at, and rows written from a cron trigger have no inbound request at all. A NULL here means
> "no originating request", which is a true statement about a scheduled sweep — it is never a write
> that lost its id. Queue-borne writes DO carry one, propagated in the message body, so an
> acceptance stays followable from the click through to the mail send.*

**Judge pitch.** *"One request id follows an acceptance from the organizer's click, through the
queue, to the email that went out — and the audit row and the log line both carry it."*

**Status.** `verified-in-code`. Tests: `tests/node/audit-request-id.test.mjs`.

---

#### B13. Log field allowlist — PII exclusion that is structural, not disciplinary

**What it is.** `src/lib/observability/log.ts`. The doc comment states the thesis in caps:
**THE LOAD-BEARING RULE IS THE FIELD ALLOWLIST.**

> *A speaker's email address cannot be logged because the shape has no slot for it — not because a
> redaction pass was remembered. That is a structural guarantee rather than a discipline, and it is
> the difference between an observability layer that is safe to run on a conference's speaker data
> and one that is a slow leak.*

Consequences, all deliberate: no request bodies, no raw query strings, no cookies, no Authorization
headers, no mail addresses — *there is no field for any of them*. Routes are logged as **templates**,
never raw URLs, *"because a raw URL is an exfiltration channel for the free text callers put in
query parameters."* Free-text `message`/`stack` are additionally scrubbed for address- and
credential-shaped runs — *"The allowlist is the guarantee; the scrub is the seatbelt on top of it."*
Hard caps: 300 chars of text, 1,200 of stack, 4KB per line, because *"a log line that can grow
without bound is a cost incident."*

And the review question it forces: *"could this ever hold something a speaker told us in
confidence?"*

**Who it serves.** GDPR exposure for a conference holding speaker bios, dietary requirements, travel
details (R49).

**Judge pitch.** *"A speaker's email address cannot appear in the logs, because the log schema has
no field for one."*

**Status.** `verified-in-code`. Tests: `tests/unit/observability-log.test.ts`.

---

#### B14. Cron heartbeats — catching the scheduled job that silently stopped

**What it is.** `src/lib/observability/heartbeat.ts`:

> *A cron that fires and fails is loud. A cron that never fires is silent — the trigger was removed,
> the deploy dropped it, the account was suspended — **and silence looks exactly like health**.*

Each successful run stamps KV; `CRON_SCHEDULE` mirrors the three triggers declared in
`wrangler.jsonc` with the period each promises (hourly pre-close reminder scan · daily Airtable
webhook keepalive · nightly orphaned-upload sweep); the diagnostics probe reads them back with a
1.5× staleness grace, *"because schedulers drift."* A trigger that has **never** run reports
`last_success_at: 0` and is stale — *"a fresh deployment says so honestly instead of claiming health
it has not earned."*

**Judge pitch.** *"If the nightly cleanup silently stopped firing, Marquee's health screen says so —
because a cron that never runs looks exactly like a healthy one."*

**Status.** `verified-in-code`. Test: `tests/unit/cron-heartbeat.test.ts`.

---

#### B15. Two health endpoints with different jobs, and the reason written down

**What it is.**
- `GET /health` — cheap liveness, touches **nothing**, `cache-control: no-store`, reports the
  deployed sha and build time.
- `GET /api/v1/telemetry/diagnostics` — deep probe across **D1, KV, R2, the queue bindings and the
  cron heartbeats**, per-probe timings, one verdict. Each probe turns a throw into a failed probe
  rather than a 500. Description, verbatim: *"One curl answers 'is it broken, and where'. Unlike
  /health — which stays a cheap liveness probe and touches nothing — this costs real work, so it
  requires a credential."*

**Judge pitch.** *"One curl tells you if it's up. One authenticated curl tells you which binding is
broken and how slow it is."*

**Status.** `verified-live`:
```
$ curl https://marquee.stage11.dev/health
{"service":"marquee","status":"ok","build":"8dc17d304472","built_at":"2026-08-12T17:10:02.169Z"}
$ curl -o /dev/null -w '%{http_code}' .../api/v1/telemetry/diagnostics   # 401 — exists, credential-gated
```

---

#### B16. `/instance/status` — derived, never stored, so it cannot go stale

**What it is (main-only).** `src/lib/instance-status.ts` + `src/routes/instance.routes.ts`. Four
rows — mail, uploads, spam, domain — each **derived on the request** from real binding and secret
presence and, for the domain row, from the URL the request arrived on. It touches no database at
all:

> *A stored "mail is configured" boolean is exactly the thing that goes stale the day someone rotates
> a secret and starts lying to the operator (ruling D8, AC-284).*

It also knows the **Turnstile always-pass test keys** by value and refuses to count them as
protection: *"The published always-pass pair. It protects nothing, so it is not protection."* Each
unconfigured row carries a `fix` array of *the exact commands*, copy-identical to the README's
deploy sequence. Row order and identity are fixed so *"nothing on the panel moves under the reader."*

**Who it serves.** Every self-hoster (R8, R54). The most common OSS failure is a fresh install that
claims to be configured.

**Judge pitch.** *"Clone it, deploy it, and one screen tells you exactly which of mail, uploads,
spam protection, and domain is really wired — derived live from your bindings, with the commands to
fix each one."*

**Status.** `verified-in-code`; `verified-live` — `/api/v1/instance/status` returns 401 on the
deployed sha, i.e. the route exists.

---

#### B17. Cold start: the claim door that closes forever

**What it is (main-only).** `src/routes/claim.routes.ts`. Two unauthenticated routes, *"and the only
two that exist."* `setup/claim-link` is callable without a credential *"precisely when no credential
does [exist] — and it is self-limiting: the moment the instance has an owner it refuses, forever."*
`claim` is the single exchange path for both a claim token and an organizer invite. Neither touches
a mail binding, because *"identity here cannot depend on the thing setup configures."* The claim URL
is returned once, *"Never stored, never logged — the log allowlist has no field for it."*

**Judge pitch.** *"A fresh deployment hands you one claim link with no password and no email
configured — and the moment you use it, that door is sealed forever."*

**Status.** `verified-in-code`; `verified-live` — `POST /api/v1/setup/claim-link` on the deployed
site returns **409**, which is the door correctly reporting that this instance is already claimed.

---

#### B18. Rate limiting: four buckets, honest headers even when unenforced

**What it is.** `src/api/rate-limit.ts` — four buckets only (`read` 600/min, `write` 120/min, `send`
30/min, `import` 12/min), with `public` as a *keying mode* rather than a fifth bucket. Cookie and
bearer traffic share one policy keyed to the effective principal (`person:` / `token:` / `ip:`);
`ip_submission` keying combines client IP with the submission/draft identity for public form paths.

The detail that shows the taste: `allowAllRateLimiter` is the no-adapter default, and its comment is
*"Allow-all limiter used when no adapter is installed; **headers stay truthful**."* It still computes
and emits a real window boundary rather than lying about the limit.

Uploads carry a **second, separate** KV-backed cap (`src/lib/r2/rate-limit.ts`): 20/hr per IP and
10/hr per submission, with an explicit disclaimer — *"KV's documented eventual consistency makes
these bounded-slop abuse caps, never an authorization boundary."* Keys are HMAC'd.

**Judge pitch.** *"Rate-limit headers on every response, four named buckets, and the code says out
loud which of its limiters is an authorization boundary and which is merely an abuse cap."*

**Status.** `verified-live`: `ratelimit-limit: 600 / ratelimit-remaining: 600 / ratelimit-reset:
1786558860` on both an anonymous 401 and a successful public API read.

---

#### B19. Upload safety: magic bytes beat the filename, always

**What it is.** `src/lib/r2/{sniff,policy}.ts`. Extension and declared MIME are validated
independently at sign time; the **magic-byte / container classification at completion time is
authoritative and never trusts either hint**. Fail-closed: *"an unreadable, truncated, or ambiguous
sample never resolves to a kind."*

- **No SVG** and **no generic ZIP fallback.** `PK\x03\x04` alone is not enough — *"the archive must
  also carry the exact manifest entry each format requires"* to be called PPTX or KEY.
- PNG/JPEG dimensions are parsed from the bytes (`readPngDimensions` at the fixed IHDR offset; a
  real JPEG marker walk for SOF).
- `HEADSHOT_MIN_DIMENSION = 256` with a stated reason: *"the crop UI renders 320px profile
  derivatives, so anything smaller than 256px would upscale visibly."*
- Ceilings: 100MB absolute, 10MB headshot, 5MB event logo, 25MB default file; owner config can
  tighten but is clamped to the absolute ceiling.
- Public presigns are Turnstile-gated server-side (`verifyTurnstile`); authenticated presigns are
  gated by principal/scope instead.
- Serving: *"only from the configured separate media origin, as an attachment with nosniff
  protection."*

**Judge pitch.** *"Rename `payload.svg` to `headshot.png` and Marquee reads the actual bytes,
doesn't find a PNG, and refuses it."*

**Status.** `verified-in-code`. Tests under `tests/unit/r2/`.

---

#### B20. Orphan sweep with a stated crash-safe ordering

**What it is.** `src/lib/r2/orphan-sweep.ts` — nightly, batched (100), for `pending` attachments
older than 24h. *"Never runs on a request path, never lists R2 — it walks D1's `pending` rows and
**deletes the matching object first, then the row**, so a crash mid-batch never orphans a D1 row
pointing at nothing (missing R2 object is treated as already deleted; a failed R2 delete keeps the
row for retry)."*

**Judge pitch.** *"Abandoned uploads get cleaned up in an order chosen so that a crash mid-sweep
leaves recoverable state, not a dangling pointer."*

**Status.** `verified-in-code`.

---

#### B21. Token handling: hashed, prefixed, shown once, session-only to mint

**What it is.** `src/lib/auth/random-token.ts` + `src/routes/tokens.routes.ts`.
- 32 random bytes → 32 base64url chars via `crypto.getRandomValues`; stored as SHA-256 only; a
  display `prefix` column so tokens are identifiable in a list without being recoverable.
- `constantTimeEqualHex` for comparison.
- Minting requires an **organizer session** — *"API tokens can only be managed from an organizer
  session"* — and an org-level `program_lead`+ membership. **A token cannot mint another token.**
- Scopes are `permissions[]` (from the closed `API_GRANTS` enum) × `event_ids[]`, with duplicate
  detection and a DB check that every `event_id` belongs to the caller's org.
- `revoked_at` / `last_used_at` are tracked.
- UI: `<span class="chip warning">Shown once</span>` and *"This is the only time Marquee will show
  this secret."*

**Adversarial nit.** `random-token.ts:1` says *"256 bits of entropy per minted credential."* Mapping
32 bytes through `byte & 0x3f` yields 32 characters × 6 bits = **192 bits**, not 256. Still far
beyond any practical attack; the comment is simply wrong and should read 192.

**Judge pitch.** *"Token secrets are shown once and stored only as a hash — and a token can never
mint another token."*

**Status.** `verified-in-code`.

---

#### B22. Concealment over disclosure, and a degrading credential that doesn't lock you out

**What it is.** Two authorization behaviours worth naming:

1. **404 doubles as concealment.** `ApiError.notFound` carries the comment *"404 doubles as
   intentional concealment: never distinguish 'absent' from 'hidden'."* The OpenAPI description for
   404 is literally `"Absent or intentionally concealed"`. So probing for another org's event ids
   yields no signal.

2. **A dead cookie degrades to anonymous on public routes only.** `resolvePrincipal`
   (`src/api/router.ts`) lets a 401 stand everywhere *except* `public` routes, where a caller with a
   dead credential must be treated as anonymous. The reason is a real trap: *"Without this, a stale
   `mq_session` cookie locks a browser out of the very public routes that exist to get it back in —
   sign-in and sign-out — and the cookie is HttpOnly, so nothing on the page can clear it."* The
   rejection is remembered (`credentialRejected`) so those handlers can help the browser recover.
   **Only 401 degrades** — a 500 out of D1 is *"a broken request, not an anonymous one, and still
   fails loudly."*

**Judge pitch.** *"An expired session cookie can't lock you out of the sign-in page — a failure mode
that ships in a surprising amount of production software."*

**Status.** `verified-in-code`; `verified-live` (an unauthenticated read of a non-existent event
returns the same 401/404 shape as a real one).

---

#### B23. Task due dates are days, not instants

**What it is (main-only).** `src/lib/task-due.ts`. *"An organizer types '2027-05-01' and expects to
read '2027-05-01' back, from any desk in any timezone. Parsing that string to local midnight breaks
the promise west of Greenwich — `new Date("2027-05-01")` is UTC midnight, which renders as Apr 30 in
New York."* Both ends pin to UTC. The stored instant is the **end** of the named day
(23:59:59.999 UTC) *"because 'due 2027-05-01' means the speaker has that whole day, not that they
were already late when it began."* `2027-02-30` is rejected by round-tripping through the formatter,
since `Date.UTC` rolls overflow forward.

**What it beats.** This is the single most common date bug in event software, and it hits speakers —
the people least able to argue about it.

**Judge pitch.** *"A task due May 1 is due at the end of May 1, in every timezone, and the speaker
isn't late at midnight."*

**Status.** `verified-in-code (on main)`.

---

#### B24. The roster definition, written once, with the wrong answer named

**What it is (main-only).** `src/lib/roster-source.ts`. `ROSTER_SUBMISSION_STATUSES = ['submitted',
'in_review', 'accepted', 'waitlisted']`, with the exclusions justified:

> *`draft` is a half-typed public form nobody has submitted; `rejected` and `withdrawn` are people
> the conference is explicitly not hosting. Listing any of them on a speaker roster — and, through
> the board source, chasing them for onboarding tasks — would make the roster a CFP funnel wearing
> the wrong noun.*

**Judge pitch.** *"The chase board will never email an onboarding reminder to someone you rejected —
because 'who speaks at this conference' is defined in exactly one place."*

**Status.** `verified-in-code (on main)`.

---

#### B25. Which conference is "the demo" — a guess replaced by an identity

**What it is (main-only).** `src/lib/demo-event.ts`. Both the landing page and `/auth/me` used to
answer *"the oldest `demo_mode = 1` row"*, and *"that was a guess wearing a query's clothes."* The
seed stamps rows with a **frozen clock set in the future**, so a conference created today sorts
*before* the seeded one — meaning the front door would advertise a visitor's own empty conference
with the real seeded program invisible one row below. Fixed by `ORDER BY (id <> ?) ASC, created_at
ASC LIMIT 1`: identity first, age only as fallback.

**Judge pitch.** *"A judge who creates their own conference doesn't accidentally replace the seeded
demo on the front door."*

**Status.** `verified-in-code (on main)`. This is exactly the class of bug that loses a competition
in the first thirty seconds.

---

#### B26. Queue-borne correlation and honest cron logging

**What it is.** `src/index.ts` — the composition root instruments bindings per request with a
metered D1 and **correlated queues**: the request id that enqueued a message is carried in the
message body, so *"the acceptance a human clicked and the mail the queue sent four [minutes later]"*
share one id. A cron run gets its own correlation id, *"and the queue it writes to is stamped with
it."* Every cron run — including failures — emits `cron_run` / `cron_error`, because *"a cron that
never fires leaves no trace at all."*

**Status.** `verified-in-code`.

---

#### B27. Repo-hygiene gate for an open-source release

**What it is.** `scripts/checks/check-repo.mjs` + `repo-policy.mjs` scan the **full path history**
(`git log --full-history --name-only`) *and* the full patch history (`git log -p`) of a publish ref
for denied paths (the board directory, `sequence/research/`, `sources/`, PDFs, `competitor-*`,
`AGENT-BRIEF-*`, `run-state*`, `Atin/`) and denied content (private filesystem paths, internal
hostnames, internal vocabulary, c11 surface/workspace ids, and **any real-looking email address**
outside `example`/`invalid`/`test`). It also requires a numbered deploy sequence in the README, three
named extension points (registration, Airtable, calendar OAuth), a LICENSE, no `PROTOTYPE` marker in
`src`, and a clean `gitleaks` run — treating gitleaks being *unavailable* as a finding rather than a
pass.

The policy file assembles its own denied strings via `joinParts(...)` so the checker's source cannot
itself trip the checker.

**Judge pitch.** *"Before the public repo ships, a check reads its entire git history — not just the
tip — for anything that shouldn't be there."*

**Status.** `verified-in-code`. Test: `tests/node/check-repo.test.mjs`.

---

#### B28. Agent briefs — the agent-native claim made concrete

**What it is (main-only).** `src/ui/shell/agent-briefs.ts`. On surfaces where an agent beats a human
clicking (`cfp`, `chase`, `agenda`, `portal`), the operator can copy a paste-ready instruction for
*their own* agent. Four things are load-bearing and *"a brief missing any of them is not
paste-ready"*:
1. the **real origin resolved at render**, never a placeholder — *"A brief naming some other
   deployment sends the agent to the wrong conference."*
2. the machine-readable entry point told as an instruction — *"An agent that reads
   `/api/openapi.json` first does not have to guess field names."*
3. the auth path and where to mint a token — *"A brief that omits this sends the operator's agent
   into a 401."*
4. **a definition of done, including the undo handle** — *"A brief that omits this gets back 'done'
   with no receipt and nothing to reverse."*

And the guardrail: *"A brief is never a replacement for the screen"* — the brief calls the same
endpoints the screen does. Copy is per-surface on purpose: *"a brief whose body is the shared
paragraph with the nouns swapped has not described a job."*

**What it beats.** R53 is an explicit written bonus (*"Bonus points for API"*). Nobody else will
ship the affordance *on top of* the API.

**Judge pitch.** *"Every major screen has a 'hand this to your agent' button — and the brief it
copies includes where to get a token and how to undo what the agent does."*

**Status.** `verified-in-code (on main)`.

---

#### B29. Bulk file export as a streaming STORE zip that reports its own holes

**What it is (main-only).** `src/lib/zip-store.ts` + `src/routes/files-export.routes.ts`. A
deliberately small ZIP writer: STORE only *"keeps Worker CPU predictable"*, data descriptors let each
R2 body stream through *"without buffering it just to calculate its CRC first"*, and only the central
directory (metadata) is held in memory. The export request is capped (200 task ids, deduped by a Zod
`.refine`), groupable by session or speaker, and chunked at 80 per query.

The honest part: `ZipStoreManifest.missing` is *"a human-readable line describing a selected
deliverable with no bytes"* — the zip **tells you which slides you asked for and didn't get** rather
than silently producing a smaller archive.

**Judge pitch.** *"Export every speaker's slides as one streaming zip — and the zip names the ones
that were never uploaded instead of quietly omitting them."*

**Status.** `verified-in-code (on main)`; `/api/v1/events/{eventId}/files/export` is in the live
OpenAPI document.

---

#### B30. History that is append-only, with attribution fixed in one place

**What it is (main-only).** `src/lib/history.ts` — the single human-facing reader for `audit_log`.
The bug it was created to fix is recorded: the portal joined `people` and read *"Priya Raman · 12
Aug · updated title"*, while the admin record selected `actor_person_id` and never resolved it, *"so
the organizer History card rendered the literal string 'user' (the `actor_kind` column)."* Both now
read through here, *"which is the only way the two surfaces can stay honest about the same rows: an
attribution bug fixed on one is fixed on both."*

`actor_name` is explicitly nullable — *"Null when the actor is not a person (a cron sweep, an
import)"* — rather than inventing a name.

**Judge pitch.** *"Every content change is attributable and restorable, and restoring writes a new
row instead of erasing the old one."*

**Status.** `verified-in-code (on main)`.

---

### Adversarial summary — what is NOT true

State these as limits, or a judge will find them:

1. **Speed budgets are not enforced by any gate.** 14 budgets exist, 7 acceptance-grade, traced to
   ACs, driven by a real browser — but `check:speed` is in neither `pr-gate.mjs` nor
   `.github/workflows/ci.yml`, and `speed-report.json` has never recorded a single budget id. Claim
   *"budgeted and measurable in one command"*, never *"enforced in CI"*. (§A13)
2. **GitHub CI is a subset of the local PR gate.** CI runs typechecks, build, `check:design`,
   `check:clocks`, `npm test`, `trace:ac`. It does **not** run `check:api`, `check:routes`, or
   `check:shell-truth` — those are local-gate-only, so a PR that skips `npm run pr-gate` can merge
   with API/doc drift, route-map drift, or a hardcoded demo id. (§A13, A16, A17, A18)
3. **Optimistic concurrency covers 2 of 194 routes.** The CAS primitive is excellent; only the two
   agenda mutation routes declare `if-match`. Submission edits, settings, forms and venues are
   last-write-wins. (§A22)
4. **The OpenAPI ETag is a parity digest, not a conditional GET.** Live `If-None-Match` returns 200,
   not 304.
5. **`/health` and SSR pages carry no `X-Request-Id`, `RateLimit-*` or `Server-Timing`.** Those
   headers are produced by the `/api/v1` pipeline only. Correct, but don't claim them site-wide.
6. **"Delivered" is genuinely unknown** — the product says so itself (§B4), and a hard bounce on a
   first send is invisible to the failure classifier (§B5). This is a strength when stated and a
   liability if oversold.
7. **`random-token.ts` claims 256 bits; it mints 192.** A comment bug, not a security one. (§B21)
8. **The deployed site is 25 commits behind main.** Anything marked
   `verified-in-code (on main, not yet deployed)` — §B2, B23, B24, B25, B28, and parts of B16/B17 —
   needs a deploy before a judge can see it. Deployed sha `8dc17d30`, built 2026-08-12T17:10Z; live
   `/health` reports it honestly, which is itself the point.

---

### The three-line version, if the operator needs to pare down

1. **§B1 + §B3** — demo-safe mail and the "decided but not told" ledger. Nobody ships either, both
   are demonstrable in the seeded demo in under a minute, and together they answer the question that
   actually ends conferences.
2. **§A15 + §A16 + §A6** — `check:clocks`, `check:routes`, and the executable design contract. Three
   CI checks that exist because someone got burned, each with the incident written into the source.
   This is the "craft, not features" argument in its strongest form.
3. **§A2 + §A3** — one error envelope with a correlation id, and a UI that never shows a status code.
   The complete answer to R14 and R26 in one screenshot.

---

## Group D — Surfaces beyond the brief

Research slice: **whole features/areas the competition requirements never requested.**
Ground truth for "asked": `sequence/research/competition-requirements.md` (R1–R54).

---

#### 0. Verification ground rules (read this before quoting anything below)

**Three trees, and they are not the same tree.**

| Tree | SHA | What it is |
|---|---|---|
| Primary checkout | `13a77cb4` | **91 commits behind.** 42 route files. Do not read source from it. |
| `github/main` | `8098c380` | True main. 62 route files. Source of truth for code. |
| **Deployed site** | **`8dc17d30`** | `curl https://marquee.stage11.dev/health` → `{"build":"8dc17d304472","built_at":"2026-08-12T17:10:02Z"}`. **25 commits behind main.** |

**Empirically measured deployed-vs-main gap** (not inferred from commit titles — diffed
`path: "/api…"` declarations at both SHAs, then cross-checked against the live
`/api/openapi.json`, which reports **187 operations / 148 paths**):

Present on main, **absent from the live build** — exactly five API paths plus their UI:

- `GET /api/v1/events/{eventId}/copy-plan` — the conference copy engine's preview
- `POST /api/v1/public/schedules`, `GET|PATCH /api/v1/public/schedules/{code}`, `GET …/calendar.ics` — the attendee personal schedule
- `GET /api/v1/public/sessions/{slug}/calendar.ics` — per-session ICS
- SSR routes `GET /site` and `GET /agenda/agents` (confirmed by diffing `public-agenda.route.tsx` at both SHAs)
- UI files not in the deployed bundle: `shell/EventSwitcher.tsx`, `shell/event-context.tsx`, `shell/NoConference.tsx`, `shell/event-selection.ts`, `public/agenda/schedule-script.ts` (1,078 lines), +285 lines on `setup/CreateConferencePage.tsx`, +511 on `PublicAgendaPage.tsx`
- `GET /api/v1/events` (list conferences) — **`POST /api/v1/events` IS live, `GET` is not**

**Correction to the coordinator's brief:** the MRQ-105 cold-start / claim chapter **IS
deployed** — `POST /api/v1/claim`, `POST /api/v1/setup/claim-link`, `GET /api/v1/instance/status`
all appear in the live OpenAPI and `/api/v1/instance/status` returns real data live. What is
*not* deployed from that chapter is only the conference-switcher UI. (See §E1 for a separate,
worse problem with the claim page that affects **main too**.)

**How live verification was done.** `POST /api/v1/auth/demo {"role":"organizer"}` on the real
site yields a session cookie; every `verified-live` claim below was confirmed by an
authenticated `curl` against `https://marquee.stage11.dev` and, for public surfaces, by
scraping the rendered HTML. The SPA serves **200 + a 1,486-byte shell on every unmatched
path** (`src/index.ts`'s `app.all("*")`), so *a bare 200 proves nothing* — that is why the
verification below goes through the API and the rendered text, never the status code.

---

#### 🔴 TWO FINDINGS THAT SHOULD REACH THE OPERATOR BEFORE ANY SUBMISSION COPY IS WRITTEN

##### 🔴 F1. The live demo conference's dates and venue contradict its own program

The live public agenda header reads **"DevFlow Conf 2027 · 2027-05-12 → 2027-05-14 ·
Moscone West, San Francisco, CA"**, and the day-filter tabs offer **Wed May 12 / Thu May 13 /
Fri May 14**. The actual seeded sessions are on **Mon Oct 12 / Tue Oct 13** in **Sheraton New
York Times Square** and **New York Marriott Marquis** rooms.

Clicking any day tab a judge is offered returns:

> `curl "https://marquee.stage11.dev/agenda?day=2027-05-12"` → **"No published sessions match — Clear a filter to bring the program back into view."**

Someone (a test/UX agent — speaker bios on the live site carry `SBEK-PORTAL-BIO-01` markers)
renamed and re-dated the demo conference in Event Settings without moving the program. **Every
day filter on the public conference site is now a dead end**, and the venue string in the
header disagrees with the venue on every session card. `POST /api/v1/admin/reset-demo` exists
and is live; it should be run before judging.

##### 🔴 F2. `/claim/:token` and `/join/:token` never reach the Worker — in production *and* on main

`wrangler.jsonc` `assets.run_worker_first` lists `/`, `/api/*`, `/health`, `/__validation/*`,
`/f/*`, `/agenda*`, `/speakers*`, `/s/*`, `/p/*`, `/embed/*`, `/i/*`. It does **not** list
`/claim/*` or `/join/*`. With `not_found_handling: "single-page-application"`, Cloudflare's
static-asset router answers those paths from `index.html` **before the Worker runs**.

Verified live: `curl https://marquee.stage11.dev/claim/deadbeef` returns exactly the 1,486-byte
shell — no `data-marquee-claim` style block, no claim copy, no "this link is no longer valid"
page. Same for `/join/deadbeef`. `git diff 8dc17d30 github/main -- src/routes/claim.route.tsx
src/index.ts` is **empty**, so this is not a staleness artifact: **the entire ownership
ceremony that README.md, `docs/GETTING-STARTED.md`, and `SKILL.md` all instruct the new owner
to walk through renders a blank page in production, on main.** The fix is one line in
`wrangler.jsonc`.

Same mechanism will silently kill `/site` (the dead-end redirect added on main) the moment it
deploys: `/site` is not in `run_worker_first` either.

---

#### A. Venue geography — the map, and the conflict class it exists to justify

No R-number mentions geography, walking distance, buildings, coordinates, or building access.
R5 asks for "automatic conflict detection **across rooms and tracks**" — two axes, both
logical. Physical space is a third axis nobody asked for.

##### A1. Buildings as real places — coordinates, addresses, access time, access notes

- **What it is.** `buildings` carries `lat`/`lng` (nullable), `address`, `access_minutes`, and
  `access_note`. Rooms nest under buildings with capacity and AV capabilities. Migrations
  `0002_venue_geography.sql` and `0003_building_access_note.sql` exist for exactly this.
- **Why it exists.** The seed is genuinely multi-venue. A speaker in the Sheraton at 10:00 and
  the Marriott at 10:30 is a nine-minute walk plus three minutes of lobby security away from
  being late, and a scheduler that compares only `day + time` calls that clean.
- **Who it serves.** The organizer placing sessions; the speaker who needs to know when to leave.
- **What it beats.** *Nobody ships this.* Sessionize models rooms as strings. Sessionboard's
  agenda views are List/Day/Week/Month/Rooms/Conflicts — no geography.
- **Asked?** **Unasked.** No R-number.
- **Judge pitch.** "Your rooms are in two hotels nine minutes apart. Marquee knows that, and it
  refuses to pretend a 30-minute gap is enough."
- **Verification.** `verified-live` — `GET /api/v1/events/evt_aie-ny-2026/venues` returns
  Sheraton (`lat 40.7625188`, `access_minutes 0`, access note "Photo ID required at the main
  entrance…"), New York Marriott Marquis (`access_minutes 3`), and `Online` with `lat: null`.

##### A2. The **Transit** conflict class

- **What it is.** A fourth conflict type beside room-overlap and speaker-double-booking:
  `haversine × 1.3` (Manhattan grid detour) at 80 m/min, plus the destination building's
  `access_minutes`. Message shape: *"Transit — 9 min walk to New York Marriott Marquis, plus 3
  min building access. Needs 12 min; has 0."* Warns, never blocks. A building with no pin
  (the stream) raises no conflict; same-building room changes raise none.
- **Why it exists.** Design record: `sequence/venue-map-brief.md` T3, client-signed 2026-08-10.
  "The map is the evidence behind a warning the product can now make. Build it in that order —
  the conflict class is the point, the map explains it."
- **Who it serves.** The organizer, at the moment of the mistake.
- **What it beats.** Both incumbents, categorically.
- **Asked?** **Unasked.** R5 asks rooms and tracks. This is a class R5 does not contain.
- **Judge pitch.** "Marquee is the only one of the three that can tell you a speaker physically
  cannot make it."
- **Verification.** `verified-in-code` — `src/lib/venue-geometry.ts`, `src/lib/conflicts.ts`,
  seeded two-building venue set confirmed live via the venues API (A1). *Not directly exercised
  live* because the live demo's dates are broken (F1) and the agenda builder is behind auth.

##### A3. Five zooms of geography, only one of which is a map

- **What it is.** A design doctrine (`sequence/venue-map-ux.md`) that renders location at the
  cheapest fidelity each surface can afford: a `Room · Building` chip (free), "+6 min from the
  main stage" (free), "leave by 10:14" plus the entrance note (free), a 280px pin popover, and
  the full Leaflet overview at `/settings/venues`. Leaflet + OSM tiles are **vendored locally —
  no CDN, no API key**, because the repo goes public.
- **Why it exists.** "A map page is a map ghetto. It costs a sidebar slot, duplicates the
  buildings list, and answers a question nobody asked at the moment they asked it."
- **Who it serves.** Everyone, without any of them visiting a map.
- **What it beats.** The generic "we added a map tab" implementation every competitor who
  thinks of geography will ship.
- **Asked?** **Unasked.**
- **Judge pitch.** "Geography is a property of your rooms, not a page. The map is the receipt."
- **Verification.** `verified-in-code` — `src/ui/venues/VenuesPage.tsx`, route `/settings/venues`
  registered in `src/ui/shell/route-table.ts`; venue data confirmed live. `partial`: the route is
  deliberately **not in the sidebar** (`group: "utility"`), reached only from Conference settings.

---

#### B. The attendee — a fourth audience nobody in the brief has

The brief has three seats: organizer, speaker, reviewer. R24 asks that the agenda be
*displayed and embeddable*. **Nothing anywhere asks for the person attending the conference to
be able to do anything.** This is the single largest unasked surface in the product.

##### B1. Star a session · **My schedule** (`/agenda?view=mine`)

- **What it is.** A star on every session card on the public agenda; `?view=mine` is a real URL
  (linkable, back-button-correct, server-rendered with the whole program) that shows only what
  you starred, with overlap detection across your picks. Stars are written to `localStorage`
  **synchronously** — "the attendee is standing in a hallway on hotel wifi and a star must never
  wait on a network." No account, no login.
- **Why it exists.** A published agenda that you can only read is a poster. `src/ui/public/agenda/schedule-script.ts` is 1,078 lines of framework-free vanilla JS because public pages carry no Preact runtime.
- **Who it serves.** The 1,000–1,500 in-person attendees of AIE NYC — the conference's actual customers, who appear nowhere in the requirements.
- **What it beats.** Sessionize's public agenda is read-only. Sessionboard's is read-only. Every conference in this category buys a *separate* attendee app for this.
- **Asked?** **Unasked.** No R-number.
- **Judge pitch.** "The agenda your attendees get is the one they can build a day out of — no app download, no account."
- **Verification.** `verified-in-code (on main, not yet deployed)`. Confirmed absent live:
  `curl "https://marquee.stage11.dev/agenda?view=mine"` contains **zero** `data-public-schedule`
  hooks. The implementing file is in the deployed-vs-main diff.

##### B2. Shareable schedule short code + calendar subscription

- **What it is.** `POST /api/v1/public/schedules` promotes a set of published sessions to a
  short code and returns a **write key, once**. The code alone gets you the JSON, a share link,
  and `/api/v1/public/schedules/{code}/calendar.ics` — a subscribable feed, not a one-time
  download. Only the write key can change what the code points at. Rate-limited by client IP;
  refusals name unknown session IDs **machine-readably** so a caller can drop exactly those and retry.
- **Why it exists.** Verbatim from the file header: *"The whole loop an agent can run for its
  human: read the agenda, POST a set of sessions, hand back a link and a calendar feed. No
  account, no key exchange, no browser required."*
- **Who it serves.** The attendee; a team sharing one plan; **an agent planning a day for its human.**
- **What it beats.** Nobody ships an anonymous, agent-drivable, subscribable personal schedule.
- **Asked?** **Unasked.** R3's calendar invites are speaker-side and organizer-triggered.
- **Judge pitch.** "Your attendee's day, on a short link, in their calendar — and an agent can build it for them in three calls with no account."
- **Verification.** `verified-in-code (on main, not yet deployed)` — live `POST /api/v1/public/schedules` returns **404**.

##### B3. `/agenda/agents` — a public page addressed to machines

- **What it is.** A public, cacheable (`max-age=300`) page that tells an agent how to read this
  conference's program: the endpoints, the shapes, the schedule loop.
- **Why it exists.** The agent-native bet, aimed at the one audience that reads documentation.
- **Asked?** **Unasked.** R53 asks for *an API*; it does not ask for a public page that teaches a stranger's agent to use it.
- **Judge pitch.** "Every conference site has a page for humans. This one has a page for their agents."
- **Verification.** `verified-in-code (on main, not yet deployed)` — `curl /agenda/agents` returns the SPA shell; route confirmed present at `github/main` and absent at `8dc17d30`. ⚠️ **When it deploys it will still 404 unless `/agenda*` covers it — it does** (`run_worker_first` has `/agenda*`), so this one is safe.

##### B4. Public speaker directory, session pages, speaker pages

- **What it is.** `/speakers` (searchable directory with headshots, title, company), `/s/:slug`
  (session permalink), `/p/:slug` (speaker permalink). Unpublished titles have no public permalink.
- **Asked?** **Partially asked** — descoped brief item 9 ("embeddable, mobile-friendly speaker
  gallery") was struck through, then contradicted by the video at [08:22]/[08:37]; Q2 in the
  dossier is still formally open. Take credit carefully: the *gallery* was struck, the
  *directory as a first-class public surface with per-person permalinks* was not asked at all.
- **Verification.** `verified-live` — `/speakers` returns 25,541 bytes of real people (Aarush
  Selvan · Google Gemini, Barry Zhang · Anthropic, Beyang Liu · Sourcegraph…).

##### B5. Per-session `.ics`

- **Asked?** Unasked (R3 is speaker calendar invites; this is attendee-side).
- **Verification.** `verified-in-code (on main, not yet deployed)`.

---

#### C. Multi-event and the org above it

##### C1. Multi-conference, with a switcher

- **What it is.** Every entity keyed to an event from migration `0001`; on main a real
  conference switcher in the sidebar, an `EventProvider` context wrapping both render roots, and
  a `NoConference` state for an instance with none.
- **Asked?** **Asked, by us, not by them.** R45 (BONUS, **[INFERRED]** — "AIE runs 4 events/yr")
  and dossier Q4's default ("model events as first-class, ship a UI that presents one event
  well"). No swyx statement asks for multi-event. Frame it as answering their operating reality,
  not the brief.
- **Verification.** Schema + `POST /api/v1/events` `verified-live`; **switcher UI and
  `GET /api/v1/events` `verified-in-code (on main, not yet deployed)`** — live `GET /api/v1/events` returns 404.

##### C2. 🌟 The copy engine — "create next year's conference from this one"

- **What it is.** `POST /api/v1/events --from <event-id> --copy <sets>` clones a conference:
  tracks, formats, buildings/rooms, forms and their fields, evaluation plans, rubric criteria,
  committees, task templates. `GET …/copy-plan` **previews** what would travel — per-set counts,
  dependency prerequisites measured rather than asserted, and a count of task templates
  *declined because they carry a fixed calendar deadline*. The whole clone commits in one
  `db.batch()`: "the new conference arrives whole or not at all."
- **Why it exists.** Two engineering rules in `copy-manifest.ts` worth quoting to a technical
  judge: columns are **discovered** via `SELECT *` so a future migration's column is copied
  without anyone remembering; and every column is **nonetheless declared**, with a test
  asserting the manifest against `PRAGMA table_info`, so a new column can never be silently
  dropped. It also states honestly that the read phase is outside the batch because D1 gives no
  snapshot, so a concurrent edit yields a slightly-earlier copy — "acceptable for a once-a-year
  action and stated rather than implied away."
- **Who it serves.** AIE, who run four events a year and rebuild the same taxonomy four times.
- **What it beats.** Sessionize makes you rebuild. Sessionboard's event duplication is not documented in its KB.
- **Asked?** **Unasked.** R45 asks that multiple events be *supported*; nothing asks that one be *made from* another.
- **Judge pitch.** "Set your conference up once. Every year after that is one command and a preview of exactly what travels."
- **Verification.** `verified-in-code (on main, not yet deployed)` — live `/copy-plan` returns 404. Code: `src/lib/events/copy-event.ts`, `src/lib/events/copy-manifest.ts`; tests `tests/integration/multi-event.MRQ-129.test.ts`.

##### C3. ⚠️ People — the org-level person record (**read the risk note**)

- **What it is.** A sidebar group **above** the conference caption: **People**, **Lists**,
  **Sourcing pipeline**. One person record that outlives every conference — email, title,
  company, bio, headshot, tags, notes, custom fields, `conference_count`, `last_contact_at`,
  `stage`. Live it holds **1,108 people**. `GET /api/v1/org/summary` returns
  `{people: 1108, conferences: 1, returning_speakers: …, top_companies: […]}`.
- **Why it exists.** Verbatim from `route-table.ts`: *"'People' is the word organizers and the
  conference world use. Not 'CRM', which is software's word for it; not 'Directory' or
  'Contacts', which are address-book register for a record that carries a decade of history."*
  The nav placement is the scope boundary made visible.
- **Who it serves.** The program lead deciding who to invite back.
- **🔴 RISK — this is the one surface that can be read as *violating* the brief.** **R8 is an
  explicit SKIP: "Do not build CRM"** ([02:06] *"not really using the CRM side"*). An adversarial
  judge who sees People + Lists + a **Sourcing pipeline with stages Researching → Identified →
  Contacted → Interested → Confirmed / Declined** will recognize a sales CRM shape. Submission
  copy must lead with the *returning speaker* framing (who spoke in 2025, who to invite for
  2026) and must never use the word CRM or "prospecting" — and probably should not foreground
  the pipeline stage names at all.
- **Asked?** **Unasked, and adjacent to an explicit SKIP.** Handle deliberately.
- **Judge pitch (careful version).** "Your speakers don't reset every year. Marquee remembers who spoke, who you talked to, and who to ask back."
- **Verification.** `verified-live` — `GET /api/v1/org/people?per_page=2` (real people), `/api/v1/org/summary` (1,108 / top companies), `/api/v1/org/pipeline` (six stages). Convenience aliases `/crm`, `/directory`, `/contacts` all resolve to People *"because agents guess URLs, and every 404 costs turns"* — a genuinely nice unasked detail.
- **`partial`:** live `GET /api/v1/org/lists` returns `{"data":[]}` and `/api/v1/org/pipeline` returns `cards: []`. **Lists and the sourcing pipeline are unseeded — a judge who clicks them meets an empty state.** Per the dossier's own §3: *"Shipping an empty database is the single most likely way to lose."* This is a seed gap, not a code gap.

##### C4. Lists — a saved filter *or* a frozen selection

- **What it is.** Save a filter as a **live** list, or a selection as a **fixed** one. "Deletes the list, never the people in it."
- **Asked?** **Unasked.**
- **Verification.** `verified-live` (endpoint answers) / `partial` (zero seeded lists).

##### C5. Org-level bulk email to an arbitrary selection

- **What it is.** `POST /api/v1/org/comms/send` emails a selection of people; `…/preview` renders **recipient 1 exactly as it will be sent**, merge tags resolved.
- **Asked?** **Unasked at org level.** R3 asks for templated *speaker* comms scoped to an event; R51 asks for a decision-feedback email. Emailing "the 40 people we met at last year's expo" is outside all of them.
- **Verification.** `verified-live` (in the live OpenAPI, `Comms`/`People` tags).

##### C6. Org CSV people import, organizer invites, membership management

- **What it is.** `POST /api/v1/org/imports` (CSV → people). `GET|POST /api/v1/org/invites` mints one-time organizer invite links ("a spent invite is history, not a pending one"), `DELETE` revokes. `GET /api/v1/org/members` lists everyone who can run the instance; `DELETE` removes access.
- **Asked?** **Unasked.** R40 asks for *form admins* — who gets notified on a form. Instance-level membership and invitation is a different thing entirely.
- **Judge pitch.** "The second organizer gets in without anybody sharing a password — there are no passwords."
- **Verification.** `verified-live` — `/api/v1/org/members` returns the owner row with `is_you: true`; `/api/v1/org/invites` answers `{"data":[]}`.

---

#### D. Embeds as a first-class organizer area

##### D1. The embed builder (`/embed/config`)

- **What it is.** A public, no-login builder page: **4 surfaces** (Agenda · Sessions · Speakers ·
  Call for speakers) × **3 outputs** (Styled HTML · **JSON feed** · **iCal feed**), plus track
  filter, status filter (published/accepted/waitlisted), card-vs-list layout, and an **accent
  color** picker. It writes the `<iframe>` snippet live and previews the result. Served
  anonymously from a 30-second edge cache.
- **Asked?** **Half-asked, and the half that was asked is the small half.** Brief item 9 was
  struck; §1.6 titles the screenshot section "CMS > Embeds **(OPTIONAL)**"; the video at [08:22]
  describes it approvingly. Dossier Q2 remains open. **The JSON and iCal outputs are asked for by nobody at all** — the incumbent's embeds are HTML.
- **Judge pitch.** "Pick a surface, pick a track, pick a color, copy the iframe. Or take the same thing as JSON or as a calendar feed."
- **Verification.** `verified-live` — the full builder renders at `/embed/config` (41,871 bytes) with every control listed above, and emits a real snippet against `marquee.stage11.dev`.

##### D2. Saved embeds with a kill switch

- **What it is.** Name and save a snippet; `enabled: false` **stops its public URL without editing your website.**
- **Why it exists.** Migration `0010_saved_embeds.sql`. The organizer who embedded last year's agenda in a marketing page they no longer own needs an off switch they control.
- **Asked?** **Unasked.**
- **Judge pitch.** "Turn an embed off from here, not from whoever still has the CMS password."
- **Verification.** `verified-live` — `GET /api/v1/events/evt_aie-ny-2026/embeds` returns a seeded "Platform track sessions" embed with its generated iframe snippet.

---

#### E. Cold start, ownership, and the self-host story

The competition requires *an open-source repo* as a deliverable. It never asks that the software
be **installable by someone else** — and that gap is where a large amount of this work sits.

##### E1. Claim your instance — 🔴 built, documented, and broken in production

- **What it is.** The deploy prints a one-time claim link. A human opens `/claim/:token` and
  becomes the owner. `/join/:token` is the same page with different copy for the second
  organizer. **There is no signup page**, deliberately: "an unclaimed instance on a public URL
  must not have one." One inert page answers used, expired, and unknown identically — no oracle
  for anyone guessing tokens. Ruling D5 in the code: *"an agent runs the deploy, but it must not
  run this: ownership has to land on a person."*
- **Asked?** **Unasked.** Nothing in R1–R54 concerns installation or ownership.
- **Judge pitch.** "Nobody creates an account. The deploy hands one person a link, and that person owns the instance."
- **Verification.** **API `verified-live`** (`POST /api/v1/claim`, `POST /api/v1/setup/claim-link` in the live OpenAPI). **Human-facing page: 🔴 `partial` — broken live *and on main*.** See §F2 above: `/claim/*` is not in `wrangler.jsonc`'s `run_worker_first`, so Cloudflare's asset router answers it from `index.html` before the Worker ever runs. Verified: `curl /claim/deadbeef` → 1,486-byte bare shell, no claim markup. One-line fix.

##### E2. The instance tells the truth about itself

- **What it is.** `GET /api/v1/instance/status` — *"Read what is configured on this deployment,
  and what honestly is not."* Per capability: `configured` true/false, a plain-English note, and
  **the exact command that fixes it**. Live it returns mail (Resend, verified sender), uploads
  (R2), spam (Turnstile), domain.
- **Why it exists.** `docs/GETTING-STARTED.md`: *"Mail, uploads, spam protection, domain: each reads configured or not configured, with the exact command that fixes it. Nothing pretends."*
- **Asked?** **Unasked.**
- **Judge pitch.** "Half-configured is the normal state of a fresh deploy. Marquee names what's missing and hands you the command."
- **Verification.** `verified-live` — returns four capability rows with `fix:` command arrays.

##### E3. Demo removal and demo reset as real operations

- **What it is.** `POST /api/v1/admin/reset-demo` (queued, with a job you can poll) and
  `POST /api/v1/admin/remove-demo` — *"Remove the seeded demo conference and its people."*
- **Why it exists.** A seeded demo is how you win a judged evaluation and exactly what you cannot ship into a real conference's production instance. Both are true, so both are commands.
- **Asked?** **Unasked.** R25 asks for self-serve explorability; it does not ask that the demo be removable afterwards.
- **Judge pitch.** "Look around the demo, then delete it. Your instance, your call."
- **Verification.** `verified-live` (both in the live OpenAPI; reset is what should be run to fix F1).

##### E4. "Marquee never phones home" — a privacy posture stated in the first screen of the README

- **What it is.** No vendor SDK, no error-tracking DSN, no analytics script, no telemetry
  endpoint that is not your own deployment. **Logs are built from an allowlist, not scrubbed by
  a denylist** — routes recorded as templates never raw URLs, and there is no field anywhere for
  a request body, cookie, `Authorization` header, or address. *"A speaker's email address cannot
  be logged, because the log builder has no field for it."* Three documented off switches
  (`docs/OBSERVABILITY.md`). Every error surface shows a short reference code that greps straight
  to its log line — "the support handshake is one paste, not a screen-sharing session."
- **Who it serves.** The organizer holding a thousand strangers' email addresses.
- **What it beats.** Every hosted SaaS in this category, structurally.
- **Asked?** **Unasked.**
- **Judge pitch.** "You are holding other people's data. Marquee sends none of it anywhere — and the log builder has no field for an email address, so it can't start."
- **Verification.** `verified-in-code` (README.md §"Marquee never phones home", `src/lib/observability/`) + `verified-live` for the telemetry endpoints being *own-deployment only* (`POST /api/v1/telemetry/client-errors`, `GET /api/v1/telemetry/diagnostics` — "deep health probe across every binding").

##### E5. A first-run guide written for an agent installer

- **What it is.** `docs/GETTING-STARTED.md` takes an empty Cloudflare account to an open CFP.
  *"Initial setup is run by an agent. You tell your coding agent to set Marquee up; `SKILL.md`
  carries the steps."* Fifteen minutes with an agent, an hour by hand. Requirements table names
  Workers Paid and says why (*"the free tier's CPU cap breaks server rendering — it fails at
  deploy, not in dev"*). **"Opening intake is always your click"** — the agent sets everything up and stops.
- **Asked?** **Unasked.** The brief asks for a repo, not for it to be runnable by a stranger.
- **Judge pitch.** "Tell your coding agent to set it up. It will ask you the three questions that are yours and stop before publishing anything to the world."
- **Verification.** `verified-in-code` (docs present on main; the deploy path itself is `claimed-in-docs-only` — nobody has re-run it from zero for this report).

##### E6. Apache-2.0 and honest seed provenance

- **What it is.** Apache-2.0 (not a source-available licence). `SEED-DATA.md` states exactly
  where every seeded row comes from: 60 sessions + 75 speakers from the **publicly published AIE
  Summit Feb 2025 program**, extended with 89 public AIE CODE Summit Nov 2025 speakers, each row
  carrying `external_ref: aie-2025:<source id>`; **everything else is explicitly labelled invented.**
- **Asked?** Open-sourcing is a **submission deliverable**; the licence choice and the provenance document are not asked for.
- **Judge pitch.** "The demo data is your own published 2025 program, and the file says which rows are yours and which we made up."
- **Verification.** `verified-in-code` (LICENSE, SEED-DATA.md) + `verified-live` (the live seed contains exactly these people: Aarush Selvan/Google Gemini, Barry Zhang/Anthropic, Aparna Dhinkaran/Arize).

---

#### F. Agent-native surface (careful: R53 asks for an API)

**R53 is explicit: "Bonus points for API."** So the API itself IS asked for. Everything below
is what was built *around* it that nobody asked for.

##### F1. A CLI with ~55 verbs
- `cli/marquee.mjs` covers setup, events (including `event create --from --copy`), forms,
  evaluation, tracks, formats, submissions (list/show/accept/reject/schedule/publish), tasks,
  files, remind, agenda (export/place/move/remove), search, people, lists, pipeline, `diagnose`,
  `logs --tail`. `--json` mode writes **exactly one JSON value** to stdout.
- **Asked?** **Unasked.** R53 asks for an API; a CLI is a second product surface.
- **Verification.** `verified-in-code` (`cli/`, `SKILL.md` command registry).

##### F2. `SKILL.md` — the product ships an agent skill
- 178 lines: authentication, the command registry, a conversational setup chapter that tells the agent *which three questions belong to the operator*.
- **Asked?** **Unasked.** (Adjacent to the Discord note that the winner may be asked to *implement a change* on demand — this is the artifact that makes that cheap.)
- **Verification.** `verified-in-code`.

##### F3. Scoped, conference-restricted API tokens
- Seven scopes (`program:read/write`, `review:write`, `speaker:write`, `agenda:write`,
  `comms:send`, `mirror:write`); a token may be restricted to specific conferences; the secret
  is **shown once**, metadata never exposes the hash, revocation takes effect on the next bearer
  request, and **effective authority never exceeds the issuer's membership**.
- **Asked?** **Unasked** — R53 asks that an API exist, not that it have a delegation model.
- **Verification.** `verified-live` — `GET /api/v1/org/tokens` answers; `Setup`/`Organizers` tags in the live OpenAPI.

##### F4. `/api/docs` — a self-contained reference, and the API's own contract discipline
- 187 operations, generated from the same route definitions the Worker serves; the page carries
  `marquee-openapi-sha256` and `marquee-openapi-operations` meta tags. One list contract
  (`page`/`per_page`/`q`/`sort` → `{data,page,per_page,total,total_pages}`), one error envelope,
  **strong `ETag`/`If-Match` optimistic concurrency on mutations**, `RateLimit-*` headers.
- **Asked?** API asked (R53); the concurrency/envelope/rate-limit discipline is not.
- **Verification.** `verified-live` — `/api/docs` 200 (58,674 bytes), `/api/openapi.json` 200, 148 paths / 187 operations, no external assets.

---

#### G. Organizer surfaces the brief never listed

*(Shorter entries. Each is genuinely unasked unless noted.)*

| # | Surface | What it is | Asked? | Verification |
|---|---|---|---|---|
| G1 | **Program board** (`/board`) | Kanban across the seven pipeline stages. Stage is **derived** (status + agenda placement), never stored — placing a session on the agenda moves its card with nobody setting a field (`STATEMAP.md` §2). | **Unasked.** R11 asks for a dashboard. | `verified-live` (`GET …/board`) |
| G2 | **Saved views + column config** (`/api/v1/events/{id}/views`) | Built-ins ("All submissions", "Drafts needing attention" — 46 live, "Decided · not notified") plus personal saved views with chosen columns and sorts. | **Unasked.** R46 implies filters must not fall over; it does not ask that they be saveable. | `verified-live` |
| G3 | **Global search** (Cmd-K) | One typed query across abstracts, sessions, people; typed results with `href` straight to the record. | **Unasked** — but it answers swyx's loudest craft complaint: *"I don't know where this form thing is"* [03:58]. | `verified-live` (`search?q=agent` returns typed rows) |
| G4 | **Files library** | Central deliverables page with `state`, versions (`version: 2`, `is_latest`), the owning task, the person, presigned media URLs — plus **`POST …/files/export`, a latest-only ZIP stream**. | **Weakly asked** — §1.6 red-arrows "Download files bundle" and notes file requests are "stored, not attached" with central download/export. Versioning is unasked. | `verified-live` |
| G5 | **Comment threads on a deliverable** | `…/files/{taskId}/comments` both sides: the organizer replies on a slide deck, the speaker sees it in the portal. | **Unasked.** | `verified-live` |
| G6 | **Content history + restore** | `audit_log` projected for humans ("Priya Raman · 12 Aug · updated title"); `POST …/content/restore` **undoes an edit as a forward-written row** — append-only, never an update or delete. Covers the speaker's own portal edits and the organizer's alike. | **Unasked.** The competitor context doc raised post-submit editing; the *history and undo* were nobody's ask. | `verified-live` (`…/content`, `…/content/restore` in live OpenAPI) |
| G7 | **Decision reversal** | `GET|POST …/reversal` — un-accept with a cascade, and a declined record gets a way back that also stops it reaching the public site. | **Unasked.** `STATEMAP.md`'s rule: "every machine draws its reversal edge, or says in writing that it has none." | `verified-live` |
| G8 | **Delivery health · "Speaker follow-ups"** (`/delivery-health`) | Not "did we decide" but **"did the message actually arrive."** Live it reports `level: "alarm"` — *"616 speakers have not heard from you. Their decision is recorded and the message has not reached them."* Plus a separate **System health** view (`?view=system`) with per-capability rows. | **Unasked.** R6 asks for outstanding *onboarding tasks*. Undelivered decisions are a different failure. | `verified-live` (real payload quoted) |
| G9 | **Not-notified summary + bulk notify** | `…/submissions/not-notified/summary` and `…/notify` — the fix for G8, one click. | **Unasked.** | `verified-live` |
| G10 | **Sessionize importer with mapping preview and UNDO** | Upload → map → preview → run → **`POST …/imports/{id}/undo`**. Also a speakers-only import path (on main). | **Weakly asked** — §1.6 red-arrows "Import Sessions". **Sessionize-specific**, plus undo, is unasked — and §6.3 says Sessionize is the tool AIE actually runs today. This is the migration path off their real incumbent. | `verified-live` (all four ops in live OpenAPI); speakers-only variant `verified-in-code (on main)` |
| G11 | **Public form drafts + a private resume link** | Autosave on the logged-out public form; a resume token; a resume link that finds nothing **says so**. | **Half-asked.** R37 asks for saved drafts. The logged-out private resume link is not in any R. | `verified-live` (`…/public/forms/{slug}/drafts`, `…/drafts/{token}`) |
| G12 | **Co-speaker confirmation** | `/co-speaker` + `…/me/participations/{id}/confirm|decline` — a co-speaker confirms or declines their own participation from an invitation link, and can edit their own profile without an account on the main record. | **Unasked.** R30 asks for *limits* on speakers per submission. | `verified-live` |
| G13 | **Speaker portal invitation, in bulk / by CSV** | `POST …/speakers/invite`, `…/committees/{id}/invites`, reviewer reminders (`…/reviewers/{personId}/remind`). | **Unasked.** R2 asks the portal exist; getting 150 people *into* it is unaddressed by the brief. | `verified-live` |
| G14 | **Pairwise comparisons in evaluation** | `…/rounds/{id}/comparisons` and `comparisons/next` — judge A against B instead of scoring in a vacuum. | **Unasked.** R4 asks for scoring; the ruled floor is approve/maybe/deny. | `verified-live` |
| G15 | **Task templates with due offsets and auto-assign** | `due_offset_days: 21`, `auto_assign: 1`, per-template `file_config` (`accept: [pdf,pptx,key]`, `maxBytes`), live counts (`assigned_count: 159`, `open_count: 129`). Seeded with exactly swyx's Discord list — "Hotel and Travel Reservations", "Presentation Upload". | **Mostly asked** (R17, R49, §1.6). Offsets/auto-assign/file constraints are the unasked depth. | `verified-live` |
| G16 | **Day / Night theme, stamped before first paint** | Palette-only themes; structure tokens theme-invariant; `prefers-color-scheme` **deliberately not consulted** — *"Marquee is demoed and judged in daylight."* Per-conference **accent color** (`accent: "#0b6a72"`) and `logo_key` on the event. | **Unasked** for the app theme; §1.6 mentions the incumbent's event-level theme/logo, so branding is weakly asked. ⚠️ `logo_key` is `null` in the live seed — the logo path is unexercised. | `verified-live` (accent in the event payload; `marquee-theme` pre-paint script in the served HTML) |
| G17 | **Three-door demo, no signup** | Landing offers "Enter as organizer / reviewer / speaker", each its own seat, plus "View public CFP". Live landing carries real counts ("Submitted 3 · In review 277 · Ready to place 2 · Onboarding 10 · Published 25") and a live sentence: *"Wave 2 closes Friday. 34 abstracts still need review in Agents. 2 accepted speakers are overdue."* | **Asked in spirit** (R25 — he resents the demo gate). The *three separate seats* and the live-count landing are the unasked execution. | `verified-live` |
| G18 | **Dead-end closing as a discipline** | `/site` redirects to `/agenda` *"because that is the address people try, including anyone reading it off our own published route list"*; `/crm`, `/directory`, `/contacts` resolve to People *"because agents guess URLs, and every 404 costs turns."* | **Unasked.** | `/crm` etc. `verified-live`; **`/site` `verified-in-code (on main, not yet deployed)` — and it will still fail after deploy, because `/site` is not in `run_worker_first` (see F2).** |
| G19 | **`docs/ROUTES.md`, generated and gate-enforced** | Because the server answers 200 on every unmatched path, "a route that does not exist looks exactly like one that does — only generation from the route sources can tell them apart." The PR gate fails when it drifts. | **Unasked.** | `verified-in-code` |

---

#### H. Things a judge may look for that we do **not** have (say these honestly)

- **`SITEMAP.md` is stale and describes a product we did not ship.** It documents **hash routes**
  (`#dashboard`, `#agenda`) — the shipped app uses real paths (`/dashboard`, `/agenda-builder`).
  It lists **`#settings/airtable`** (Airtable mirror) and **`#settings/webhooks`** — neither
  appears in `src/ui/shell/route-table.ts`, neither appears in the live OpenAPI, and the string
  "airtable" and "webhooks" appear **zero times** in the deployed client bundle. README says
  outbound webhooks are "defined in the API contract, but delivery is deferred: this checkout
  does not send webhook deliveries yet." **Do not cite SITEMAP.md in submission copy** — use
  `docs/ROUTES.md`, which is generated. Q1's Airtable bonus is not claimable.
- **`/api/v1/org/lists` and `/api/v1/org/pipeline` are empty in the live seed.** Two sidebar
  entries lead to empty states.
- The **Venues** page is not in the sidebar (utility group, reached from settings).
- The **`logo_key`** branding path is null in the seed.

---

#### I. One-paragraph summary for the submission document

Marquee answers the brief and then keeps going in four directions nobody asked about. It knows
**where** rooms physically are, so it can refuse a schedule that puts a speaker nine minutes and
one security line away from their own session — a conflict class neither Sessionize nor
Sessionboard models. It treats the **attendee** as a real seat: star sessions on the public
agenda, get a personal itinerary on a short link, subscribe to it as a calendar — no account, no
app, and an agent can build the whole thing in three calls. It knows the organizer runs **more
than one conference**, so next year's is a clone of this one with a preview of exactly what
travels. And it is genuinely **yours**: Apache-2.0, one-command self-host, ownership that lands
on a person through a claim link rather than a signup page, an instance that names what is not
configured and hands you the command, and a stated, structural promise that it sends nothing to
anyone — enforced by a log builder with no field for an email address.

*Caveat for whoever writes the final copy: of those four, the transit conflict, the copy engine,
and the attendee schedule are on `main` but **not on the deployed site** as of build `8dc17d30`.
Either deploy `main` before submitting, or write around them.*

---

## Group E — Engineering artifacts a judge can see

**Measured against:** `github/main` @ `d520c320ddb4` ("Close five dead ends an outside evaluator walked into (#99)"), 2026-08-12 14:20:21 -0400.
All file reads, counts, and command runs in this document were performed in a **fresh read-only worktree of `github/main`** at
`…/scratchpad/wt-main` (node_modules symlinked from the primary checkout; `package-lock.json` is byte-identical between the two trees, so the symlink is sound).

> ⚠️ **Do not measure from the primary checkout.** `/Users/atin/Projects/Stage11/deployments/Marquee` is parked at `13a77cb4`, **91 commits behind main**. Its `src/routes/` has 42 files; main has 62. Its `npm test` fails 2 tests that main does not have. Its `ac-coverage.json` (mtime Aug 11 23:40) reports `testFiles: 122` against a tree with 83. Every number below is from `wt-main`, not from there.

---

#### 0. The headline numbers (all verified-live unless marked)

| Fact | Number | How verified |
|---|---|---|
| Commits on `main` | **408** | `git rev-list --count github/main` |
| Elapsed build window | **3 days 22 hours 12 min** (2026-08-08 16:07 → 2026-08-12 14:20 EDT) | `git log --reverse`/`git log -1` on `github/main` |
| Merged PRs on GitHub | **104** (PR #2 – #110; 6 closed, 2+ open) | `gh pr list --state merged --limit 300` |
| GitHub merge window | **23 h 59 m** (2026-08-11T18:21:08Z → 2026-08-12T18:20:22Z) | same |
| Additional PRs merged on Forgejo pre-migration | **≥38 distinct** (max #66) | `.lattice/artifacts/meta/*.json` title/summary scan |
| **Total merged PRs across both forges** | **≈142** | 104 + 38 |
| Concurrent git worktrees on this repo | **89** | `git worktree list \| wc -l` |
| Lattice tickets | **136** (97 done · 22 PR-open · 7 backlog · 4 cancelled · 3 in-progress · 2 in-planning · 1 planned) | `.lattice/tasks/*.json` |
| Ticket types | 109 task · 24 bug · 3 spike | same |
| Lattice plan documents | **134 files, 10,207 lines** | `wc -l .lattice/plans/*.md` |
| Lattice review artifacts | **695** (104 plan-review · 85 code-review · 74 "Review findings" · …) | `.lattice/artifacts/meta/*.json` |
| Lattice event-log lines | **3,007** | `cat .lattice/events/*.jsonl \| wc -l` |
| `src/` | **251 files, 59,574 lines** TS/TSX | `find src -name '*.ts*' \| xargs wc -l` |
| `tests/` | **182 test files, 26,232 lines** | same |
| `scripts/` | 5,766 lines · `cli/` 1,613 lines | same |
| Migrations | **17** | `ls migrations` |
| **Tests: 982, 0 failures** | 807 vitest (119 files) + 175 `node:test` | `npm test` in `wt-main`, run twice |
| API operations in the OpenAPI doc | **194** (76 GET · 75 POST · 22 PATCH · 15 DELETE · 6 PUT) | `npm run check:api` output |
| Live acceptance criteria | **229** | `npm run trace:ac -- --scope=all` |
| ACs with ≥1 named test | **216 / 229 = 94.3%** | same; 425 distinct AC→test links |

**Contributors:** `git shortlog -sn github/main` → Atin 341, atin 66, Aditya Advani 1. That is one human operator (two git identities) plus one collaborator — the 408 commits and ~142 PRs were produced by an *agent fleet* running in 89 worktrees under that operator's identity. State it that way; "3 contributors" undersells and misdescribes it.

---

#### 1. The traceability chain — R → US → AC → milestone → ticket → test → code → PR

##### 1.1 Where each link lives

| Link | Artifact | Format | In public tree? |
|---|---|---|---|
| **R1–R54** requirement register | `sequence/research/competition-requirements.md` | Markdown table: `\| **R14** \| statement \| MUST \| [source + verbatim video timestamp] \|` | **No** — `sequence/research/` is on the publish denylist |
| **R → US** map | `sequence/USER_STORIES.md` §"Requirements traceability" | Table `\| R14–R15 \| Real validation… \| US-09, US-10 \|` | No |
| **US-nn → AC-nnn** | `sequence/USER_STORIES.md` | Story block + bulleted `**AC-25** …` + footer `` `[R-14, R-32, R-41]` · Source: walkthrough [05:08] `` | No |
| **AC → verification method** | `EVALUATION.md` §2 | Table `\| AC-25 \| auto \| test: raw API POSTs bypassing the client → 4xx and zero rows; e2e: … \|` | **Yes** |
| **AC → milestone → file surface** | `BUILDPLAN.md` | Table `\| M-14 \| Public CFP form \| … \| AC-25, AC-26, AC-29… \| src/routes/public-form.route.tsx \| 8h \| deps M-12, M-11, M-13 \|` | No |
| **AC → schema/route detail** | `SPEC.md` §5.4, §4.2, §5 | Prose + tables citing AC IDs inline | No |
| **AC → owning ticket** | `tests/ac-claims/MRQ-N.json` — `{ ticket, owns[], exercises[] }` | 71 manifests; `owns` is unique across all of them, enforced | **Yes** |
| **Ticket → plan/review/PR/commits** | `.lattice/tasks/*.json` + `plans/` + `artifacts/` | Full agent record | No |
| **AC → test** | Test title prefix: `test("AC-25 + AC-132 + AC-133 · …")` | AST-parsed, not regexed | **Yes** |
| **AC → coverage report** | `ac-coverage.json` (generated; gitignored) | `{ counts, errors, uncovered, coverage: {AC-n: {tag, tests[]}} }` | Generated on demand |

##### 1.2 The mechanism that makes it real, not aspirational

`scripts/checks/trace-ac.mjs` + `trace-ac-core.mjs` (the enforcement engine):

1. Parses `EVALUATION.md` for every `| AC-n | <tag> |` row → 229 live criteria, each tagged `auto` / `op-assist` / `oracle` / `felt`.
2. Walks `tests/` and parses every test file **with the TypeScript AST** (`typescript-ast`), not a regex. There is a specific comment in the source about why: reading the *property* of a property-access made `/pattern/.test(x)` look like a test declaration; it reads the **root** identifier instead.
3. Every `test()`/`it()` title must match `^((AC-\d+([,+]AC-\d+)*)|CONTRACT)\s·\s` — a dynamic title or any other prefix is a hard error.
4. Cross-checks `tests/ac-claims/*.json`: `owns` must be unique across all 71 manifests (duplicate-owner is an error), and every claimed ID must exist.
5. `AC-239` is **struck** — naming it in a test is an error. This is the anti-gaming rule: you cannot invent coverage for a retired criterion.
6. Two scopes: `--scope=merged` (the PR gate — enforces only ACs owned by already-merged tickets plus the current PR's) and `--scope=all` (terminal audit — every live `auto` AC must have a test).

**Judge-facing pitch:** *Every one of 982 tests names the acceptance criterion it proves, in its title, checked by an AST parser at the merge gate — so the coverage table is machinery, not a promise.*
**Status: verified-live.** Ran `--scope=all` and `--scope=merged` on main; both parse cleanly, **0 title errors across 982 tests**.

##### 1.3 THE WORKED TRACE — R14 to the line of code (verified end to end)

This is the money artifact. Every step below was opened and read on `github/main`.

| # | Link | Exact location | Content |
|---|---|---|---|
| 1 | **The buyer's complaint** | `sequence/research/competition-requirements.md:82` | `**R14** — Real, enforced field validation — Sessionboard's is incomplete and he noticed. MUST.` Source: walkthrough **[05:08]** — *"and looks like it doesn't even have full validation. Very nice."* (sarcastic) |
| 2 | **R → US** | `sequence/USER_STORIES.md:828` | `\| R14–R15 \| Real validation, sane speaker minimums \| US-09, US-10 \|` |
| 3 | **The story** | `sequence/USER_STORIES.md:134-140` | **US-09 · Set real, enforced validation per field.** *"As a program lead, I want validation rules that actually fire, so that I don't receive garbage and submitters aren't surprised at the end of a long form."* Footer: `` `[R-14, R-32, R-41]` · Source: walkthrough [05:08] `` |
| 4 | **The criterion** | `sequence/USER_STORIES.md:138` | **AC-25** — *"Validation fires client-side on blur **and** is enforced server-side on submit; a crafted request bypassing the client cannot persist an invalid record."* |
| 5 | **How it must be proven** | `EVALUATION.md:190` | `\| AC-25 \| auto \| test: raw API POSTs bypassing the client for each rule → 4xx and **zero rows written**; e2e: blur fires client-side. e2e: inject a 5xx and a 429 on submit; assert the inline failure banner renders above the submit row, **every entered value is preserved**, retry is offered, and the draft-saved statement is present. \|` |
| 6 | **Design contract** | `SPEC.md:443` | *"Validation fires client-side on blur and server-side on submit… no field names, no type names, no error codes, no bare 'invalid'."* Ships exact strings: *"Use at least 8 characters so reviewers can identify your session."* |
| 7 | **Schema + endpoint** | `SPEC.md:170`, `SPEC.md:366` | `required INTEGER — client + server validation (AC-25, AC-41)`; `POST /api/v1/public/forms/:slug/submissions — Turnstile; server-side validation is authoritative (AC-25); 4xx + zero rows on violation` |
| 8 | **Build milestone** | `BUILDPLAN.md:74` | **M-14 · Public CFP form** — scope, `ACs: AC-25, AC-26, AC-29, AC-30–AC-42, AC-155–AC-157, AC-231, AC-234`, file surface `src/routes/public-form.route.tsx`, 8h, deps M-12/M-11/M-13 |
| 9 | **The ticket** | `lattice show MRQ-15` (`task_01KZJHM8RK9NXFJJ4V6387HCN6`) | Status `done`, assigned `agent:delegator-mrq-15`, created by `agent:orchestrator-intake`. Carries the BUILDPLAN scope **verbatim**, 3 `depends_on` edges, 3 incoming edges, and a plan file |
| 10 | **The ticket's evidence** | same | 7 artifacts: `plan-review`, **2 self-reviews at named SHAs** (`a519f44f…`, `df7d6438…`), 2 validation artifacts at those same SHAs, `Forgejo PR #33`, `Review findings`. Plus 5 board commits |
| 11 | **The AC claim** | `tests/ac-claims/MRQ-15.json` | `{"ticket":"MRQ-15","owns":["AC-25","AC-26","AC-34"…"AC-42"],"exercises":["AC-29"…"AC-157"]}` — MRQ-15 **owns** AC-25; `trace:ac` rejects a second manifest claiming it |
| 12 | **The tests** | `ac-coverage.json` → AC-25 has **9** test references | `tests/integration/api/public-form.AC-25-42-155-157-231-234.test.ts:207` · `tests/integration/api/submission-applicability.MRQ-69.test.ts:68,112` · `tests/unit/bound-options.MRQ-126.test.ts:68,81,89,105` · `tests/integration/api/bound-form-options.MRQ-126.test.ts:64,116` |
| 13 | **One test, read** | `public-form.AC-25-42-155-157-231-234.test.ts:207` | `test("AC-25 + AC-132 + AC-133 · submit projects hidden conditional answers out before database persistence", …)` — POSTs `vendor_product: "secret value that must never land"` with the vendor conditional off, asserts 201 and that the value is absent from persisted answers |
| 14 | **The code** | `src/lib/form-conditions.ts:207` `validateField()` | Per-type + per-rule server validation: required, text/email/URL/number/date/select/file type checks, min/max length, numeric range |
| 15 | **The composition** | `src/lib/form-conditions.ts:281` `projectApplicableAnswers()` | Doc comment: *"Project a raw answer map onto the currently visible fields and validate it. Unknown keys and values for hidden fields are intentionally omitted. **A caller must persist only `answers` from this result.**"* |
| 16 | **The call site** | `src/routes/public-form.shared.ts:348` | `const projected = projectApplicableAnswers(fields, rawAnswers);` |
| 17 | **The 4xx** | `src/routes/public-form.routes.ts:628-638` | `...projected.issues` collected → `throw ApiError.unprocessable("Add the requested details, then choose Submit again.", undefined, { issues: domainIssues })` |
| 18 | **The route in the schema** | `src/routes/public-form.routes.ts:859` | `path: "/api/v1/public/forms/{slug}/submissions"` — one of the 194 operations `check:api` verifies |
| 19 | **The PR** | Lattice artifact `art_01KZQMMT38E3SJ50GV715HRTMV` → **Forgejo PR #33**; code landed as commit `2895e76f` ("MRQ-15 / M-14: public CFP form — first production consumer of the shared condition projector"), confirmed ancestor of `github/main` | ⚠️ **This PR is on the retired Forgejo instance and is NOT viewable by a judge.** The commit is in GitHub history; the PR conversation is not |

**Judge-facing pitch:** *A sarcastic aside at 05:08 in swyx's video is requirement R14, story US-09, criterion AC-25, milestone M-14, ticket MRQ-15, claim manifest, nine tests, and a `throw ApiError.unprocessable` at `public-form.routes.ts:638` — and the merge gate fails if any link in that chain is cut.*
**Status: verified-in-code end-to-end**, with the single caveat on step 19.

##### 1.4 Adversarial notes on traceability

- **Trace direction is asymmetric.** AC → test is machine-enforced. R → US and US → AC are **hand-maintained markdown tables** with no checker. A judge can follow them, but nothing stops them drifting.
- **The two ends of the chain are not in the public tree.** `sequence/` and `.lattice/` are on the publish denylist (`scripts/checks/repo-policy.mjs`), so a judge cloning the public artifact sees `EVALUATION.md` + `tests/ac-claims/` + test titles, but **not** the R-register, the user stories, `SPEC.md`, or `BUILDPLAN.md`. The full chain is demonstrable only in a private walkthrough or a curated writeup.
- `EVALUATION.md`'s prose header says "207 live criteria"; `USER_STORIES.md` says 249; the parser finds **229**. These count different scopes (build scope vs allocated vs live-in-EVALUATION). **Cite 229 and say it is the parser's number**, or you will be caught out.

---

#### 2. `scripts/checks/` — the gate

24 files. Every script emits a machine-readable JSON report and sets a non-zero exit code on failure.

##### 2.1 What is in `npm run pr-gate` (11 checks, in order)

`pr-gate.mjs` requires `--ticket MRQ-N` (regex-validated) — you cannot run the gate anonymously.

| # | Check | What it enforces | Status |
|---|---|---|---|
| 1–3 | `tsc --noEmit` ×3 | Three separate TS projects: worker (`tsconfig.json`), client (`tsconfig.client.json`), tests (`tsconfig.test.json`) | verified-in-code |
| 4 | `vite build` | Production Worker bundle actually builds | verified-in-code |
| 5 | `check:shell-truth` | **The seeded conference's name (`AIE NYC 2026`) and id (`evt_aie-ny-2026`) may not appear anywhere in `src/`, `scripts/`, `cli/`** except seed and fixture files. Rationale in-source: a page defaulting to the seeded conference id renders conference A's data while the organizer stands in conference B — worse than rendering nothing | **verified-live** (311 files scanned, 0 matches) |
| 6 | `check:design` | See §3 | **verified-live** (pass, 0 findings) |
| 7 | `check:api` | See §4 | **verified-live** (pass, 194 ops) |
| 8 | `check:routes` | See §5 | **verified-live** (pass, 40 SPA + 11 server) |
| 9 | `check:clocks` | See §6 | **verified-live** (pass, 0 findings) |
| 10 | `npm test` | 982-test hermetic suite | **verified-live** (982 pass, 0 fail) |
| 11 | `trace:ac --scope=merged --ticket=MRQ-N` | AC coverage for merged scope | **verified-live** (0 uncovered, 0 errors) |

##### 2.2 What is NOT in the gate (say this out loud)

- `check:speed` — needs deployed infra + the 1,000-row seed. Not gated.
- `check:seed` — needs local wrangler runtime. Not gated.
- `check:repo` — the secret/denylist/history scan. **Deliberately** not gated: it requires explicit `--repo` and `--ref` publish targets and refuses to run against the internal working history. It gates the *publish*, not the PR.
- `check:r2-cors` — runs only inside `e2e` when `MARQUEE_E2E_URL` is set.
- `e2e` — see §7. **Not built.**
- `test:changed` — explicitly documented as "a pre-push convenience, never a merge gate."

##### 2.3 Stub discipline — the honesty mechanism (this is a *feature*, cite it)

Six commands are registered but unimplemented: `check:readme` (MRQ-57), `check:mirror` (MRQ-25/26), `smoke:mail` (MRQ-24), `smoke:ics` (MRQ-24), `check:skill-agent` (MRQ-44), and `e2e` (MRQ-50, conditional). Each stub:

- writes `{"status":"stub", "owner":"MRQ-N", "missing":"<reason>", "replacement":"<how to fill it>"}` to `artifacts/checks/`,
- exits **zero** in ordinary development,
- but exits **2** when `MARQUEE_GATE=1`, so a terminal gate can never confuse *registration* with *proof*.

`scripts/checks/README.md`: *"Stubs never contact a service or imply that a missing capability passed."* And: *"These thirteen package-script names are immutable… Later owners replace the file behind a stub; they do not rename or re-register its package script."*

**Judge-facing pitch:** *Unbuilt checks are registered as stubs that name their owning ticket and refuse to pass under `MARQUEE_GATE=1` — the harness cannot lie about what it has proven.*
**Status: verified-in-code** (read `runStub` in `scripts/checks/lib/command.mjs:114-132`).

##### 2.4 CI (`.github/workflows/ci.yml`)

Runs on every PR and every push to `main`. 10 steps: `npm ci` → 3 typechecks → `vite build` → `check:design` → `check:clocks` → `npm test` (5-min step timeout) → `trace:ac --scope=merged`. Job timeout 15 min with a source comment explaining it is a **hang detector, not a speed gate**, because the runner is smaller than a dev machine.

Recent history: **53 success / 6 failure of the last 60 runs**; the last 15 runs on `main` are all `success`.
**Status: verified-live** (`gh run list`).

##### 2.5 `.github/CODEOWNERS`

`* @BenevolentFutures` — every path owned by one account, paired with a "main: manual merge gate" ruleset requiring code-owner review. The file explains itself: *"no pull request can merge on approvals alone."*
**Status: verified-in-code** (the ruleset itself was not independently verified via the API).

---

#### 3. The design-contract verifier — `scripts/checks/verify-design-contract.mjs`

**What it is.** A gate that proves the built product still matches the client-approved prototype.

**What it enforces (all five, verified by reading the source):**
1. **Byte-equality of the design token block.** Lifts the `:root { … }` block out of `prototypes/skins/skin-c.html`'s `TOKEN BLOCK` comment and requires it to be *string-identical* to the first `:root` block in `src/styles/tokens.css`. Not "similar" — identical.
2. **Four hard geometry contracts** in `src/styles/components.css`: desktop sidebar `224px`, topbar `52px`, compact sidebar `68px` at `max-width:1000px`, mobile rail `54px` at `max-width:760px`.
3. **19 exact sidebar labels** must exist in `src/ui/shell/route-table.ts` (`"Program home"`, `"Ready to place"`, `"System health"`, …) — the product's vocabulary is gated.
4. **No `PROTOTYPE` marker** may survive in `app.tsx`, `AppShell.tsx`, `Sidebar.tsx`, `Topbar.tsx`.
5. **Theme integrity, two rules:** (a) *zero* hardcoded colors in `src/styles/components.css` — every `#hex` or `rgb(a)` on a non-comment line is a finding, with line number and the offending text; (b) every color token Day introduces must be redefined in the `html[data-theme="night"]` block, or a Night screen silently inherits a Day value.

**Why it exists (from the source comment):** *"A hardcoded color is invisible to the theme system: it looks correct in Day and is simply wrong in Night, with nothing to catch it but a human's eye on the one screen that happens to use it."* Scope is deliberately the admin shell only — public site and embeds own their own palettes because *"an embed inherits its host page's palette."*

**Who it serves:** the designer (the approved skin cannot rot), the next contributor (you cannot accidentally ship an off-palette color), the judge (the product you see is the design that was signed off).
**What it beats:** every SaaS where the Figma and the build diverged in month two. Design systems are normally enforced by code review; here it is a merge gate.
**Judge-facing pitch:** *The merge gate diffs the shipped CSS variables against the client-approved prototype file and fails on a single hardcoded hex.*
**Status: verified-live** — ran it on main: `{"command":"check:design","status":"pass","findings":[]}`.

---

#### 4. The API contract gate — `scripts/checks/check-api.mjs`

**What it is.** Single-source API parity. Builds the real Worker bundle, imports it in-process, and fetches `/api/openapi.json` and `/api/docs` **from the actual Hono app** — not from a checked-in artifact.

**What it enforces:** the OpenAPI document validates (via `@scalar/openapi-parser`, 3.1); the docs route is reachable; served JSON, rendered docs, and the **CLI registry** derive from one route registry with matching operation counts and content hashes; every path lives under `/api/v1` except a named 3-URL allowlist (`/i/{uid}.ics`, `/agenda.json`, `/api/v1/public/agenda.ics` — calendar clients and feed readers that cannot follow a versioned prefix) plus 2 meta paths.

**Live result on main:** `status: pass`, **194 operations**, OpenAPI 3.1, `documentSha256: 1dbf49b4a73d…`, `halves: {servedJsonAndRenderedDocs: "live", cliRegistry: "checked"}`, 0 findings.

The report *also* names its own gap, which is unusually honest: `"notCoveredHere": "Full-loop network-recorded traffic parity (every captured non-GET request present in the schema) is MRQ-9."`

**Judge-facing pitch:** *194 API operations, and the gate proves the docs, the served schema, and the CLI's command registry are all generated from one route table — by booting the real Worker, not by trusting a committed file.*
**Status: verified-live.**

---

#### 5. The route-manifest gate — `scripts/checks/check-routes.mjs`

**What it is.** `docs/ROUTES.md` is **generated** from three sources and the PR gate fails on drift. `--write` regenerates it.

**Why it exists** — this is the best comment in the repo:

> `src/index.ts` ends in `app.all("*", … ASSETS.fetch(…))`, so every unmatched path answers HTTP 200 with the SPA shell. `/site`, `/settings/webhooks`, and `/comms` all looked alive to a probe while being nothing at all, and the hand-written route list that named them shipped twice. **Nothing that reads a response can catch that class of lie; only generation from the route sources can.**

**Its three sources:** (1) `src/ui/shell/route-table.ts`, imported directly as TypeScript (Node ≥22.18 strips types); (2) `src/ui/app.tsx`'s `isPublicPage` predicate, **parsed back out of the source and rebuilt as a function** — with a guard that *throws* if the parsed clause count ≠ the `||` count, because "a silent parse failure would emit a confidently wrong public/organizer split — exactly the failure this command exists to stop"; (3) `src/routes/*.route.tsx` server-rendered pages.

**Live result:** `pass`, **40 SPA routes + 11 server pages = 51 real paths**.
**Judge-facing pitch:** *On Workers every wrong URL returns 200, so a route list you can read is a route list that can lie — ours is generated from the route table, the public-path predicate, and the server page modules, and the merge gate fails when it drifts.*
**Status: verified-live.**

---

#### 6. The fixture-clock gate — `scripts/checks/check-clocks.mjs` (180 lines, mostly rationale)

**What it is.** Two static-analysis rules over the test suite, written after a specific incident.

**Rule 1 — no calendar-pinned deadline on a time-compared column.** A fixture with `const NOW = Date.UTC(2026, 7, 11, 15)` and `expires_at: NOW + 86_400_000` reads as "expires tomorrow" — and stops being true when the wall clock passes it. From the source: *"On 2026-08-12T15:00:00Z the portal suite went red with no diff behind it… A sweep then found twelve more suites armed the same way — eleven of them minting `auth_sessions` rows whose `expires_at` was an offset from the fixture anchor, which turn the whole file into 401s on a date nobody wrote down."* Scoped to files that actually persist fixtures (`env.DB.prepare|batch`), because an injected clock cannot drift.

**Rule 2 — no burst-spent rate limits.** Issuing `limit+1` requests races the limiter's window boundary; once a request takes longer than the window is wide (ordinary when several agents share a machine) the limiter becomes *untestable*, not flaky. Fix: seed the counter to its limit and send one request.

**Escape hatch:** `// clock-check: allow — <why this one is actually safe>`. A reason is **required**; the marker is for cases the rule cannot see, not for silencing it.

**Judge-facing pitch:** *A test that passes today and fails on an arbitrary future Tuesday is a time bomb; a static check bans the pattern and makes you write down why any exception is safe.*
**Status: verified-live** (`pass`, 0 findings). Landed as PR #109 — it does **not** exist in the stale primary checkout.

---

#### 7. The test suite

##### 7.1 Real, measured numbers on `github/main` @ `d520c320`

Ran `npm test` **twice** in `wt-main`:

| Run | Vitest | node:test | Total | Wall | Machine load (16 cores) |
|---|---|---|---|---|---|
| 1 | 119 files, **807 pass / 0 fail** | **175 pass / 0 fail** | **982 / 0** | **62.5 s** | load avg **38.5** |
| 2 | 119 files, **807 pass / 0 fail** | **175 pass / 0 fail** | **982 / 0** | **93.3 s** | load avg **58.3** |

Static count of declared `test()`/`it()` calls across all 182 test files: **982** — an exact match, i.e. nothing is skipped.

##### 7.2 The two budgets, and why they are two

`scripts/checks/run-test.mjs` carries an 18-line comment separating them:

- **`BUDGET_MS = 45_000`** — an **objective**, not a verdict. Exceeding it prints `[test] OVER BUDGET: …ms against a 45000ms objective. Tests passed; the suite is slow.` and emits `status: "pass-over-budget"`. It never fails. Reason given: *"Wall time on a hermetic parallel suite is dominated by how many cores it can actually get, and this repo is worked by several agents at once… A number that means 'fast enough here' cannot also mean 'correct.'"*
- **`HARD_LIMIT_MS = 600_000`** — a **hang detector**, which does fail: *"a killed suite has unknown results, and unknown is not passing."* It was raised from 240s with a written rationale: two PRs tripped it in one evening with zero failing tests, and a tripped detector reports "timeout" — indistinguishable from a wedge — *"so both were re-run rather than read. A detector that fires on the healthy case teaches people to re-run instead of look, which is the one thing it must never do."*

`pr-gate.mjs` mirrors this: `PR_GATE_BUDGET_MS = 120_000`, warn-only, with a matching comment. Both write every observation to `speed-report.json` under a `harness` key with a rolling `history` array stamped with commit SHA and timestamp.

**Adversarial:** the suite **is over its declared objective** — 62s and 93s against 45s. Do **not** claim "45-second suite." The honest claim is: *982 tests, hermetic and parallel, with a declared 45s objective; measured at 62s and 93s on a 16-core machine carrying load averages of 38 and 58 from a concurrent agent fleet.* The harness itself reports this as `pass-over-budget` and prints the warning — the transparency is the story, not the number.

##### 7.3 Suite design

- **Hermetic.** Local D1 via `@cloudflare/vitest-pool-workers`/Miniflare, stubbed Resend (writes to an outbox table), stubbed R2. Outbound `fetch` is denied. Small deterministic fixtures, never the 1,000-row seed, never a deployed URL.
- **Two runners, one scheduler.** A single `vitest run` covers both projects (`vitest.worker.config.ts` + `vitest.node.config.ts` declared in `vitest.config.ts`) — a fix for two runs each sizing their own worker pool to the whole machine, so *"the suite competed with itself for cores before any other agent's build entered the picture."* Then `node --test` over `tests/node/**/*.test.mjs`.
- **`tests/node/` is load-bearing, not belt-and-braces.** Most `.tsx` coverage lives there as **source-text contracts** — they `readFileSync` a component and assert on what is in it, pinning copy and preventing silent reverts.
- **`npm run test:changed`** — inner-loop runner using vitest `--changed` from the **merge-base** with `github/main` (not the tip: *"the merge-base is the question actually being asked: what did I change?"*), plus the node checks unconditionally, because text-reading tests leave no import edge and `--changed` would correctly select *zero* suites for a component edit.

**Judge-facing pitch:** *982 hermetic tests, no network, no deployed dependency — and the harness distinguishes a slow machine from a broken change, because a red that doesn't mean "broken" teaches a team to re-run instead of read.*
**Status: verified-live.**

##### 7.4 ⚠️ E2E DOES NOT EXIST — the biggest honesty gap in this slice

- `tests/e2e/` — **no such directory.**
- `find tests -name '*.spec.ts'` — **zero results.**
- `scripts/checks/run-e2e.mjs` reads `tests/e2e`, finds no specs, and calls `runStub({command:"e2e", owner:"MRQ-50", reason:"the deployed 11-step Playwright loop has not landed"})`.
- `playwright.config.ts` is real and well-formed (desktop 1440×900 + mobile iPhone-13 375×812, 4 workers, `retries: 1`, `trace: "retain-on-failure"`, `forbidOnly: true`, 6-min global timeout) — but it points at an empty directory.

`EVALUATION.md` describes `npm run e2e` as driving the full 11-step loop against a deployed preview. **That suite is not built.** Every `e2e:` verification note in the EVALUATION AC table (including AC-25's) is currently unexecuted. Anything claiming end-to-end browser coverage is **claimed-in-docs-only**. Note the mitigation is real though: the stub exits 2 under `MARQUEE_GATE=1`, so the harness will not let a terminal gate pass while pretending e2e ran.

---

#### 8. `ac-coverage.json`

**What it is.** The generated output of `npm run trace:ac`. **Gitignored** (`.gitignore` lists it alongside `speed-report.json`), so it is an on-demand artifact, not a committed claim. That is the right design — but it means the file sitting in anyone's checkout is meaningless.

**Adversarial:** the copy in the primary checkout has **mtime Aug 11 23:40** and reports `{live: 216, testFiles: 122, claims: 57, uncovered: 0, errors: 2}` — stale by a day and two errors red. **Never cite that file.** Regenerate before quoting.

**Honest numbers, regenerated on `github/main`:**

```
--scope=all     → status: fail   live: 229  testFiles: 182  claims: 71  uncovered: 10  errors: 0
--scope=merged  → status: pass   live: 229  testFiles: 182  claims: 71  uncovered:  0  errors: 0
```

Derived from the `coverage` map:
- **216 of 229 live ACs (94.3%)** have at least one test naming them.
- **425** distinct AC→test links. Distribution: 13 ACs with 0 tests, 113 with 1, 62 with 2, 16 with 3, 7 with 4, 9 with 5, 9 with 6+.
- By tag: `auto` **209/219** · `oracle` 4/5 · `felt` 3/4 · `op-assist` 0/1.
- **0 errors** — every one of 982 test titles is well-formed, every claimed AC exists, no duplicate owners, no reference to struck AC-239.

**The 10 uncovered `auto` ACs, named:** AC-22, AC-167, AC-168, AC-169, AC-225, AC-226, AC-227, AC-228, AC-229, AC-241.
**AC-225–229 are the Airtable two-way mirror** — whose tickets (MRQ-26, MRQ-27, MRQ-46, MRQ-54) are all `cancelled` on the board and whose check is a declared stub. That is a *decided* cut, not a hole; say so explicitly rather than letting a judge find it.

**Is 94.3% honest?** Yes, with three qualifiers a judge could raise: (1) coverage is by *test title assertion*, not by execution instrumentation — a test can name an AC and assert weakly; (2) the denominator (229) is what the parser finds in `EVALUATION.md`, and the prose in that same file quotes 207 and 249 for different scopes; (3) the PR gate runs `--scope=merged` (which passes), not `--scope=all` (which fails on those 10). The `--scope=all` failure is by design — `EVALUATION.md` says `--scope=all` is "the gate, CP-2 onward."

**Judge-facing pitch:** *216 of 229 acceptance criteria carry at least one test that names them by ID — 94.3%, generated on demand, with the 10 gaps enumerated by name and 9 of them belonging to a feature we cancelled on the record.*
**Status: verified-live.**

---

#### 9. `STATEMAP.md` and `SITEMAP.md` — the weak link (verified adversarially)

Both last touched by commit `29fcb42` on **2026-08-10 23:57** — **259 commits behind HEAD, 115 of which touched `src/`.** Wall-clock that's ~1.6 days, which on a repo moving ~160 commits/day is materially stale.

##### `SITEMAP.md` — **DO NOT CITE**

Hand-maintained, ungated. Its own header says *"Routes are the hash routes the prototype ships… the built app serves the same paths per SPEC.md §5"* — the second clause is **false**; the build serves real pathnames (`src/ui/app.tsx:24-33` branches on `window.location.pathname`).

- **27 routes in the doc vs 51 real paths in the build. 29 real routes missing.**
- **6 documented routes have no implementation:** `#evaluation/ai`, `#settings/airtable`, `#settings/webhooks`, `#comms`, `#cfp`, `#publicAgenda`.
- **2 are wrong, not merely missing:** `#agenda` is labeled "Agenda builder" but `/agenda` is the **public conference site** (`route-table.ts:63`); the builder is `/agenda-builder`. And `SITEMAP.md:255` claims *"Append `?empty=1` to any route to enter the fresh-install walk"* — `grep -rn "empty=1" src/ cli/ tests/` returns **0 hits**.
- Its §2 lists 8 sidebar modules; the code has 13. It omits the entire org-level tier (People / Lists / Sourcing pipeline).
- Brutal detail: `check-routes.mjs`'s own rationale comment names `/site`, `/settings/webhooks`, and `/comms` as the routes that "looked alive to a probe while being nothing at all" — **and `SITEMAP.md:240` and `:246` still list `#comms` and `#settings/webhooks`.** The doc that the generated route map was built to replace was never deleted.

**Recommendation: cite `docs/ROUTES.md` instead** — generated, gated, current. Treat `SITEMAP.md` as debt to delete.

##### `STATEMAP.md` — citable with one deletion and three amendments

12 lifecycle state machines as Mermaid diagrams, with a stored-vs-derived annotation per machine. Hand-maintained; **no generator, no check** (`grep -rln "STATEMAP"` across all `.mjs/.ts/.js/.json/.yml` → zero hits; it is not in `pr-gate.mjs`).

**14 entries were verified against `src/` and `migrations/`; 13 confirmed exactly**, including:
- §1 `submissions.status` is exactly 7 values — `migrations/0001_init.sql:333-339` CHECK constraint, mirrored `src/db/schema.ts:64`.
- §1 "`waitlisted` displays as Maybe" — `src/ui/submissions/SubmissionsPage.tsx:74`.
- §2 pipeline stage is **derived, no `stage` column** — `src/api/board.ts:149-158` is a pure `CASE`; no `stage` column exists in any migration.
- §6 "Cancelled is stored as `speaker_tasks.cancelled_at` — a nullable timestamp, **not** a `status` value" (AC-264) — `migrations/0004_calendar_reversal.sql:4`, and `0001_init.sql:608` keeps `status` at exactly `('open','done')`. This kind of precision is the reason the doc is worth citing at all.
- §7c four unnotified states derived not stored — `src/api/submissions.ts:56-60`, derived in SQL at `submissions.queries.ts:328`, saved view `"Decided · not notified"` at `src/lib/saved-views.ts:71`.
- §8 five agenda views, no Month — `src/api/agenda.ts:3`.

**But:**
- **§10 "Airtable mirror" documents a machine that does not exist.** The repo says so itself: `package.json:25` declares `check:mirror` a stub because *"Airtable mirror and dedicated test base are not implemented."* Only a `mirror_outbox` table with no writer and no consumer exists. Its drawn `Syncing`/`Conflict` states have no code. **Delete this section before publishing.**
- **Three under-enumerations:** §2 says 7 board stages, code has **8** (`declined`, `src/api/board.ts:14-22,158`); §4 draws 4 public-form states, code resolves **5** (`submitted`, `public-form.shared.ts:228-233`); §6 covers 3 task states, code has **6** (`risk`, `upcoming`, `unassigned` undocumented, `onboarding.queries.ts:12`).
- **Undocumented machines:** the whole sourcing pipeline (`src/lib/person-annotations.ts:18-25`, 6 stages), co-speaker `pending → confirmed|declined`, attachment `pending → ready`, webhook `queued → delivered|failed`, instance claim/handoff.

**Judge-facing pitch (safe version):** *`STATEMAP.md` documents twelve lifecycle state machines and, for each, whether the state is stored or derived — including the deliberate decision that "cancelled" is a nullable timestamp rather than a status value.* Do not claim it is complete or current.
**Status: verified-in-code, partially stale.**

---

#### 10. The publish machinery — `assemble-public.mjs` + `check-repo.mjs` + `repo-policy.mjs`

**What it is.** The competition requires a public repo; the working repo contains the competitive research, the agent board, and the operator's filesystem paths. This is a three-part machine for producing a clean public artifact.

- **`repo-policy.mjs`** — the denylist, as data. Denied *paths*: `.lattice/`, `sequence/research/`, `sources/`, `*.pdf`, `competitor-*`, `AGENT-BRIEF-*`, `run-state*`, `Atin/`. Denied *content*: `/Users/`, `Stage 11`, the internal Forgejo hostname, tailnet identifiers, `Lattice`/`delegator`/`orchestrator` vocabulary, `C11_*`, `surface:N`, `workspace:N`, and any real email address (with an `example|invalid|test` carve-out). **The file builds its own denied strings by concatenation** (`joinParts("lat","tice")`) so the policy file does not itself trip the scan it defines — a nice touch.
- **`assemble-public.mjs`** — copies an **allowlist**, never a denylist-of-a-copy: 8 root directories (`.github`, `cli`, `fixtures`, `migrations`, `public`, `scripts`, `src`, `tests`), 21 named root files, and exactly 2 prototype files. Comment: *"New private top-level material does not become publishable merely because it lives beside the application."* Relocates the seed fixture, scrubs metadata, and can write a **parentless commit** into the local object DB without moving a branch.
- **`check-repo.mjs`** — requires explicit `--repo` and `--ref` (it refuses to be pointed at the working history), then walks **the full commit path history and full patch history**, not just the tip, plus `gitleaks`, PROTOTYPE-badge absence in `src/`, a README lint (numbered deploy sequence present; the words "registration", "Airtable", "calendar OAuth" present as named extension points), and LICENSE presence. `gitleaks` being *unavailable* is itself a finding — it cannot silently no-op.

**Judge-facing pitch:** *The public repo is assembled from an allowlist into a parentless commit, and a scanner walks its entire patch history — not just its tip — for secrets, internal paths, and third-party content, because a redistributed brief cannot be un-pushed.*
**Status: verified-in-code** (I did not execute the assembly, which writes git objects).

##### ⚠️ Adversarial: the public artifact is stale and not yet published

- Orphan branch `github/mrq-42-assembly` tip `f4240644` — **2026-08-11 05:52**, i.e. **167 commits of `main` ago**.
- It holds **343 files**; `main` holds 2,157.
- Its `tests/` has **114 files**; `main` has 182.
- It has **no `docs/`** — because `docs/` is *not on the allowlist*. So `docs/ROUTES.md`, `docs/GETTING-STARTED.md`, and `docs/OBSERVABILITY.md` are **absent from the public artifact** as currently configured.
- `SPEC.md`, `BUILDPLAN.md`, `DEPLOY.md`, `STATEMAP.md`, `SITEMAP.md`, `CLAUDE.md`/`AGENTS.md` are also **not** on the allowlist.
- `gh repo list Stage-11-Agentics` shows `marquee` as **PRIVATE**; there is no public Marquee repo yet.

**Consequence for this whole document:** most of the engineering evidence above is currently invisible to a judge. Before any of these claims go public, the assembly must be re-run at a current ref and the allowlist extended (at minimum: `docs/`, `EVALUATION.md` is already in, and a decision on `SPEC.md`/`BUILDPLAN.md`). A live worktree named `fix-public-assembly-repoint` exists, so this is known work in flight.

---

#### 11. The Lattice board as a build record

Not in the public tree, but it is the best evidence that this was *built*, not vibed, and it can be shown in a private walkthrough or screenshotted.

- **136 tickets** with dependency edges (`depends_on` both directions), priorities, types (109 task / 24 bug / 3 spike), and named agent assignees (`agent:delegator-mrq-15`, `agent:auditor-mrq-43`, `agent:orchestrator-intake`).
- **134 plan documents, 10,207 lines** — one per ticket, written by the delegator before implementation.
- **695 artifacts:** 104 `plan-review`, 85 `code-review`, 74 "Review findings", plus per-ticket self-reviews and validations **stamped with the exact commit SHA they reviewed** (`"MRQ-15 self-review @ a519f44f84cb47c0c44f5400a7ad9854a9690409"`).
- **3,007 event-log lines** across 137 event files — the append-only history of every status transition.
- Tickets carry **`needs human` flags** with specific asks (MRQ-55: *"Inspect the delivered Gmail triplet for RSVP/update/cancel behavior, and provide Outlook plus Apple-backed inbox addresses"*), and record **resets** (MRQ-15: *"Previously completed, reset on 2026-08-11"*) — the board records being wrong, not just being right.
- Ticket titles read as product prose, not Jira: *"Pipeline stage counts disagree across four surfaces — one derivation, one vocabulary"*, *"Reset demo is broken end to end — dead button, minimal-fixture restore, cross-tenant wipe, R2 orphans"*, *"Sign in — the door the product promises and has never had, and a 401 that leads to it"*.

**Judge-facing pitch:** *136 tickets, 134 written plans, 104 plan reviews and 85 code reviews — every one stamped with the commit SHA it examined. The build has a paper trail.*
**Status: verified-live** (`lattice list`, `lattice show MRQ-15`, direct reads of `.lattice/`).
**Caveat:** ⚠️ 22 tickets sit at `pr_open` and 5 are in-flight; the board is a live construction site, not a finished ledger.

---

#### 12. The doc layer a new contributor lands in

| File | Lines | What it is | Public? | Note |
|---|---|---|---|---|
| `README.md` | 399 | Product + architecture + numbered self-host recipes + extension points. Opens with *"Marquee never phones home"* | **Yes** | Linted by `check:repo` for the numbered deploy sequence and the three named extension points |
| `docs/GETTING-STARTED.md` | 226 | First-run organizer guide: empty Cloudflare account → open CFP. Explicitly: *"Initial setup is run by an agent… `SKILL.md` carries the steps"*; *"Ownership lands on a person"* via a one-time claim link; *"There is no password, ever"* | **No** (docs/ not on allowlist) | |
| `docs/OBSERVABILITY.md` | 171 | What is logged, what never is. *"A speaker's email address cannot be logged, because the log builder has no field for it. Not 'is redacted' — has no field for it."* *"Nothing is sent to a third party. Ever."* | **No** | Strongest privacy artifact in the repo and it's not in the public tree |
| `docs/ROUTES.md` | 99 | **Generated + gated** route map, 40 SPA + 11 server | **No** | Should be |
| `DESIGN.md` | 50 | Binding design language; names the prototype file and version (`prototypes/pipeline-v1.1/index.html` @ v1.11) and records that three UX paradigms and three skins were built and chosen between | **Yes** | The `check:design` gate enforces it |
| `PHILOSOPHY.md` | 54 | Six principles. *"Speed is respect."* *"A slow screen is a defect, not a cost."* | **Yes** | |
| `SKILL.md` | 246 | **Generated** by `cli/generate-skill.mjs` from `COMMAND_REGISTRY` — the agent-facing operating manual | **Yes** | |
| `EVALUATION.md` | 80 KB | The verification contract: harness commands with budgets, per-AC verification tags and methods, 19 gates | **Yes** | The single most impressive public doc |
| `SPEC.md` | 121 KB | Technical spec, schema, every route, AC IDs inline | **No** | |
| `BUILDPLAN.md` | 73 KB | Milestones M-01…, each with ACs, file surface, hours, deps | **No** | |
| `DEPLOY.md` | 156 | *"There is no auto-deploy. Merging does not ship."* Documents that the live site fell behind `main` three times in one evening, and gives the `curl /health` check | **No** | |
| `CLAUDE.md` → `AGENTS.md` (symlink) | 121 | Agent onboarding; single file serving both runtimes | **No** | |
| `sequence/AFTER-ACTION-REPORT.md`, `code-quality-audit.md`, `FLEET-CAPACITY.md`, `UX-SWEEP-FINDINGS*.md` | — | Retro + audit artifacts | **No** | Exist; not read in depth for this slice |

**Judge-facing pitch:** *`AGENTS.md` is a symlink to `CLAUDE.md`, `SKILL.md` is generated from the CLI's command registry, and `docs/ROUTES.md` is generated from the route table — the docs a machine reads are produced by machines from the code.*

---

#### 13. What makes an "implement this change on demand" exercise fast

This is the section that answers the recruiting-exercise subtext directly.

1. **`npm run test:changed`** — vitest `--changed` from the merge-base with `github/main`, plus the node source-text contracts unconditionally. Turns a 60–90 s full suite into a scoped run. Documented as a pre-push convenience, never a gate.
2. **`npm run pr-gate -- --ticket MRQ-N`** — one command, 11 checks, everything CI will run plus four checks CI doesn't. You know before you push.
3. **Generated artifacts regenerate with a flag:** `npm run check:routes -- --write` rewrites `docs/ROUTES.md`; `cli/generate-skill.mjs` rewrites `SKILL.md`; `cli/generate-api-registry.mjs` rewrites the API registry from the built Worker. No hand-editing derived files.
4. **`tests/ac-claims/MRQ-N.json`** — a new ticket declares which criteria it owns in a 5-line JSON file, and the gate enforces uniqueness. There is a mechanical answer to "what does my change have to prove."
5. **Test filenames carry their ACs** (`public-form.AC-25-42-155-157-231-234.test.ts`) or their ticket (`bound-form-options.MRQ-126.test.ts`) — `ls tests/` is a search index.
6. **194-operation OpenAPI + a 6-file CLI (1,613 lines) + `SKILL.md`** — an agent can drive the whole product without reverse-engineering the UI, and `cli/diagnostics.mjs` exists for when it can't.
7. **Every check emits JSON**, not prose — an agent can parse a failure. `scripts/checks/lib/command.mjs` provides `emit`, `writeReport`, `parseArguments`, `isGateRun`, `recordSpeedHarness` as a shared harness.
8. **The check scripts are written to be read.** `check-clocks.mjs` is 180 lines of which ~55 are the rationale for its two rules, with the specific incident dates. `run-test.mjs` spends 27 lines explaining why it has two timeouts. Whoever inherits this codebase inherits the reasoning, not just the rules.
9. **`.dev.vars.example`, `SEED-DATA.md`, `npm run seed`, `npm run reset:demo`** — a working local instance with realistic, deliberately ugly data (a speaker on 3 submissions, a 4-person panel, an overdue task set, a live double-booking).
10. **Node ≥22.18 pinned with a written reason** (`ci.yml` comment): 22.18 runs TypeScript directly without a flag, and several checks execute `.ts` entry points; on 20.x they throw `ERR_UNKNOWN_FILE_EXTENSION` — *"which nobody saw, because the suite was being killed on time before the node-test step ever ran."*

---

#### 14. Verification ledger — what I actually executed

| Claim | Status |
|---|---|
| `npm test` on `github/main` — 982 tests, 0 failures, 62.5 s / 93.3 s | **verified-live** (ran twice) |
| `npm run trace:ac -- --scope=all` — 229 live, 216 covered, 10 uncovered, 0 errors | **verified-live** |
| `npm run trace:ac -- --scope=merged` — pass, 0 uncovered | **verified-live** |
| `check:design` — pass, 0 findings | **verified-live** |
| `check:routes` — pass, 40 SPA + 11 server | **verified-live** |
| `check:clocks` — pass, 0 findings | **verified-live** |
| `check:shell-truth` — pass, 311 files scanned | **verified-live** |
| `check:api` — pass, 194 operations, both halves live | **verified-live** |
| CI: 53/60 recent runs green; last 15 on `main` all green | **verified-live** |
| Live site `/health` → build `8dc17d304472`; `main` is `d520c320ddb4` | **verified-live — the deployed site is BEHIND main**, exactly as `DEPLOY.md` warns |
| Full pr-gate (all 11 in sequence) | **not executed** — would have taken ~4 min on a box at load 58; each constituent check was run individually |
| `check:repo`, `check:speed`, `check:seed`, `assemble:public` | **not executed** (need gitleaks / deployed infra / write git objects) — read in code |
| STATEMAP/SITEMAP entry-by-entry verification | **verified-in-code** (14 STATEMAP machines + full SITEMAP route diff) |
| PR / commit / worktree / board statistics | **verified-live** (`gh`, `git`, `lattice`, `.lattice/*.json`) |

---

#### 15. Claims to NOT make

1. ❌ "45-second test suite." It measured **62 s and 93 s**. Say "982 hermetic tests with a declared 45-second objective; the harness reports over-budget rather than failing, because wall time measures the machine."
2. ❌ "End-to-end Playwright coverage of the 11-step loop." **`tests/e2e/` does not exist.** The runner is a stub owned by MRQ-50.
3. ❌ Anything sourced from `SITEMAP.md`. 6 fabricated routes, 2 inverted, 29 missing, and a false premise in its own header.
4. ❌ "`STATEMAP.md` documents every state machine." §10 documents an unimplemented feature; four real machines are undocumented; three are under-enumerated.
5. ❌ "100% AC coverage." It is **94.3%** (216/229), and `--scope=all` currently **fails**. Nine of the ten gaps are the cancelled Airtable mirror — say that, it's a good answer.
6. ❌ Quoting the `ac-coverage.json` that exists in any checkout. It's gitignored and goes stale in hours. Regenerate, then quote.
7. ❌ "Built by 3 contributors." One operator, two git identities, one collaborator, and an agent fleet in 89 worktrees. Describe the fleet.
8. ❌ "104 PRs" as the total. That's the GitHub window only (24 hours). **≈142 across both forges** over the ~4-day build.
9. ❌ Implying a judge can browse this evidence today. `Stage-11-Agentics/marquee` is **private**, and the public orphan branch is 167 commits stale with `docs/` excluded entirely.
10. ❌ "The live site shows the latest work." It's at `8dc17d30`, `main` is at `d520c320`. Deploy before pointing anyone at it.

---

#### 16. The five strongest, cleanest claims

1. **The design contract is a merge gate.** `check:design` diffs the shipped CSS token block byte-for-byte against the client-approved prototype file, enforces four exact layout dimensions and 19 sidebar labels, and fails on a single hardcoded hex in the themed stylesheet. *verified-live.*
2. **The route map is generated because a route list can lie.** On Workers every unmatched path returns 200 with the SPA shell, so `/comms` looked alive while being nothing. `docs/ROUTES.md` is generated from three sources — including the public-path predicate *parsed back out of `app.tsx` and rebuilt as a function*, with a throw if the parse is incomplete — and the gate fails on drift. *verified-live.*
3. **Every test names the criterion it proves, enforced by an AST parser.** 982 tests, 0 malformed titles, 71 uniqueness-checked ownership manifests, and a struck criterion that cannot be cited. 216/229 criteria covered, gaps enumerated by name. *verified-live.*
4. **The harness will not lie about what it hasn't proven.** Six unbuilt checks are registered as stubs that name their owning ticket, write `status: "stub"`, and exit non-zero under `MARQUEE_GATE=1`. *verified-in-code.*
5. **A sarcastic aside at 05:08 in the buyer's video is traceable to a `throw` statement.** R14 → US-09 → AC-25 → M-14 → MRQ-15 → claim manifest → 9 tests → `public-form.routes.ts:638`. *verified-in-code, worked end to end in §1.3.*

---

## Appendix — the synthesist's own live verification ledger

Curled from `https://marquee.stage11.dev` directly, independent of the research agents.
This is the evidence behind the `verified-live` tags used throughout.


All checks run against `https://marquee.stage11.dev` from the synthesist surface.

## Deploy state (the frame everything else hangs on)

- `GET /health` → `{"service":"marquee","status":"ok","build":"8dc17d304472","built_at":"2026-08-12T17:10:02.169Z"}`
- Full sha `8dc17d304472d368309590ed60b8cc389851f1dc` = PR #103 ("There is no merge freeze").
- `github/main` is **25 commits ahead** of the deployed sha. Diff over `src/ cli/ migrations/ scripts/`: **66 files, +4,799 / −299**.
- Route files: deployed tree has 61 under `src/routes/`; main has 62. The only new route *file* is `src/routes/public-schedules.routes.ts` (MRQ-132).
- **The primary checkout is 91 commits behind `github/main`** (HEAD `13a77cb4`). Its `src/routes/` has 42 files. Any analysis run against it understates the product badly.

### What is on main and NOT on the live site
| Area | Evidence |
|---|---|
| Attendee personal schedule | `src/ui/public/agenda/schedule-script.ts` **+1078 new**, `PublicAgendaPage.tsx` +511, `src/routes/public-schedules.routes.ts` new |
| Multi-event switcher + create-with-copy UI | `src/ui/shell/EventSwitcher.tsx` +215 new, `event-context.tsx` +184 new, `event-selection.ts` +73 new, `NoConference.tsx` +45 new, `CreateConferencePage.tsx` +285 |
| Venue site map public page `/site` | route absent from deployed `public-agenda.route.tsx`; present on main |
| Agent-facing agenda `/agenda/agents` | route absent from deployed tree; present on main |
| Misc | onboarding CSS/matrix fix (#107), public form (+51), sidebar (+58), QuickSearch (+36), `check:clocks` (#109) |

**Note:** the multi-event and cold-start *API* routes are already live (see OpenAPI dump below). It is the organizer-facing UI that is not.

**Risk on `/site` and `/agenda/agents`:** open PR #111 is titled in part "…and three server pages the assets router was swallowing", so these two may still fall through to the SPA shell even after a deploy of current main. Deploying main alone may not be sufficient to make them reachable.

## API surface — verified-live

`GET /api/openapi.json` returns a real OpenAPI **3.1.0** document (not the SPA shell):
- **148 paths / 187 operations**, `info.title = "Marquee API 1.0.0"`
- **48 component schemas**; `securitySchemes` = `bearerAuth`, `cookieAuth`
- Covers: auth, claim/setup/instance, events, agenda, board, committees, comms, dashboard, delivery-health, embeds, files, formats, forms(+fields/admins/duplicate/publish/reopen), imports(+mapping/run/**undo**), onboarding, outbox, plans/rounds/assignments/comparisons/criteria/promote, reviewer queue, search, speaker-tasks, speakers, submissions(+bulk/decision/publish/reversal/schedule/**not-notified**/content-restore/talk-editing), task-templates, templates, tracks, venues, views, org/{people,lists,pipeline,tokens,members,invites,comms,imports,summary}, me/{portal,profile,tasks,uploads,participations,co-speaker}, public/{agenda,forms,sessions,speakers,embeds,uploads}, telemetry/{client-errors,diagnostics}, media, admin/{reset-demo,remove-demo}.

`GET /api/docs` — a self-hosted API reference page, **verified-live**. Its `<head>` carries:
- `<meta name="marquee-openapi-sha256" content="1c4505c1859203b7a33b0dc03ec4477031068498090be9be08c12d0752a0f82d">`
- `<meta name="marquee-openapi-operations" content="187">`
- `<link rel="alternate" type="application/json" href="/api/openapi.json">`
A machine-checkable fingerprint of the API contract, served on the docs page itself. Nothing in the brief asks for this.

**Caveat — the catch-all makes route probing lie.** `app.all("*", ASSETS.fetch)` (src/index.ts:165) means *every* unknown path returns HTTP 200 with the SPA shell. `GET /definitely-not-a-real-route-xyz` → 200. So a 200 proves nothing; the real 404 is the JSON envelope from the API router. Any agent probing this site by status code will be misled. (Bare `/api` also returns the shell — `app.all("/api/*")` does not match `/api` itself.)

## Enforced validation — verified-live

`POST /api/v1/auth/demo` with the wrong field name returns **HTTP 400** and:
```json
{"error":{"code":"malformed_request",
  "message":"Invalid option: expected one of \"organizer\"|\"reviewer\"|\"speaker\"",
  "field":"role",
  "details":[{"field":"role","message":"Invalid option: expected one of \"organizer\"|\"reviewer\"|\"speaker\""}]},
 "request_id":"a2a1850a9f56f795"}
```
Field-level, machine-readable, enumerates the valid options, and carries a correlation id. This is the single best 10-second demonstration of "real enforced validation" on the whole site.

Response headers on the same call, verified-live: `strict-transport-security: max-age=63072000; includeSubDomains`, `ratelimit-limit: 120`, `ratelimit-remaining`, `ratelimit-reset`. Rate limiting is live and advertised in standard headers.

## Seat reachability — verified-live

Landing page (`/`) renders four doors, confirmed by interactive snapshot:
`Enter as organizer →` · `Enter as reviewer` · `Enter as speaker` · `View public CFP`,
under the line *"No signup. Every demo opens the populated DevFlow Conf 2027 workspace, each in its own seat."*

All three seats open with **one unauthenticated POST**:
| role | result |
|---|---|
| organizer | `{"ok":true,"role":"organizer","event_id":"evt_aie-ny-2026","person":{"id":"per_aie-program-committee","name":"AIE Program Committee"}}` |
| reviewer | `{"ok":true,"role":"reviewer",...,"person":{"id":"per_reviewer-dario-quill","name":"Dario Quill"}}` |
| speaker | `{"ok":true,"role":"speaker",...,"person":{"id":"per_aarush-selvan","name":"Aarush Selvan"}}` |

**The reviewer seat now has a door.** The ~24.7-point loss from "the reviewer seat had no door" is closed on the live site.
**There is no attendee door and no agent/evaluator door** on the landing page, and `role` is a closed enum of three.

## Public surfaces — verified-live vs swallowed

Server-rendered (distinct `<title>`, real content):
| Route | Title | Size |
|---|---|---|
| `/agenda` | `Agenda · Marquee` | 65,574 B, renders `class="public-session-title"` repeatedly |
| `/speakers` | `Speakers · Marquee` | 25,541 B |
| `/p/:slug` | `Unavailable · Marquee` (correct for a bogus slug) | — |
| `/s/:slug` | `Unavailable · Marquee` (correct for a bogus slug) | — |

Falls through to the generic SPA shell (`Marquee — Program operations`):
| Route | Why |
|---|---|
| `/site` | not in the deployed tree; new on main |
| `/agenda/agents` | not in the deployed tree; new on main |

`GET /api/v1/public/agenda` (unauthenticated) returns keys `event, venue, days, tracks, formats, rooms, sessions, filters` — the whole public program as JSON with **no credential at all**.

Demo conference is seeded as **"DevFlow Conf 2027"** (`evt_aie-ny-2026`, slug `aie-ny-2026`), Moscone West, 2027-05-12→14. Landing tiles read: Submitted 3 · In review 277 · Ready to place 2 · Onboarding 10 · Scheduled 0 · Published 25. **`Scheduled 0` is worth a look** — with Published 25 it may be correct, but a judge reading the dashboard sees a zero in the middle of the funnel.

## Speed — verified-live (R7 is a graded feature)

| Request | Total time |
|---|---|
| `/` landing | 0.234 s |
| `/api/v1/public/agenda` | 0.186 s |
| `/api/openapi.json` | 0.182 s |

## Privacy / observability posture — verified-in-code (docs/OBSERVABILITY.md, README.md on main)

README's second section is titled **"Marquee never phones home"**. Claims, each stated structurally rather than as policy:
- no vendor SDK, no error-tracking DSN, no analytics script, no third-party beacon
- **"A speaker's email address cannot be logged, because the log builder has no field for it"** — allowlist, not redaction
- client error reports are logged and discarded; no table, no migration
- routes recorded as templates, never raw URLs; no field for request body, cookie, or `Authorization`
- every error surface shows a short reference code that is a prefix of the request id, so six characters read aloud over the phone `grep` straight to the log line
- `docs/OBSERVABILITY.md` enumerates every event and field and gives three off switches

**Not asked for by any R-number.** Needs a code-level audit before it becomes a public claim (assigned to the craft/honesty agent).
