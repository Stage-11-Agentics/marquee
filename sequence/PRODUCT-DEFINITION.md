# Marquee — Product Definition (Phase-2 Proposal)

**Status:** DRAFT for Atin's review — the Phase-2 touchpoint of tone-initiation. Synthesizes all four research dossiers. Decisions marked ⬜ need your call; everything else I'm prepared to proceed on.
**Sources:** `research/competition-requirements.md` (R1–R50) · `research/stakeholders.md` (15 seats) · `research/user-stories-draft.md` (65 stories) · `research/landscape-features.md` (matrix, D1–D15) · `research/seams-feasibility.md` (limits, traps).

---

## 1. Positioning — the frame we compete under

**Marquee is the open-source program platform: everything Sessionize does that AIE actually uses, plus the post-acceptance workflow that made them shop for Sessionboard — self-hosted, owned, and fast.**

The landscape pass corrected our opening assumption: Sessionize costs **$499/event**, not $9,999 — AIE is not overpaying today, they were being *asked* to overpay 20× for the half Sessionize doesn't do. So the win is not price. The win is:

1. **The post-acceptance half** — speaker tasks, the chase dashboard, automated comms, calendar invites. Sessionize stops dead at acceptance; this is the actual reason AIE was shopping.
2. **Ownership** — the tweet's core grievance: *"enterprise saas we have never used and will never be able to customize."*
3. **Craft** — swyx's complaints are slow ×3, broken validation, insulting defaults, getting lost. The buyer isn't missing features; he's missing a tool that respects him.

**The one-thing candidate (→ PHILOSOPHY.md):** *Marquee respects the person running the program.* Speed is respect. Sane defaults are respect. Validation that works is respect. A dashboard that answers "who is behind?" in one glance is respect.

## 2. The moat — five fork-proof differentiators plus four force multipliers

The strongest competitor is a pretalx fork (mature, Apache-2.0, deployable in hours). It structurally cannot have, in a weekend:

| | Differentiator | R# | State of the art |
|---|---|---|---|
| M1 | **Abstracts vs Sessions** as first-class entities (sponsor path bypasses review) | R9 | Only Sessionboard |
| M2 | **Real-time outstanding-task dashboard** | R6 | **Nobody** — SB's answer is a filtered table + a Monday-7am digest |
| M3 | **Speaker task system** (action / file request / form, due dates) | R17, R49 | Only Sessionboard |
| M4 | **Calendar invites on schedule** (ICS METHOD:REQUEST + Google/Outlook links, update + cancel) | R3 | Market hole — SB has 26 email triggers and zero calendar |
| M5 | **Track swimlane view** | R5 | **Nobody** — the brief asks for it by name |

Force multipliers: **speed at ~1,000 seeded submissions** (R7/R46 — the emotional core); **zero dead ends in the 11-step walkthrough loop** (the rubric); **the judges' vocabulary** (Abstract, Evaluation plan, Portal, Task — the crib in landscape §5); **stack bonus** (Cloudflare + genuine two-way Airtable mirror — nobody in the field has it).

Craft fixes that read as respect: status change *is* the notification (SB makes it two separate acts); conditional logic with any-field triggers + cascading (SB's documented ceilings); live embeds (SB's are 60-min stale); submit-without-account + magic-link claim.

## 3. Scope — what we build by Wednesday

**Tier A (27 stories):** the walkthrough loop end-to-end — event setup → form builder (abstracts/sessions) → incognito submit → speaker portal (status/tasks/bio) → evaluation plan + committee → review queue → bulk accept → agenda (drag-drop, conflicts, 5 views incl. track swimlane) → public agenda + embed. Any step failing loses regardless of the rest.

**Tier B (ordered, ~18 stories):** chase dashboard → calendar invites → **admin quick-search (US-67)** → **Sessionize mid-CFP migration (US-66** — imports their Export spreadsheets, idempotent/re-runnable; Sessionize's API exposes accepted-only by default, so spreadsheet ingest is the honest path; "switch without losing your open CFP" is the strongest adoption argument we have**)** → templated rejection at scale → admin manual entry → un-accept cascade → automated trigger emails → filtered group email → conditional logic + routing → slide upload → co-speaker → speaker confirm → mobile reviewer/submit → README/deploy → AI toggle (off by default, never led with).

**Explicit SKIPs:** payment, multi-language, CRM/marketing/CMS, SMS, AI agenda, attendee app, ticketing, availability constraints, optimal reviewer assignment. Wiki "Speaker Handbook" page = cheap yes (brief #8). Embeds = build (video overrides strikethrough, pending Q2 ruling).

**Deferred but data-model-aware:** multi-round evaluation (single round ships, schema is round-aware — the brief says "across multiple rounds," this is the riskiest deferral, flagged), multi-event (modeled, one-event UI), waitlist status (cheap — statuses include it from day one).

## 4. Architecture bets (pending Discord rulings; details in seams dossier)

- **Cloudflare Workers + D1** source of truth; **R2** direct uploads; **KV** for cached public fragments; **Queues** for mirror + outbox. Whole AIE dataset ≈ 2–5 MB — it fits in cache; speed is a design property, not an optimization.
- **Genuine two-way Airtable mirror** (upsert outbound, webhook inbound, allowlisted fields), **never read on a request path**, with a visible Settings→Airtable sync page. Claims the bonus and the speed win simultaneously.
- **ICS METHOD:REQUEST** invites via Resend from `stage11.systems` (verified since March), SEQUENCE bumping + CANCEL from day one; OAuth documented as extension point (verified infeasible: 10+ day Google review).
- **Roll-our-own auth:** magic links for speakers, one-click demo logins for judges, reset-demo button. No third-party auth SaaS in a "Kill My SaaS" entry.
- **Outbox + demo-safe email mode** from the first commit (Resend free tier = 100/day vs 800 seeded speakers).

## 5. Demo strategy — the judge's ten seconds

Seeded replica of **AIE NYC 2026** (their real event, Oct 12–14, Sheraton NYT Square): ~1,000 realistic submissions, 150 accepted speakers, real formats (Workshop/Stage/Lightning/Online), 3 waves mid-CFP, vendor-policy routing rule, agenda with real tracks. Landing page: what it is, **[Enter as Organizer] [Enter as Speaker]**, no gate. README maps section-by-section to the walkthrough video. Token-spend evidence kept from day one ($500 reimbursement).

## 6. Decisions needed from you (⬜ = blocking soon, ○ = soon-ish)

1. ✅ **Philosophy signed** (Atin, 2026-08-08) with two additions: *"we enable fantastic conferences effortlessly"* (now the one-thing) and **agent-native by design** — a real API, a `marquee` CLI, and a shipped skill file so agents are first-class operators. → `PHILOSOPHY.md` minted at repo root. Scope note: for the competition this means a minimal clean REST API (the UI rides on it anyway), a thin CLI, and a SKILL.md — Tier B additions that must not eat the walkthrough loop; also a distinctive differentiator for *this* judge (the AI Engineer team).
2. ✅ **Rounds** (Atin, interview 2026-08-08): minimal 2-round funnel UI committed high in Tier B; round-aware schema from day one. Remaining scope tiers stand as proposed.
3. ✅ **Stack** (Atin, interview): Cloudflare + D1 + two-way Airtable mirror as specified in §4, committed without waiting on the Q1 ruling.
4. ✅ **Repo/license** (Atin, interview): private on Forgejo now; public GitHub `marquee` + **Apache-2.0** pushed near submission (~Tuesday); strategy docs curated before the flip.
5. ○ **Public name:** is "Marquee" the submission name? (Check collisions before the public push.)
6. ✅ **Domain** (Atin, interview): stage11 infra only — `marquee.stage11.dev` + `marquee@stage11.systems`. Deadline-trap 5 closed; account-check 4 dropped.
7. ○ **Sessionize Comparison-mode triage** (rank 3 at a time) as a round-1 option — the landscape pass's favorite steal (L2). In or post-competition?

**Still open externally:** Discord relay (videos + Q1/Q2), five account checks (Workers Paid, R2 entitlement, Resend tier, Airtable plan, domain).

## 7. What happens next

On your sign-off: Phase 3 — I mint `PHILOSOPHY.md` and consolidate the 65-story corpus into `sequence/USER_STORIES.md` with stable AC IDs (the walkthrough loop as the spine), you review (Phase 4), then we invoke **tone-prototype**: three HTML directions on realistic AIE-scale mock data — my working hypothesis for the three core assumptions: (a) *the ops chase dashboard is the home surface*, (b) *the agenda builder is the home surface*, (c) *the lifecycle pipeline (CFP→review→accept→schedule) is the home surface*. To be pinned down with you at prototype kickoff.
