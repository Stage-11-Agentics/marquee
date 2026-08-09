# Ticket map — Marquee fleet run

Minted 2026-08-09 by `agent:orchestrator-intake` from `BUILDPLAN.md` v1.4 (Amendments 1–9) + `SPEC.md` Amendment 10/11 folds. **Every ticket is in `backlog`; nothing is dispatched.**

Every downstream boot prompt keys off this file. `Deps` are the BUILDPLAN dependency column, transcribed exactly and translated through the merges below — they are live `depends_on` links in Lattice, not prose.

**56 tickets covering all 72 BUILDPLAN items** (58 feature/cross-cutting + 11 audits + 3 spikes) · **72 dependency links**. 14 merges folded 33 items into 14 tickets; the merge rule and every merge's justification live in the ticket's own description.


## Wave 0 — walking skeleton (D+0 → D+13, CP-1)

| BUILDPLAN item(s) | Ticket | Title | Hrs | Workflow | ACs | Deps |
|---|---|---|---|---|---|---|
| M-01 | **MRQ-1** | Platform skeleton and first real deploy | 3 | inline-full | — (no AC directly claimed; underwrites AC-1/AC-2's deployed URL and guardrail G6) | — |
| M-02 | **MRQ-2** | Database schema — the whole init migration | 4 | sub-agent-full (named in the mint brief: schema) | AC-176, AC-212, AC-214, AC-222, **AC-234, AC-235, AC-246–249** · plus schema-only foundation for **AC-252, AC-253** (Amendment 11) | MRQ-1 |
| M-03 | **MRQ-3** | Auth, demo entry, and reset-demo | 4 | inline-full | AC-1, AC-2, AC-107, AC-214, **AC-230** | MRQ-2 |
| M-04a | **MRQ-4** | Seed generator — spine | 2 | fast-track (≤2 h) — but it owns a flagged shared file and sits on the critical chain; treat the file rule as binding. | AC-8 · seed-side foundation for **AC-252** (Amendment 11) | MRQ-2 |
| M-04b | **MRQ-5** | Seed generator — pool, evaluation, and deliberate ugliness | 5 | inline-full | AC-3, **AC-234, AC-245, AC-246, AC-249** | MRQ-4 |
| M-05a+M-06 | **MRQ-6** | Design system, admin shell, and the check harness | 6 (2 + 4) | inline-full (max of the constituents' modes; M-05a alone was fast-track) | — (no AC directly claimed; backs gates 2, 3, 15 and every `auto` AC's machinery; every admin screen inherits the shell) | MRQ-1 |
| M-05b | **MRQ-7** | Public landing page with live pipeline preview | 2 | fast-track (≤2 h) | AC-1, AC-2, AC-4 | MRQ-3, MRQ-4, MRQ-6 |
| M-07 | **MRQ-8** | API core, list contract, and OpenAPI assembly | 4 | inline-full | AC-105, AC-106, AC-108 | MRQ-2, MRQ-56 |
| M-08 | **MRQ-9** | First loop screen: submissions list | 4 | inline-full | AC-23, part AC-66, foundation **AC-240, AC-247–249** | MRQ-4, MRQ-6, MRQ-8 |

## Wave 1 — the loop, in walkthrough order (D+13 → D+36, CP-2)

| BUILDPLAN item(s) | Ticket | Title | Hrs | Workflow | ACs | Deps |
|---|---|---|---|---|---|---|
| M-09 | **MRQ-10** | Event settings: details, formats, tracks, rooms, buildings | 4 (+~1 for the venue fold) | inline-full | AC-5 – AC-13 · **AC-252, AC-253** (Amendment 11 fold — settings-side owner) | MRQ-9 |
| M-10 | **MRQ-11** | Program dashboard | 4 | inline-full | AC-14 – AC-16, **AC-240** | MRQ-9 |
| M-11 | **MRQ-12** | Email core and demo-safe outbox | 6 | inline-full | AC-33, AC-117, AC-125 – AC-131 foundation | MRQ-2, MRQ-8 |
| M-12 | **MRQ-13** | Form builder, catalog, and condition evaluator | 10 | sub-agent-full (≥7 h) | AC-17 – AC-21, AC-24, AC-27 – AC-33, **AC-132, AC-133, AC-234** | MRQ-10 |
| M-13 | **MRQ-14** | Uploads: presign, verify, and serve | 5 | inline-full | AC-52, AC-146 – AC-148, **AC-231** (presign gate), **AC-232** | MRQ-1 |
| M-14 | **MRQ-15** | Public CFP form | 8 | sub-agent-full (≥7 h) | AC-25, AC-26, AC-29, AC-30 – AC-42, AC-155 – AC-157, **AC-231, AC-234** | MRQ-13, MRQ-12, MRQ-14 |
| M-15 | **MRQ-16** | Speaker portal | 7 | sub-agent-full (≥7 h) | AC-43 – AC-52, **AC-237, AC-240**, AC-233 (cuttable if named) | MRQ-14, MRQ-12 |
| M-16 | **MRQ-17** | Evaluation plan, committees, and reviewer track scopes | 7 | sub-agent-full (≥7 h) | AC-53 – AC-58, AC-98, **AC-246** | MRQ-9 |
| M-17 | **MRQ-18** | Reviewer queue | 9 | sub-agent-full (≥7 h) | AC-59 – AC-65, AC-158, AC-159, **AC-244–246** | MRQ-17 |
| M-18 | **MRQ-19** | Bulk and record-owned decisions with cascade | 6 | inline-full | AC-66 – AC-69, AC-114 – AC-117, **AC-243** | MRQ-12, MRQ-56 |
| M-19a | **MRQ-20** | Agenda: data, pool, placement, and day/list/week/room views | 7 | sub-agent-full (≥7 h) | AC-70 – AC-74, AC-80, AC-82 · **AC-252, AC-253** (agenda-side rendering, Amendment 11 fold) | MRQ-9 |
| M-19b | **MRQ-21** | Agenda: track swimlane and conflicts | 5 | inline-full | AC-75 – AC-79, AC-81 | MRQ-20 |
| M-20+M-21 | **MRQ-22** | Public event site, permalinks, and embeds | 9 (5 + 4) | sub-agent-full (≥7 h combined — max of the constituents' modes) | AC-83 – AC-90, **AC-240** · **AC-252** (public "Room · Building") | MRQ-20 |
| M-22 | **MRQ-23** | Seed and speed check suites | 4 | inline-full | AC-3 evidence, guardrail G7 | MRQ-22 |

## Wave 2 — Tier B, top-down, plus the mirror (D+40 →)

| BUILDPLAN item(s) | Ticket | Title | Hrs | Workflow | ACs | Deps |
|---|---|---|---|---|---|---|
| M-23+M-40 | **MRQ-24** | Chase board and slide upload | 8 (6 + 2) | sub-agent-full (≥7 h combined) | AC-91 – AC-94, AC-146 – AC-148, **AC-232** | MRQ-16, MRQ-12, MRQ-14 |
| M-24+M-33 | **MRQ-25** | Calendar invites and the un-accept cascade | 10 (5 + 5) | sub-agent-full (≥7 h combined) | AC-95 – AC-97, AC-121 – AC-124 · **AC-252** (ICS `LOCATION`) | MRQ-12, MRQ-55, MRQ-20 |
| M-25 | **MRQ-26** | Airtable mirror — outbound | 8 | sub-agent-full (named in the mint brief: mirror) | **AC-225, AC-228** | MRQ-2, MRQ-9 |
| M-26 | **MRQ-27** | Airtable mirror — inbound | 5 | sub-agent-full (named in the mint brief: mirror) | **AC-226, AC-227, AC-229** | MRQ-26, MRQ-54 |
| M-27+M-46 | **MRQ-28** | Two-round funnel and comparison mode | 8 (4 + 4) | sub-agent-full (≥7 h combined) | AC-98 – AC-100, AC-163 – AC-166 | MRQ-17 |
| M-28 | **MRQ-29** | Quick search | 4 | inline-full | AC-101 – AC-104 | MRQ-11 |
| M-29+M-54 | **MRQ-30** | API surface completion and signed outbound webhooks | 9 (5 + 4) | sub-agent-full (≥7 h combined) | AC-105 – AC-108, **AC-241, AC-242** | MRQ-8 |
| M-30 | **MRQ-31** | Sessionize import | 7 | sub-agent-full (≥7 h) | AC-109 – AC-113 | MRQ-9 |
| M-31+M-34+M-35 | **MRQ-32** | Automated triggers, filtered group email, and rejection at scale | 9 (3 + 4 + 2) | sub-agent-full (≥7 h combined) | AC-114 – AC-117, AC-125 – AC-131, **AC-250** (send-surface half) | MRQ-12, MRQ-19 |
| M-32+M-53 | **MRQ-33** | Admin create, the submission record, and the program board | 9 (5 + 4) | sub-agent-full (≥7 h combined) | AC-118 – AC-120, **AC-238, AC-240, AC-243** · **AC-251** (Amendment 10 fold) | MRQ-9 |
| M-36+M-55 | **MRQ-34** | Saved views, configurable columns, Draft queue, and builder condition summary | 7 (6 + 1) | sub-agent-full (≥7 h combined) | **AC-134, AC-247 – AC-249** | MRQ-9, MRQ-13 |
| M-37 | **MRQ-35** | Category routing | 4 | inline-full | AC-135 – AC-137, **AC-234** | MRQ-17, MRQ-15 |
| M-38+M-39 | **MRQ-36** | The marquee CLI and the shipped SKILL.md | 9 (5 + 4) | sub-agent-full (≥7 h combined) | AC-138 – AC-145, **AC-250** (CLI half) | MRQ-30 |
| M-41+M-43 | **MRQ-37** | Co-speaker flow and the mobile submit pass | 7 (4 + 3) | sub-agent-full (≥7 h combined) | AC-149 – AC-151, AC-155 – AC-157 | MRQ-15 |
| M-42+M-52 | **MRQ-38** | Role confirm/decline and decision feedback | 6 (3 + 3) | inline-full | AC-152 – AC-154, **AC-235, AC-236** | MRQ-16, MRQ-12, MRQ-18, MRQ-33 |
| M-44+M-47 | **MRQ-39** | Mobile reviewer pass and optional AI first pass | 6 (3 + 3) | inline-full | AC-158, AC-159, AC-167 – AC-169 | MRQ-18 |
| M-45 | **MRQ-40** | README, self-host path, and extension points | 5 | inline-full | AC-160 – AC-162 | MRQ-9 |

## Cross-cutting (run alongside, not after)

| BUILDPLAN item(s) | Ticket | Title | Hrs | Workflow | ACs | Deps |
|---|---|---|---|---|---|---|
| M-48+M-49 | **MRQ-41** | Empty-state pass and craft sweep | 6 (3 + 3) | inline-full | AC-161 (M-48) · M-49 carries no AC of its own but underwrites every "not colour alone" assertion and felt checkpoint C3 | — |
| M-50+M-56 | **MRQ-42** | AC-coverage closure and public-repo assembly | 6 (3 + 3) | inline-full | — (backs gates 3 and 16; M-50 produces `ac-coverage.json`) | — |

## Audit track — each owned by an auditor who did not write the code

| BUILDPLAN item(s) | Ticket | Title | Hrs | Workflow | ACs | Deps |
|---|---|---|---|---|---|---|
| A-1 | **MRQ-43** | Audit — repo hygiene and full-history scan | 2 | fast-track | — (backs gates 15 and 16) | — |
| A-2 | **MRQ-44** | Audit — PROTOTYPE badge absent from the product | 1 | fast-track | — (backs gate 15) | MRQ-41 |
| A-3 | **MRQ-45** | Audit — mail containment and demo-safe suppression | 2 | fast-track | — (protects AC-38's live path and every demo-safe assertion) | MRQ-12 |
| A-4 | **MRQ-46** | Audit — Airtable mirror isolation | 1 | fast-track | — (underwrites AC-225) | — |
| A-5 | **MRQ-47** | Audit — cookie scope and session issuance | 2 | fast-track | — (asserts the AC-2 demo-mode gate; backs gate 5) | MRQ-3 |
| A-6 | **MRQ-48** | Audit — speed report, AC-sourced versus objective | 1 | fast-track | — (backs gate 7; evidence for AC-16, AC-36, AC-62, AC-69, AC-85, AC-89, AC-103) | MRQ-23 |
| A-7 | **MRQ-49** | Audit — public write surface and upload safety | 2 | fast-track | **AC-231, AC-232** (audit evidence; the tests are M-13's and M-14's) | MRQ-14, MRQ-15 |
| A-8 | **MRQ-50** | Audit — reviewer anonymity byte-scan | 1 | fast-track | **AC-64** (audit evidence) | MRQ-18 |
| A-9 | **MRQ-51** | Audit — reviewer event and track isolation | 1 | fast-track | **AC-214, AC-246** (audit evidence) | MRQ-17, MRQ-18 |
| A-10 | **MRQ-52** | Audit — bulk-write path and chunking | 1 | fast-track | — (underwrites AC-66 – AC-69) | MRQ-19 |
| A-11 | **MRQ-53** | Audit — reset drill | 1 | fast-track | **AC-230** (audit evidence; the e2e is M-03's) | MRQ-3 |

## Spikes — time-boxed, fail loudly

| BUILDPLAN item(s) | Ticket | Title | Hrs | Workflow | ACs | Deps |
|---|---|---|---|---|---|---|
| S-1 | **MRQ-54** | Spike — Airtable inbound webhook loop | 2 | fast-track | — (de-risks AC-226, AC-227, AC-229) | — |
| S-2 | **MRQ-55** | Spike — ICS rendering in real mail clients | 1 | fast-track | — (de-risks AC-95, AC-97, AC-124; settles gate 10's shape) | — |
| S-3 | **MRQ-56** | Spike — D1 bulk-write chunking at wave scale | 1 | fast-track | — (de-risks AC-66 – AC-69; guardrail G11) | — |

## Merge ledger

Fourteen merges, each recorded on its ticket with the arithmetic. Rule applied: same module/file surface **or** same-wave with an identical dependency set; dependency-adjacent; combined ≤10 h; never across wave boundaries, checkpoint gates, the spikes, the audit track, or M-02; coherence beats count.

| Merged | Ticket | h | Basis |
|---|---|---|---|
| M-05a + M-06 | MRQ-6 | 6 | same wave, identical deps {M-01}, zero file overlap; concentrates two flagged shared-file ownerships in one serialized ticket |
| M-20 + M-21 | MRQ-22 | 9 | public-surface module; M-21 depends only on M-20 |
| M-23 + M-40 | MRQ-24 | 8 | M-40's "live organizer view" of an upload *is* the chase board's task-matrix cell |
| M-24 + M-33 | MRQ-25 | 10 | one ICS `UID`/`SEQUENCE` lifecycle — M-33's cancellation is M-24's `METHOD:CANCEL` path |
| M-27 + M-46 | MRQ-28 | 8 | evaluation-round module; M-46 depends only on M-27 |
| M-29 + M-54 | MRQ-30 | 9 | one story (US-68), one API module, identical ticket-level dep {M-07} |
| M-31 + M-34 + M-35 | MRQ-32 | 9 | the comms cluster — three templated-send surfaces on M-11's outbox |
| M-32 + M-53 | MRQ-33 | 9 | AC-243 makes the board a read-only surface *onto* the record; M-53 depends on M-32 |
| M-36 + M-55 | MRQ-34 | 7 | both surface `isFieldApplicable()`; M-36's deps ⊂ M-55's |
| M-38 + M-39 | MRQ-36 | 9 | same `cli/` + `SKILL.md` surface, both back gate 12; M-39 depends only on M-38 |
| M-41 + M-43 | MRQ-37 | 7 | identical deps {M-14}, same public-form module |
| M-42 + M-52 | MRQ-38 | 6 | the two speaker-response tickets M-15 deliberately did not own |
| M-44 + M-47 | MRQ-39 | 6 | identical deps {M-17}, same reviewer module |
| M-48 + M-49 | MRQ-41 | 6 | one sweep over every route, no deps |
| M-50 + M-56 | MRQ-42 | 6 | both extend `scripts/checks/*`, no deps, both run at the terminal gate |

### Merges declined, with the reason

| Candidate | h | Why not |
|---|---|---|
| M-04a + M-04b | 7 | All three conditions hold, but the merge re-fuses adversarial split **B-5** and pushes the CP-1 chain from 13 h to 18 h. Orchestrator ruling 2026-08-09: stays split. |
| M-03 + M-04a | 6 | Identical deps {M-02}, but merging puts 6 h on the Wave 0 critical chain ahead of M-08 — CP-1 slips ~2 h. |
| M-09 + M-10 | 8 | Identical deps {M-08} and legal under lever 2, but M-12 depends on M-09: the plan's longest Wave 1 chain (M-09 4 → M-12 10 → M-14 8 = 22 h against 1 h of CP-2 margin) becomes 26 h. Declined to protect the CP-2 gate. |
| M-25 + M-26 | 13 | Over the 10 h cap. |
| M-19a + M-19b | 12 | Over the cap. |
| M-28 + M-37, M-28 + M-45, M-26 + M-28 | 8–9 | Legal on hours, incoherent as one PR (search vs routing vs README vs mirror). Coherence beats count. |

## 🔒 Gate-backing tickets — never in the cut band

| Ticket | Gate |
|---|---|
| MRQ-36 (M-38 + M-39) | 12 — `check:skill-agent`, agent-only operation |
| MRQ-40 (M-45) | 14 — `check:readme`, self-host path executes |
| MRQ-42 (M-50 + M-56) | 3 and 16 — AC coverage; no secret or third-party material in the public repo |

## Cut-line order (BUILDPLAN §5 is the single rank authority)

The line runs up from the bottom of the **remaining band**, excluding the 🔒 set. Bottom-first: rank 28 **M-47** (in MRQ-39) → 27 **M-46** (in MRQ-28) → 25 M-44 (MRQ-39) → 24 M-43 (MRQ-37) → 23 M-42 (MRQ-38) → 22 M-41 (MRQ-37) → 21 M-40 (MRQ-24) → 18 M-37 (MRQ-35) → 17 M-36 (MRQ-34) → 16 M-35 / 15 M-34 / 12 M-31 (MRQ-32) → 14 M-33 (MRQ-25) → 13 M-32 (MRQ-33) → 11 M-30 (MRQ-31) → 10 M-53 (MRQ-33) → 9 M-52 (MRQ-38). **Rank ≤8 (the moat/API/mirror block) is protected; Tier A never yields; AC-233 is independently cuttable only when named.** Where a merged ticket straddles the line, the ticket ships its surviving half and gate 19 names the cut story with its rank, its ACs, and the reason.

## Contract deltas found at mint (orchestrator's call, folded and flagged)

1. **`USER_STORIES.md` Amendments 10 and 11 (AC-251, AC-252, AC-253) are not in `BUILDPLAN.md` v1.4** — the plan is folded through Amendment 9 only. `SPEC.md` names their homes explicitly, so they were folded per SPEC and tagged *Amendment fold* in every ticket that carries them: AC-251 → MRQ-33 (record evaluation panel, +1 h); AC-252/253 → MRQ-2 (schema), MRQ-4 (seed), MRQ-10 (Event Settings, +~1 h), MRQ-20 (agenda room headers), MRQ-22 (public "Room · Building"), MRQ-25 (ICS `LOCATION`). **`EVALUATION.md` has no §2 row for any of the three** — the validation plan opens rows for them from SPEC's text, and the contract owner should ratify.
2. **BUILDPLAN §9's CP-1 arithmetic omits M-07.** The stated critical chain is M-01 (3) → M-02 (4) → M-04a (2) → M-08 (4) = 13 h, but M-08 also depends on M-07, which is itself gated on M-02: M-01 (3) → M-02 (4) → M-07 (4) → M-08 (4) = **15 h**. CP-1 is D+15, not D+13, before any delegator overhead.
3. **"The seven client-signed objective budgets" resolves to six** *Proposed* rows in EVALUATION §1.3 plus AC-69's proposed Long-Tasks instrument. The validation plan treats all seven as measured-and-reported and AC-69's *completion* half as pass/fail.

