# The grader's eval kit (`sbek`) — what it measures and how we assess against it

**Source:** `https://forge.smol.ai/swyx/killmysaas-evals` (swyx / smol.ai Forgejo, public).
**Local checkout:** `.eval-kit/` at the repo root — a live git clone with `origin` intact, so
`git -C .eval-kit pull` picks up changes. **Gitignored**, deliberately: it is a third-party
repo with its own history and must never enter `main` or the public `mrq-42-assembly` orphan.
**Pinned at:** `8109958`, 2026-08-12. **Re-pull before any run** — swyx is still editing
the kit, and a rubric change changes our score. `.eval-kit-agent/` — the fork the rounds
actually run — is resynced from it: its graded content (rubric ids, weights, criteria,
pass criteria, scenarios) is identical to upstream, and it adds only `survey_terms` and
the in-session harness. Verify that parity rather than assuming it.

This closes the "rubric ingestion deferred by Atin" item in the decisions log.

## What it is

Not a checklist — a working harness. `specs/*.yaml` drive a Claude + Playwright browser agent
through 20 scripted scenarios against a submission URL, collecting screenshots, observations
and an action transcript. A **separate LLM judge, in fresh context, never seeing the agent's
reasoning**, scores 98 rubric items against that evidence and must cite it. Anything a browser
cannot observe (real mail delivery, ICS opening in a calendar) routes to a manual checklist.

Judging is explicitly **implementation-agnostic**: rubrics describe functionality and
filled-state expectations, never pixel fidelity. Our Flight Deck aesthetic neither helps nor
hurts. What is graded is whether the loop *works*.

## The scoring model

| | |
|---|---|
| **Rubric items** | 98 — 86 required (183 weighted pts), 12 extra credit (speaker-crm, 19 pts) |
| **Item weight** | 1/2/3 = polish/important/core. Ranks items **within their own area only** |
| **Area weight** | Each area's share of the overall score. Required areas sum to 100 |
| **Verdicts** | `pass` 1.0 · `partial` 0.5 · `fail`/`not_found` 0 · `cannot_judge` **excluded from the denominator**, routed to manual |
| **Area score** | earned weighted pts / *judgeable* weighted pts |
| **Overall** | area-weighted mean of area percentages, renormalized over areas that ran |
| **Coverage cliff** | **below 60% coverage the headline score is withheld entirely** |

That last row drives the strategy. **Coverage is a first-class adversary.** A feature we
shipped but the agent could not reach scores the same as one we never built — except worse,
because it drags the report toward the cliff.

### Areas

| Area | Spec | Area wt | Scenarios | Items | Item wt |
|---|---|---:|---:|---:|---:|
| Call for Papers (incl. multi-event) | `01-call-for-papers.yaml` | 20 | 4 | 18 | 38 |
| Abstract Management (review depth) | `02-abstract-management.yaml` | 20 | 3 | 14 | 28 |
| Speaker Management (incl. portal) | `03-speaker-management.yaml` | 15 | 3 | 16 | 33 |
| Content Management (files/versions/approvals) | `04-content-management.yaml` | 15 | 3 | 14 | 31 |
| AI Agenda Builder | `05-ai-agenda.yaml` | 10 | 2 | 8 | 18 |
| Public Widgets (5 surfaces) | `06-public-widgets.yaml` | 20 | 3 | 16 | 35 |
| **Required** | | **100** | **18** | **86** | **183** |
| Speaker CRM (*extra credit*) | `07-speaker-crm.yaml` | 10 | 2 | 12 | 19 |

### The type cut — the kit's own stated reading order

Every item carries a `type`: what kind of problem it probes, orthogonal to area.

| Type | Probes | Req. wt | Share |
|---|---|---:|---:|
| `crud` | create/edit and it persists | 41 | 23% |
| `roundtrip` | what one role wrote is what another role reads | 33 | 18% |
| `exists` | the screen is present and reachable at all | 28 | 15% |
| `rule` | a stated constraint is actually **enforced** | 22 | 12% |
| `scoping` | a role sees exactly what it should; events don't leak | 20 | 11% |
| `depth` | differentiators beyond the core loop | 13 | 7% |
| `bulk` | CSV import, bulk mail, ZIP export, auto-distribution | 11 | 6% |
| `side-effect` | egress the browser can't see — real mail, calendar files | 8 | 4% |
| `handoff` | data crosses a module boundary without re-entry | 6 | 3% |

> *"`exists`/`crud` pass almost everywhere and don't separate submissions. `rule` and `scoping`
> are the strongest signal in the whole rubric — but also the items scenarios reach last, so
> they're the first thing a turn-limit cutoff eats."*

**`rule` + `scoping` + `roundtrip` + `handoff` = 81 of 183 required points (44%)** — exactly
what Marquee was built to do. This rubric rewards our thesis, and puts it last in every
scenario, which makes turn budget a scoring variable rather than an operational detail.

## Marquee-specific read

**The AI-agenda SKIP (R27) costs almost nothing.** AIA-01…07 are an ordinary agenda builder —
time×room grid, configurable rooms, placement that persists, speaker double-booking warning,
room conflict, move-and-clear, publish handoff. Only **AIA-08** (w1) is the auto-schedule
assist, judged "generously as any auto-place assist". Exposure ≈ **0.6 of 100**, not 10.

**Public Widgets at weight 20 is joint-heaviest**, which MRQ-75's embed widening already
answered. That call looks correct on the numbers.

**The reviewer seat has no door — ~24.7 of 100 points.** Verified against `github/main`:
`DEMO_ROLE_TO_MEMBERSHIP` is `{organizer, speaker}`, and `POST /api/v1/auth/demo` with
`role: reviewer` returns 400. `ABS-S3` *starts* as `persona: reviewer`; abstract-management is
28/28 item-weight reviewer-touching (20 pts) plus 4.7 in CFP. Unreached work becomes
`cannot_judge` — not scored against us, but subtracted from coverage. Note the softening from
run 1: `/reviewer` does render a real scoped queue, so the *surface* is judgeable; what is
missing is provable seat **isolation**.

**`submissionNotes` is our only channel to the grader** — a free-text field the harness injects
into every scenario prompt. See the lesson below; it is worth more than most features.

**Speaker CRM is extra credit and we score ~0.** Correct call: ignore it.

## Run 1 — 2026-08-12T02:37Z, against `ddc22ef`

Stopped after Call for Papers. **CFP: 40.7% at 71.1% coverage**, score not withheld.

| type | score | coverage | |
|---|---:|---:|---|
| `exists` | 60% | 100% | the screens are there |
| `crud` | 50% | 100% | |
| `scoping` | 25% | 100% | |
| `roundtrip` | **0%** | 33% | the two-sided flows never closed |
| `rule` | — | **0%** | never reached; the turn cap ate them |

The shape the kit predicts for a build that ships screens faster than it closes loops.

**All four CFP scenarios hit the 70-turn cap** — not loops, just runway. 70 is the graders'
default, so it is the real condition. `--resume --max-turns 100` separates *"not built"* from
*"not reached"*.

### Defects the judge raised unprompted

| Sev | Finding |
|---|---|
| **critical** | Public CFP headshot upload never registers — filename and crop preview render, field stays "No file attached yet.", Submit always fails |
| major | `Draft saved locally · just now` shows continuously, then all content is gone on return — the indicator is client-only; the server draft was never created |
| major | A submission whose badge *and* detail read "Accepted" returns **0 records** when the list is filtered by status Accepted; it appears only under "Onboarding" |
| major | Multi-conference advertised in the shell but absent — switcher modal reads "Not installed", `/conferences/new` is not a route |
| major | Admin *Create a submission* requires internal slugs (`track_agents`), not display names, with an opaque error |
| minor | Renamed conference persists in `/settings` but sidebar and breadcrumb still read the old name |
| minor | CFP builder's Format options are a hand-typed comma-separated list, independent of Settings → Formats |
| minor | Branding mismatch — header "DEVFLOW CONF 2027", form title "2026 CFP", footer "Built for AIE NYC 2026" |

Turnstile was classed by the judge as *"harness-side limitation, not counted as an app
defect"* — but its **consequences** were scored: `CFP-05` and `CFP-06` (both w3) failed because
no speaker-entered proposal ever reached the organizer. Fixed in PR #42 (`9e1636c`), which
exempts `demo_mode = 1` conferences from the public-form bot gate and amends AC-231 to match.

### Structural gaps in abstract-management, before the stop

- **One shared scorecard per evaluation plan, not per round.** `ABS-01` (w3) requires two or
  more rounds *each with its own scorecard*; both rounds open the same editor. `ABS-02` (w2,
  per-round reviewer pools) is likely the same gap.
- Admin-path submissions carry `origin: admin` and list only "AIE Program Committee" as
  Submitter — a knock-on of the blocked public form, not an independent defect.

### The lesson that cost the most

**`submissionNotes` must be verified against the deployed build, never written from
`SITEMAP.md`.** The notes claimed a conference switcher and `/conferences/new`; both are stubs.
The agent went looking, burned turns, and recorded the contradiction — a credibility hit with
the judge on top of the wasted runway. `SITEMAP.md` documents the *prototype*, which is the
design contract, not the implementation record.

## Ready to run

`./run-eval.sh` in `.eval-kit/` wraps the whole thing and **refuses to start on a stale
deploy** — the harness scores the deployed URL, so grading a build nobody shipped is the
easiest way to waste an hour and reach a false conclusion.

```sh
cd .eval-kit
./run-eval.sh cfp                # one area, ~10 min — the fast read after a deploy
./run-eval.sh full               # all six required areas, ~1 hr, $2-10
./run-eval.sh resume runs/<dir>  # finish an interrupted run; pays only for what did not complete
./run-eval.sh rescore runs/<dir> # rebuild the report from stored evidence, no API calls
```

Preflight checks three things that have each already gone wrong once: the kit has no new
upstream commits, live matches `github/main`, and `.env` holds the key.

Before any run, verify optional scoring still has both exclusion sites:

```sh
grep -n "filter((a) => !a.optional)" .eval-kit/src/report.ts   # 2 hits at pin 8109958
```

Two hits mean optional areas are excluded from `overallPct`, `overallCoveragePct`, and `byType`, so extra credit is currently worth 0.0. If they disappear, the Speaker CRM verdict in `sequence/research/speaker-crm-scope.md` §5 reopens; re-read it before deciding.

Watch `runs/<ts>/run.log` — **the file, not stdout**, which buffers for the whole hour.

**Afterwards, always `npm run reset:demo`.** A run leaves a fictional *DevFlow Conf 2027* in
the judge-visible workspace — renamed conference, rewritten formats and tracks. F-13 made reset
deliberately manual, so nothing does this for you.

## Calibration to carry into every reading

- A `cannot_judge` from a turn-limit cutoff and a `not_found` from a real search are opposite
  findings that look adjacent in a report. **Always read an area's `rule`/`scoping` row
  together with its coverage.**
- A submission is never penalized for harness failures — but it *is* penalized by the coverage
  cliff, which is the same thing with a delay.
- The judge independently reports **defects** where no rubric item covers them. That is free QA
  from a hostile reader. Mine it.
