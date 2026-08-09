# Marquee — 2025 Seed-Data Source

**Purpose:** ground Marquee's public demo in AIE's *real* event data, so the deployed site a judge opens is a faithful replica of **AI Engineer New York 2026** (Oct 12–14, 2026, Sheraton New York Times Square) rather than a lorem-ipsum shell. Feeds the seed generator that will fabricate ~1,000 realistic submissions statistically shaped like the real program, with the real 2025 program as the **accepted core**.

**Maintainer:** Seed Source agent (Marquee Initiation → Seed Source)
**Captured:** 2026-08-08. All sources public; every URL cited in [§11](#11-sources).

## Update log

| When | What landed |
|---|---|
| 2026-08-08 | Both 2025 NYC candidates researched; **Feb 2025 Summit chosen** as primary seed source. Full 76-item program grid recovered structurally (not by scraping rendered text) from the schedule page's `__NEXT_DATA__` payload → `sources/aie-summit-2025-program.json`, scrubbed of speaker emails and headshot URLs at capture time. Code Summit Nov 2025 captured as secondary structural cross-check (89-name roster, 4-day shape, sponsor tiers). |

---

## 1. Verdict — which 2025 event is the analog

**Primary seed source: AI Engineer Summit NYC, Feb 19–22, 2025, The Times Center.**
Secondary cross-check: AI Engineer CODE Summit, Nov 19–22, 2025, The Times Center.

AIE's own NYC 2026 page settles this. It lists both 2025 events under "Past NYC Conferences" and describes the February one as *"Agent Engineering — **the flagship AI Engineer Summit held in NYC**"*, while CODE is *"Held in NYC in 2025 — featuring Google DeepMind, Anthropic, Cursor, Netflix…"*. The 2026 CFP's own "past speakers & attendees" carousel is drawn mostly from **February 2025** — John Crepezzi (Jane Street), Will Brown (then Morgan Stanley), Grace Isford (Lux Capital), Anju Kambadur (Bloomberg) all spoke on the Feb 2025 stage — and the 2026 CFP text explicitly anchors its vendor policy to *"AIE NYC 2025."*

| | **AIE Summit NYC — Feb 19–22, 2025** ✅ | AIE CODE Summit — Nov 19–22, 2025 |
|---|---|---|
| Lineage to AIE NYC 2026 | Direct — the flagship NYC event, same series | Sibling event, separate franchise |
| Budget line (§6.2 of requirements dossier) | **AIE New York ≈150** — same line as the $9,999 NYC 2026 pilot | AIE Code Summit ≈75 — a different line |
| Theme fit | *"Agents at Work,"* explicitly finance-forward: Jane Street, BlackRock, Bloomberg, Morgan Stanley, Method Financial, Writer (financial scenarios), Pfizer | AI coding agents — no finance thread |
| 2026 theme | **"Where AI Engineering Meets Wall Street"** — AI in Financial Services | — |
| Session-level program published | **Yes** — 76 grid items with times, rooms, tracks, formats, abstracts, speaker titles/companies, recordings | **No** — roster and day shape only; no session grid was ever published |
| Venue | The Times Center | The Times Center |

**Why it matters that Feb 2025 published a real grid:** it is the only AIE NYC event with a machine-readable, session-level program. That grid *is* the accepted core — **60 speaker-bearing sessions** with real titles, real speakers, real durations, real rooms, real conflict-inducing overlaps. Nothing else in AIE's public surface gives the schedule builder (R5) or the conflict detector real data to chew on.

**Where Feb 2025 falls short, CODE 2025 fills in:** Feb 2025 fielded 75 speakers; NYC 2026 targets ~150 (budget) / "100+ top industry speakers" (site). CODE 2025's 89-name roster ([§7](#7-secondary-source--aie-code-summit-nov-19-22-2025)) supplies a second, non-overlapping pool of real, public, AIE-vetted names to scale the accepted core toward 2026's size without inventing people out of thin air.

---

## 2. The 2026 event we are replicating

Everything below is what the seeded demo's **event settings** (R10) and **agenda** (R5) should read.

| Field | Value |
|---|---|
| Name | AI Engineer New York 2026 |
| Tagline | "Where AI Engineering Meets Wall Street" |
| Dates | **October 12–14, 2026** (Mon–Wed) |
| Venue | Sheraton New York Times Square Hotel, Midtown Manhattan |
| In-person | 1,000+ (CFP page says "over 1,500 AI engineers, researchers, and founders") |
| Remote | 150K+ livestream; 1.5M+ unique viewers worldwide |
| Speakers | "100+ top industry speakers" (site) · **~150** (AIE's internal budget line) |
| Mainstage focus track | The rising role of **AI in Financial Services**, "alongside evergreen discussions on evals and infra" |
| Day 1 (Oct 12) | **Deep Dives & Welcome Reception** — hands-on technical workshops across the day; first access to expo floor; welcome reception |
| Day 2 (Oct 13) | **Full-Day Keynotes, Talks, and Networking** — keynotes and sessions, Expo Sessions, breakouts, leadership programming, expo open all day |
| Day 3 (Oct 14) | **Full-Day Keynotes, Talks, and Closing Programming** — keynotes and sessions, Expo Sessions, final expo access |

### 2.1 Session formats (verbatim from the 2026 CFP — these are Marquee's format enum)

| Format | Duration | Description (verbatim) |
|---|---|---|
| **Stage Talk** | 15–20 min | "Keynotes, live demos, and paper presentations. **Most talks are this format.**" |
| **Workshop** | 1–2 hours | "Hands-on sessions or technical deep dives." |
| **Lightning Talk** | 5–10 min | "Launches, hot takes, and fun rants." |
| **Online Talk** | 5–55 min | "Very free form, no IRL stress, same exposure online." |

### 2.2 CFP timeline and policy (2026)

| Field | Value |
|---|---|
| CFP opens | Jul 17, 2026 |
| **Wave 1 acceptances** | **Aug 15, 2026** |
| **Wave 2 acceptances** | **Sep 1, 2026** |
| CFP closes | Sep 12, 2026, 11:59 PM |
| Final wave | Sep 15, 2026 |
| Acceptance rate | *"a highly competitive process with a historical acceptance rate of **5–15%**"* |
| Review | "every proposal receives human review" |
| Multiple proposals | "Multiple submissions are welcome" (AIE Code Summit used a cap of 3) |
| Vendor policy | *"Mainstage keynotes are strictly non-vendor — an anti-sales-pitch policy that does not apply to workshops, leadership, expo, or booth sessions."* Plus: *"If you are not technically in financial services, but sell tooling to FIs, we encourage you to recommend a top customer/champion to speak instead."* |
| Speaker benefits | Free pass; economy flights; hotel **2 nights domestic / 3 nights international**; professional recording published to YouTube, X, LinkedIn |

> **Seed consequence:** the demo's clock should sit *mid-CFP with Wave 1 already dispatched* — that is the only state in which R43 (multi-wave rolling acceptance), R16 (speaker sees status), R6 (outstanding-task dashboard) and R4 (multi-round evaluation) are all simultaneously alive on screen. A judge landing on a fully-closed, fully-decided event sees a museum; a judge landing pre-CFP sees an empty database.

### 2.3 Rooms for the 2026 replica

Feb 2025's real rooms are Times Center rooms and will read as wrong against a Sheraton-branded 2026 event. **Recommendation: keep 2025's sessions and speakers, but re-home them into Sheraton-plausible rooms.** Verified Sheraton New York Times Square function spaces (from Marriott/Cvent):

| Room | Verified detail | Suggested demo use |
|---|---|---|
| **Metropolitan Ballroom** | 13,768 sq ft, up to 2,500 guests; opens into Central Park Ballroom | Mainstage / keynotes |
| **Central Park Ballroom** | Adjoins Metropolitan | Breakout track 2 |
| **New York Ballroom** | 8,715 sq ft, up to 1,200 guests | Breakout track 3 / Leadership |
| *(unnamed)* Expo floor | 60,000 sq ft over 43 meeting rooms total | Expo Stage |
| *(unnamed)* Workshop rooms A–E | — | Day-1 parallel workshops |

Only the three named ballrooms and the aggregate figures are verified; **do not invent further specific Sheraton room names as if sourced** — label the rest generically ("Workshop Room A", "Expo Stage") in the seed.

---

## 3. Program structure of the seed source (Feb 19–22, 2025)

Recovered structurally from the schedule page's embedded JSON, so counts here are exact, not eyeballed.

### 3.1 Shape

| | |
|---|---|
| Days | **4** (Wed evening reception → Thu → Fri → Sat) |
| Grid items | **76** |
| Items typed `TALK` or `WORKSHOP` | **60** |
| …of which have ≥1 named speaker | 57 |
| Items typed `OTHER` that are actually workshops with named speakers | 3 † |
| **Real content sessions (speaker-bearing) — the accepted core** | **60** |
| Non-content items (registration, breaks, lunch, receptions) | 16 |
| Unique speakers | **75** |
| Unique companies | **58** |
| Sessions with a published recording link | 29 |
| Sessions with a published abstract | 59 / 76 (avg ~594 characters) |
| Rooms | **8 distinct**, across **4 buildings** |

† **A real data-hygiene defect in AIE's own CMS, and a free feature idea.** Three genuine Saturday workshops — Anthropic's *Building (Agents) with Model Context Protocol*, Pydantic's *An Opinionated Blueprint for the Future of GenAI Applications*, and Letta's *Agent Memory and the LLM OS* — carry `type: OTHER` instead of `WORKSHOP` in the published data, sitting alongside coffee breaks in the same bucket. A tool that let an organizer see "3 sessions have a named speaker but no session format" would have caught this. Worth seeding **one or two deliberately malformed records** so Marquee's validation (R14 — *"looks like it doesn't even have full validation"*) has something honest to flag on a live screen.

### 3.2 Tracks

Track names as AIE published them (`trackName` in the source data):

| Track | Items | What it is |
|---|---|---|
| **Agent Engineering** | 18 | Fri mainstage — engineering track |
| **AI Leadership** | 17 | Thu mainstage — CTO/VP-of-AI track. AIE's own copy: *"Our highest reviewed track."* |
| **Plenary** | 16 | Registration, breaks, lunch, receptions, welcomes |
| **Workshops** | 16 | Sat parallel workshops (13 workshops + 3 break items) |
| **Expo Stage** | 7 | Vendor/sponsor sessions in the expo, run *during* mainstage breaks |
| **Online** | 2 | Sat livestream-only talks |

### 3.3 Rooms

| Room | Items | Building |
|---|---|---|
| TimesCenter Theater | 47 | The Times Center (mainstage, Thu + Fri) |
| TimesCenter Expo | 7 | The Times Center (expo stage) |
| Jay Suites A & B — 109 W 39th, 2nd floor | 7 | Jay Suites (Sat workshops) |
| Jay Suites C — 109 W 39th, 2nd floor | 5 | Jay Suites (Sat workshops) |
| AWS JFK27 (12 W 39th St) 200/201 | 4 | AWS office (Sat workshops) |
| AWS JFK27 (12 W 39th St) 300/301 | 2 | AWS office (Sat workshops) |
| Jay Suites Sydney — 109 W 39th, 2nd floor | 2 | Jay Suites (Sat workshops) |
| AIE Youtube | 2 | Online track |

> **Conflict-detection gold.** Saturday runs **5 rooms in parallel across 3 physical buildings**, and Thursday/Friday run the Expo Stage *concurrently with* the mainstage break. That is exactly the shape R5's cross-room/cross-track conflict detector needs to have something real to detect. Do not flatten it.

### 3.4 Day × track matrix

| Day | Track | Items |
|---|---|---|
| Wed Feb 19 | Plenary | 1 |
| Thu Feb 20 | AI Leadership | 17 |
| Thu Feb 20 | Plenary | 6 |
| Thu Feb 20 | Expo Stage | 1 |
| Fri Feb 21 | Agent Engineering | 18 |
| Fri Feb 21 | Expo Stage | 6 |
| Fri Feb 21 | Plenary | 5 |
| Sat Feb 22 | Workshops | 16 |
| Sat Feb 22 | Plenary | 4 |
| Sat Feb 22 | Online | 2 |

### 3.5 Timing grid — block lengths and cadence

The single most transferable structure in this document. Times are local (ET).

**Thu Feb 20 — Leadership day**

| Time | Block |
|---|---|
| 08:00–09:00 | Registration & Breakfast (60m) |
| 09:00–09:07 | AI Leadership Welcome (7m, no named speaker) |
| 09:07–10:30 | 4 × talks, **20 min each on a 21-minute pitch** (09:07, 09:28, 09:49, 10:10) |
| 10:30–11:00 | Break (30m) — *Expo Stage runs 10:35–11:00 during it* |
| 11:00–12:24 | 4 × talks on the same 21-minute pitch |
| 12:24–13:15 | Lunch (60m listed, 51m actual gap) |
| 13:15–15:30 | 1 × 25m panel + 4 × 20m talks |
| 15:30–16:00 | Break (30m) |
| 16:00–17:00 | 3 × 20m talks |
| 17:00–19:00 | Onsite Reception and Networking, all tracks (120m) |

**Fri Feb 21 — Agent Engineering day**

| Time | Block |
|---|---|
| 08:00–09:00 | Registration & Breakfast (60m) |
| 09:00–09:15 | Opening keynote, 15m (swyx, "Why Agent Engineering") |
| 09:15–11:00 | 5 × talks, **19–20 min on a 20-minute pitch** |
| 11:00–11:30 | Break (30m) — *2 × 12m Expo Stage talks run inside it* |
| 11:30–13:00 | 4 × 19–20m talks |
| 13:00–14:00 | Lunch (60m) — *3 × 14m Expo Stage talks run inside it* |
| 14:00–15:20 | 4 × 19–20m talks |
| 15:20–15:50 | Break (30m) — *Expo Stage panel 15:25* |
| 16:00–17:00 | 3 × 19m talks |
| 17:00–18:00 | Doors close + hallway networking (60m) |

**Sat Feb 22 — Workshops + Online**

| Time | Block |
|---|---|
| 09:00–10:00 | Workshop Day and Online Track Welcome (60m, meet & mingle) |
| 10:00–12:00 | 2 × **120-minute** flagship workshops in parallel (OpenAI, Anthropic MCP) |
| 09:35 / 10:00 | Online track: 2 × 25m talks on the AIE YouTube channel |
| 12:00–12:30 | Lunch (30m) |
| 12:30–14:15 | 5 × workshops in parallel — 2 × **105m**, 3 × **80m** |
| 14:15–14:30 | Break (15m) |
| 14:30–15:50 | 4 × **80m** workshops in parallel |
| 15:50–16:10 | Afternoon Break (20m) |
| 16:10–17:30 | 5 × **80m** workshops in parallel |

**Rules extractable from the grid:**

- Mainstage talk slot = **20 min** (Leadership) / **19–20 min** (Engineering), back-to-back with a 0–1 min turnover. No on-stage Q&A.
- Breaks: **30 min** mid-morning and mid-afternoon; **60 min** lunch on session days, **30 min** on workshop day.
- Days open **08:00** (registration/breakfast), first content **09:00**, last content ends **17:00**.
- Expo Stage sessions are **12–30 min** and deliberately scheduled *inside* mainstage breaks and lunch — never opposite a mainstage talk.
- Workshops are **80 min standard**, with **105/120 min** reserved for flagship partner sessions (OpenAI, Anthropic).
- A day-opening welcome/keynote is short: **7–15 min**.

### 3.6 Duration distribution by track (content sessions only)

| Track | Durations observed | n |
|---|---|---|
| AI Leadership | 20m ×16, 25m ×1 | 17 |
| Agent Engineering | 19m ×17, 15m ×1 | 18 |
| Workshops | 80m ×10, 105m ×2, 120m ×1 | 13 |
| Expo Stage | 12m ×2, 14m ×3, 25m ×1, 30m ×1 | 7 |
| Online | 25m ×2 | 2 |

### 3.7 Speakers per session

Across all 60 speaker-bearing sessions:

| Speakers | Sessions | Share |
|---|---|---|
| 1 | 45 | 75% |
| 2 | 14 | 23% |
| 4 | 1 | 2% — the "Agentic Future of Search" expo panel |

(3 further grid items — the plenary welcomes — carry no named speaker at all.)

**Mean 1.28 speakers per session.** Directly answers R15/R30: the sane default is **min 1, max ~4** speakers per submission — and confirms swyx's complaint at [06:46] that a minimum of 2 was "stupid."

---

## 4. The full Feb 2025 program

All 76 grid items, exactly as AIE published them. Machine-readable copy (with abstracts, recording links, company URLs, and speaker bios) lives at `sequence/research/sources/aie-summit-2025-program.json` — **already scrubbed of the speaker email addresses and headshot URLs that were present in the source payload** (see [§9](#9-do-not-replicate)).

### Wed Feb 19, 2025

| Start | End | Min | Track | Type | Room | Title | Speakers (name / title / company) | Rec |
|---|---|---|---|---|---|---|---|---|
| 17:00 | 19:00 | 120 | Plenary | OTHER | TimesCenter Theater | Leadership Track Welcome Reception | — |  |

### Thu Feb 20, 2025

| Start | End | Min | Track | Type | Room | Title | Speakers (name / title / company) | Rec |
|---|---|---|---|---|---|---|---|---|
| 08:00 | 09:00 | 60 | Plenary | OTHER | TimesCenter Theater | Registration & Breakfast | — |  |
| 09:00 | 09:07 | 7 | Plenary | TALK | TimesCenter Theater | AI Leadership Welcome | — |  |
| 09:07 | 09:27 | 20 | AI Leadership | TALK | TimesCenter Theater | Beyond the Consensus: Navigating AI’s Frontier in 2025 | Grace Isford / Partner / Lux Capital | Y |
| 09:28 | 09:48 | 20 | AI Leadership | TALK | TimesCenter Theater | How To Build an AI Strategy That Fails   | Hamel Husain / Founder / Parlance Labs; Greg Ceccarelli / Co-Founder / SpecStory | Y |
| 09:49 | 10:09 | 20 | AI Leadership | TALK | TimesCenter Theater | Balancing Innovation with Security & Safety | Don Bosco Durai / Co-founder and CTO / Privacera | Y |
| 10:10 | 10:30 | 20 | AI Leadership | TALK | TimesCenter Theater | Building Self-Coding Agents | Colin Flaherty / Founding Researcher / Augment Code | Y |
| 10:30 | 11:00 | 30 | Plenary | OTHER | TimesCenter Theater | Break | — |  |
| 10:35 | 11:00 | 25 | Expo Stage | TALK | TimesCenter Expo | Mistral for VPs of AI | Baptiste Rozière / Researcher / Mistral; Leigh Pember / Strategy / Mistral |  |
| 11:00 | 11:20 | 20 | AI Leadership | TALK | TimesCenter Theater | Anchoring Enterprise GenAI with Knowledge Graphs | Stephen Chin / VP of Developer Relations / Neo4j; Jonathan Lowe / Senior Director, Operations & Insights / Pfizer | Y |
| 11:21 | 11:41 | 20 | AI Leadership | TALK | TimesCenter Theater | Building AI Agents with Real ROI in the Enterprise SDLC | Bruno Passos / Developer Experience & GenAI Innovation Lead / Booking.com; Beyang Liu / Co-Founder and CTO / Sourcegraph | Y |
| 11:42 | 12:02 | 20 | AI Leadership | TALK | TimesCenter Theater | Building Trust in Enterprise AI: Evaluating Domain-Specific LLMs for Real-World Financial Scenarios | Waseem Alshikh / Co-Founder & CTO / Writer | Y |
| 12:03 | 12:23 | 20 | AI Leadership | TALK | TimesCenter Theater | OpenAI for VPs of AI | Prashant Mital / Member of Technical Staff / OpenAI; Toki Sherbakov / Head of Solutions Architecture / OpenAI |  |
| 12:24 | 13:24 | 60 | Plenary | OTHER | TimesCenter Theater | Lunch | — |  |
| 13:15 | 13:40 | 25 | AI Leadership | TALK | TimesCenter Theater | Frontier Feud | Barr Yaron / Partner / Amplify Partners | Y |
| 13:45 | 14:05 | 20 | AI Leadership | TALK | TimesCenter Theater | Missing pieces of workflow automation | Shirsha Chaudhuri  / Director of Engineering / Thomson Reuters | Y |
| 14:06 | 14:26 | 20 | AI Leadership | TALK | TimesCenter Theater | Ensure AI Agents Work: Evaluation Frameworks for Scaling Success | Aparna Dhinkaran / Founder & CPO / Arize | Y |
| 14:27 | 14:47 | 20 | AI Leadership | TALK | TimesCenter Theater | The Devops Engineer Who Never Sleeps | Diamond Bishop / Director of Engineering/AI / Datadog | Y |
| 14:48 | 15:08 | 20 | AI Leadership | TALK | TimesCenter Theater | How to Build Your Own AI Data Center in 2025 | Paul Gilbert / Technical Lead / Arista Networks | Y |
| 15:08 | 15:28 | 20 | AI Leadership | TALK | TimesCenter Theater | Anthropic for VPs of AI | Alexander Bricken / Member of Technical Staff / Anthropic; Joe Bayley / GTM - Enterprise / Anthropic | Y |
| 15:30 | 16:00 | 30 | Plenary | OTHER | TimesCenter Theater | Break | — |  |
| 16:00 | 16:20 | 20 | AI Leadership | TALK | TimesCenter Theater | Insights on Building AI teams | Heath Black / Managing Director, Product / SignalFire | Y |
| 16:21 | 16:41 | 20 | AI Leadership | TALK | TimesCenter Theater | Lessons from Building LinkedIn's GenAI Platform | Xiaofeng Wang / Engineering Manager, Generative AI Foundations / LinkedIn | Y |
| 16:42 | 17:02 | 20 | AI Leadership | TALK | TimesCenter Theater | Specialized RAG Agents: Lessons learned from deploying complex AI systems in production | Douwe Kiela / CEO & Co-Founder / Contextual AI | Y |
| 17:00 | 19:00 | 120 | Plenary | OTHER | TimesCenter Theater | Onsite Reception and Networking (open to all tracks) | — |  |

### Fri Feb 21, 2025

| Start | End | Min | Track | Type | Room | Title | Speakers (name / title / company) | Rec |
|---|---|---|---|---|---|---|---|---|
| 08:00 | 09:00 | 60 | Plenary | OTHER | TimesCenter Theater | Registration & Breakfast | — |  |
| 09:00 | 09:15 | 15 | Agent Engineering | TALK | TimesCenter Theater | Why Agent Engineering | swyx / Editor / Latent.Space |  |
| 09:15 | 09:34 | 19 | Agent Engineering | TALK | TimesCenter Theater | Building and evaluating AI Agents That Matter | Sayash Kapoor / Author / AI Snake Oil | Y |
| 09:35 | 09:54 | 19 | Agent Engineering | TALK | TimesCenter Theater | Going deep on Gemini Deep Research |  Mukund Sridhar / Staff ML SWE / TLM / DeepMind; Aarush Selvan / Product Manager / Google Gemini |  |
| 09:55 | 10:14 | 19 | Agent Engineering | TALK | TimesCenter Theater | How We Build Effective Agents | Barry Zhang / Member of Technical Staff / Anthropic | Y |
| 10:15 | 10:34 | 19 | Agent Engineering | TALK | TimesCenter Theater | Sierra’s Agent Development Life Cycle | Zack Reneau-Wedeen / AI Product Manager / Sierra |  |
| 10:35 | 10:54 | 19 | Agent Engineering | TALK | TimesCenter Theater | What RL Means for Agents | Will Brown / Researcher / Morgan Stanley | Y |
| 11:00 | 11:12 | 12 | Expo Stage | TALK | TimesCenter Expo | Are reasoning models better LLM judges? | Alex Volkov / AI Evangelist / Weights & Biases |  |
| 11:00 | 11:30 | 30 | Plenary | OTHER | TimesCenter Theater | Break | — |  |
| 11:15 | 11:27 | 12 | Expo Stage | TALK | TimesCenter Expo | How do you know your agent works? | Evan Fossier  / Senior Software Engineer / Datadog; Joey Pinhas / Senior Software Engineer / Datadog |  |
| 11:30 | 11:49 | 19 | Agent Engineering | TALK | TimesCenter Theater | Agents in Investment Management: Aladdin Copilot | Brennan Rosales / Vice President, AI Engineering / BlackRock |  |
| 11:50 | 12:09 | 19 | Agent Engineering | TALK | TimesCenter Theater | Building AI-Powered Developer Tools at Jane Street | John Crepezzi / Software Engineer / Jane Street | Y |
| 12:10 | 12:29 | 19 | Agent Engineering | TALK | TimesCenter Theater | Challenges to Scaling Agents for Generative AI Products | Anju Kambadur / Head of AI Engineering / Bloomberg  | Y |
| 12:30 | 12:49 | 19 | Agent Engineering | TALK | TimesCenter Theater | Trust, but Verify: High-Fidelity Reasoning in Agentic Workflows | Mike Conover / Founder & CEO / Brightwave | Y |
| 13:00 | 14:00 | 60 | Plenary | OTHER | TimesCenter Theater | Lunch | — |  |
| 13:05 | 13:19 | 14 | Expo Stage | TALK | TimesCenter Expo | Evaluate This! Mitigating Hallucinations in RAG & AI Agents with Galileo | Atin Sanyal / Co-founder & CTO / Galileo; Erin Mikail / Senior DX Engineer / Galileo |  |
| 13:21 | 13:35 | 14 | Expo Stage | TALK | TimesCenter Expo | Path towards 100% Accurate & Repeatable Data Agents for AI | Praveen Durairaju / Field CTO / Hasura |  |
| 13:37 | 13:51 | 14 | Expo Stage | TALK | TimesCenter Expo | Supercharge Your SDLC: How AI Agents are Revolutionizing Software Development Abstract | Beyang Liu / Co-Founder and CTO / Sourcegraph |  |
| 14:00 | 14:19 | 19 | Agent Engineering | TALK | TimesCenter Theater | Agents are built at the fringe: getting from 90 to 100 | Kevin Hou / Head of Product Engineering / Windsurf | Y |
| 14:20 | 14:39 | 19 | Agent Engineering | TALK | TimesCenter Theater | How we scaled 500m AI agents in production with 2 engineers | Mustafa Ali / Senior Software Engineer / Method Financial; Kyle Corbitt / Founder & CEO / OpenPipe | Y |
| 14:40 | 14:59 | 19 | Agent Engineering | TALK | TimesCenter Theater | Voice AI: Your Bot Isn't Special | Nik Caryotakis / Staff Software Engineer / SuperDial | Y |
| 15:00 | 15:19 | 19 | Agent Engineering | TALK | TimesCenter Theater | Scaffold Wisely | Rahul Sengottuvelu / Head of Applied AI / Ramp | Y |
| 15:20 | 15:50 | 30 | Plenary | OTHER | TimesCenter Theater | Break | — |  |
| 15:25 | 15:55 | 30 | Expo Stage | TALK | TimesCenter Expo | The Agentic Future of Search | Dylan Babbs / CTO / Profound; Colin Sidoti  / CEO / Clerk; Anirudh Kamath / Tech Lead / Browserbase; Gopal Raman / Principal / South Park Commons |  |
| 16:00 | 16:19 | 19 | Agent Engineering | TALK | TimesCenter Theater | Creating Agents That Co-Create | Karina Nguyen / Member of Technical Staff / OpenAI | Y |
| 16:20 | 16:39 | 19 | Agent Engineering | TALK | TimesCenter Theater | Building Perfect Memory | Maria de Lourdes Zollo / CoFounder & CEO / Bee.Computer; Ethan Sutin / CTO / Bee.Computer |  |
| 16:20 | 16:39 | 19 | Agent Engineering | TALK | TimesCenter Theater | Tools for the Next Generation of AI Engineers | Stefania Druga  / Research Scientist, Gemini / Google | Y |
| 16:40 | 16:59 | 19 | Agent Engineering | TALK | TimesCenter Theater | What does it take to build a personal, local, private AI Agent that augments you deeply? | Soumith Chintala / Co-founder / Meta PyTorch | Y |
| 17:00 | 18:00 | 60 | Plenary | OTHER | TimesCenter Theater | Doors close | — |  |

### Sat Feb 22, 2025

| Start | End | Min | Track | Type | Room | Title | Speakers (name / title / company) | Rec |
|---|---|---|---|---|---|---|---|---|
| 09:00 | 10:00 | 60 | Plenary | WORKSHOP | Jay Suites C - 109 W 39th 2nd floor | Workshop Day and Online Track Welcome | — |  |
| 09:35 | 10:00 | 25 | Online | TALK | AIE Youtube | Challenges of Building Agents | Chip Huyen / Author, AI Engineering / Independent |  |
| 10:00 | 10:25 | 25 | Online | TALK | AIE Youtube | The Ideal AI Engineering Platform | Erik Bernhardsson / CEO / Modal Labs |  |
| 10:00 | 12:00 | 120 | Workshops | WORKSHOP | Jay Suites A & B - 109 W 39th 2nd floor | Function calling is all you need: Building with OpenAI 4o/o1/o3/Realtime | Ilan Bigio / Developer Experience Engineer / OpenAI |  |
| 10:00 | 12:00 | 120 | Workshops | OTHER | Jay Suites C - 109 W 39th 2nd floor | Building (Agents) with Model Context Protocol | Mahesh Murag / Member of Technical Staff / Anthropic |  |
| 12:00 | 12:30 | 30 | Plenary | OTHER | Jay Suites A & B - 109 W 39th 2nd floor | Workshop day Lunch | — |  |
| 12:30 | 13:50 | 80 | Workshops | WORKSHOP | AWS JFK27 (12 W 39th St) 200/201 - entrance 39th St & 5th Ave, large gold doors, bring ID | Flow Engineering 101 | Minki Jung / AI Engineer / Independent |  |
| 12:30 | 13:50 | 80 | Workshops | WORKSHOP | AWS JFK27 (12 W 39th St) 300/301 - entrance 39th St & 5th Ave, large gold doors, bring ID | AI in production: Observe, Compile, Eval | Alex Volkov / AI Evangelist / Weights & Biases |  |
| 12:30 | 14:15 | 105 | Workshops | WORKSHOP | Jay Suites A & B - 109 W 39th 2nd floor | Smarter AI with GraphRAG – Connecting Structured & Unstructured Data for Better Retrieval | Alison Cossette / Data Science Strategist, Advocate, Educator / Neo4j |  |
| 12:30 | 14:15 | 105 | Workshops | WORKSHOP | Jay Suites C - 109 W 39th 2nd floor | Solana Lets Agents Create Wealth | Noah Gundotra / Product Engineer / Solana |  |
| 14:15 | 14:30 | 15 | Plenary | OTHER | Jay Suites A & B - 109 W 39th 2nd floor | Workshop Day Break | — |  |
| 14:30 | 15:50 | 80 | Workshops | WORKSHOP | AWS JFK27 (12 W 39th St) 200/201 - entrance 39th St & 5th Ave, large gold doors, bring ID | Building Agentic Workflows with DeepSeek and Amazon Nova | Deepam Mishra / Sr Advisor, AI/ML Startups / AWS; Karan Singh / Generative AI PM / AWS |  |
| 14:30 | 15:50 | 80 | Workshops | WORKSHOP | AWS JFK27 (12 W 39th St) 300/301 - entrance 39th St & 5th Ave, large gold doors, bring ID | Build a personal AI email agent | Mahmoud Abdelwahab / Senior Developer Advocate / Neon |  |
| 14:30 | 15:50 | 80 | Workshops | OTHER | Jay Suites A & B - 109 W 39th 2nd floor | An Opinionated Blueprint for the Future of GenAI Applications | Samuel Colvin  / Founder & CEO / Pydantic Logfire |  |
| 14:30 | 15:50 | 80 | Workshops | WORKSHOP | Jay Suites C - 109 W 39th 2nd floor | Open ML Universe: Models, Agents, and Beyond | Omar Sanseviero / Gemma Tech Lead / DeepMind |  |
| 14:30 | 15:50 | 80 | Workshops | WORKSHOP | Jay Suites Sydney - 109 W 39th 2nd floor | How Clay Performs Agent Evaluation | Nick Huang / FDE / LangChain; Ratch Sujithan / AI Engineer / Clay GTM |  |
| 15:50 | 16:10 | 20 | Plenary | WORKSHOP | Jay Suites A & B - 109 W 39th 2nd floor | Workshop Afternoon Break | — |  |
| 16:10 | 17:30 | 80 | Workshops | OTHER | AWS JFK27 (12 W 39th St) 200/201 - entrance 39th St & 5th Ave, large gold doors, bring ID | Agent Memory and the LLM OS | Charles Packer / Co-Founder & CEO / Letta |  |
| 16:10 | 17:30 | 80 | Workshops | WORKSHOP | AWS JFK27 (12 W 39th St) 200/201 - entrance 39th St & 5th Ave, large gold doors, bring ID | Agentic RAG with Vision Language Models | Suman Debnath / — / AWS |  |
| 16:10 | 17:30 | 80 | Workshops | WORKSHOP | Jay Suites A & B - 109 W 39th 2nd floor | From Guesswork to Metrics : Systematically improving your RAG system | Ivan Leo / Research Engineer / 567 Labs (Instructor); Jason Liu / Consultant (Instructor) / Independent |  |
| 16:10 | 17:30 | 80 | Workshops | WORKSHOP | Jay Suites C - 109 W 39th 2nd floor | Advanced AI Engineering with AI SDK | Nico Albanese / AI SDK Maintainer / Vercel |  |
| 16:10 | 17:30 | 80 | Workshops | WORKSHOP | Jay Suites Sydney - 109 W 39th 2nd floor | Multi-Agent Workflows with MCP | Dan Mason / Principal, AI / Stride |  |

---

## 5. Speaker roster — Feb 2025 (75 people)

Names, titles, and companies exactly as AIE published them on the public schedule.

| # | Speaker | Title | Company | Track(s) | Session(s) |
|---|---|---|---|---|---|
| 1 | Mahmoud Abdelwahab | Senior Developer Advocate | Neon | Workshops | Build a personal AI email agent |
| 2 | Nico Albanese | AI SDK Maintainer | Vercel | Workshops | Advanced AI Engineering with AI SDK |
| 3 | Mustafa Ali | Senior Software Engineer | Method Financial | Agent Engineering | How we scaled 500m AI agents in production with 2 engineers |
| 4 | Waseem Alshikh | Co-Founder & CTO | Writer | AI Leadership | Building Trust in Enterprise AI: Evaluating Domain-Specific LLMs for Real-World Financial Scenarios |
| 5 | Dylan Babbs | CTO | Profound | Expo Stage | The Agentic Future of Search |
| 6 | Joe Bayley | GTM - Enterprise | Anthropic | AI Leadership | Anthropic for VPs of AI |
| 7 | Erik Bernhardsson | CEO | Modal Labs | Online | The Ideal AI Engineering Platform |
| 8 | Ilan Bigio | Developer Experience Engineer | OpenAI | Workshops | Function calling is all you need: Building with OpenAI 4o/o1/o3/Realtime |
| 9 | Diamond Bishop | Director of Engineering/AI | Datadog | AI Leadership | The Devops Engineer Who Never Sleeps |
| 10 | Heath Black | Managing Director, Product | SignalFire | AI Leadership | Insights on Building AI teams |
| 11 | Alexander Bricken | Member of Technical Staff | Anthropic | AI Leadership | Anthropic for VPs of AI |
| 12 | Will Brown | Researcher | Morgan Stanley | Agent Engineering | What RL Means for Agents |
| 13 | Nik Caryotakis | Staff Software Engineer | SuperDial | Agent Engineering | Voice AI: Your Bot Isn't Special |
| 14 | Greg Ceccarelli | Co-Founder | SpecStory | AI Leadership | How To Build an AI Strategy That Fails |
| 15 | Shirsha Chaudhuri  | Director of Engineering | Thomson Reuters | AI Leadership | Missing pieces of workflow automation |
| 16 | Stephen Chin | VP of Developer Relations | Neo4j | AI Leadership | Anchoring Enterprise GenAI with Knowledge Graphs |
| 17 | Soumith Chintala | Co-founder | Meta PyTorch | Agent Engineering | What does it take to build a personal, local, private AI Agent that augments you deeply? |
| 18 | Samuel Colvin  | Founder & CEO | Pydantic Logfire | Workshops | An Opinionated Blueprint for the Future of GenAI Applications |
| 19 | Mike Conover | Founder & CEO | Brightwave | Agent Engineering | Trust, but Verify: High-Fidelity Reasoning in Agentic Workflows |
| 20 | Kyle Corbitt | Founder & CEO | OpenPipe | Agent Engineering | How we scaled 500m AI agents in production with 2 engineers |
| 21 | Alison Cossette | Data Science Strategist, Advocate, Educator | Neo4j | Workshops | Smarter AI with GraphRAG – Connecting Structured & Unstructured Data for Better Retrieval |
| 22 | John Crepezzi | Software Engineer | Jane Street | Agent Engineering | Building AI-Powered Developer Tools at Jane Street |
| 23 | Suman Debnath | — | AWS | Workshops | Agentic RAG with Vision Language Models |
| 24 | Aparna Dhinkaran | Founder & CPO | Arize | AI Leadership | Ensure AI Agents Work: Evaluation Frameworks for Scaling Success |
| 25 | Stefania Druga  | Research Scientist, Gemini | Google | Agent Engineering | Tools for the Next Generation of AI Engineers |
| 26 | Don Bosco Durai | Co-founder and CTO | Privacera | AI Leadership | Balancing Innovation with Security & Safety |
| 27 | Praveen Durairaju | Field CTO | Hasura | Expo Stage | Path towards 100% Accurate & Repeatable Data Agents for AI |
| 28 | Colin Flaherty | Founding Researcher | Augment Code | AI Leadership | Building Self-Coding Agents |
| 29 | Evan Fossier  | Senior Software Engineer | Datadog | Expo Stage | How do you know your agent works? |
| 30 | Paul Gilbert | Technical Lead | Arista Networks | AI Leadership | How to Build Your Own AI Data Center in 2025 |
| 31 | Noah Gundotra | Product Engineer | Solana | Workshops | Solana Lets Agents Create Wealth |
| 32 | Kevin Hou | Head of Product Engineering | Windsurf | Agent Engineering | Agents are built at the fringe: getting from 90 to 100 |
| 33 | Nick Huang | FDE | LangChain | Workshops | How Clay Performs Agent Evaluation |
| 34 | Hamel Husain | Founder | Parlance Labs | AI Leadership | How To Build an AI Strategy That Fails |
| 35 | Chip Huyen | Author, AI Engineering | Independent | Online | Challenges of Building Agents |
| 36 | Grace Isford | Partner | Lux Capital | AI Leadership | Beyond the Consensus: Navigating AI’s Frontier in 2025 |
| 37 | Minki Jung | AI Engineer | Independent | Workshops | Flow Engineering 101 |
| 38 | Anirudh Kamath | Tech Lead | Browserbase | Expo Stage | The Agentic Future of Search |
| 39 | Anju Kambadur | Head of AI Engineering | Bloomberg  | Agent Engineering | Challenges to Scaling Agents for Generative AI Products |
| 40 | Sayash Kapoor | Author | AI Snake Oil | Agent Engineering | Building and evaluating AI Agents That Matter |
| 41 | Douwe Kiela | CEO & Co-Founder | Contextual AI | AI Leadership | Specialized RAG Agents: Lessons learned from deploying complex AI systems in production |
| 42 | Ivan Leo | Research Engineer | 567 Labs (Instructor) | Workshops | From Guesswork to Metrics : Systematically improving your RAG system |
| 43 | Beyang Liu | Co-Founder and CTO | Sourcegraph | AI Leadership, Expo Stage | Building AI Agents with Real ROI in the Enterprise SDLC; Supercharge Your SDLC: How AI Agents are Revolutionizing Software Development Abstract |
| 44 | Jason Liu | Consultant (Instructor) | Independent | Workshops | From Guesswork to Metrics : Systematically improving your RAG system |
| 45 | Jonathan Lowe | Senior Director, Operations & Insights | Pfizer | AI Leadership | Anchoring Enterprise GenAI with Knowledge Graphs |
| 46 | Dan Mason | Principal, AI | Stride | Workshops | Multi-Agent Workflows with MCP |
| 47 | Erin Mikail | Senior DX Engineer | Galileo | Expo Stage | Evaluate This! Mitigating Hallucinations in RAG & AI Agents with Galileo |
| 48 | Deepam Mishra | Sr Advisor, AI/ML Startups | AWS | Workshops | Building Agentic Workflows with DeepSeek and Amazon Nova |
| 49 | Prashant Mital | Member of Technical Staff | OpenAI | AI Leadership | OpenAI for VPs of AI |
| 50 | Mahesh Murag | Member of Technical Staff | Anthropic | Workshops | Building (Agents) with Model Context Protocol |
| 51 | Karina Nguyen | Member of Technical Staff | OpenAI | Agent Engineering | Creating Agents That Co-Create |
| 52 | Charles Packer | Co-Founder & CEO | Letta | Workshops | Agent Memory and the LLM OS |
| 53 | Bruno Passos | Developer Experience & GenAI Innovation Lead | Booking.com | AI Leadership | Building AI Agents with Real ROI in the Enterprise SDLC |
| 54 | Leigh Pember | Strategy | Mistral | Expo Stage | Mistral for VPs of AI |
| 55 | Joey Pinhas | Senior Software Engineer | Datadog | Expo Stage | How do you know your agent works? |
| 56 | Gopal Raman | Principal | South Park Commons | Expo Stage | The Agentic Future of Search |
| 57 | Zack Reneau-Wedeen | AI Product Manager | Sierra | Agent Engineering | Sierra’s Agent Development Life Cycle |
| 58 | Brennan Rosales | Vice President, AI Engineering | BlackRock | Agent Engineering | Agents in Investment Management: Aladdin Copilot |
| 59 | Baptiste Rozière | Researcher | Mistral | Expo Stage | Mistral for VPs of AI |
| 60 | Omar Sanseviero | Gemma Tech Lead | DeepMind | Workshops | Open ML Universe: Models, Agents, and Beyond |
| 61 | Atin Sanyal | Co-founder & CTO | Galileo | Expo Stage | Evaluate This! Mitigating Hallucinations in RAG & AI Agents with Galileo |
| 62 | Aarush Selvan | Product Manager | Google Gemini | Agent Engineering | Going deep on Gemini Deep Research |
| 63 | Rahul Sengottuvelu | Head of Applied AI | Ramp | Agent Engineering | Scaffold Wisely |
| 64 | Toki Sherbakov | Head of Solutions Architecture | OpenAI | AI Leadership | OpenAI for VPs of AI |
| 65 | Colin Sidoti  | CEO | Clerk | Expo Stage | The Agentic Future of Search |
| 66 | Karan Singh | Generative AI PM | AWS | Workshops | Building Agentic Workflows with DeepSeek and Amazon Nova |
| 67 |  Mukund Sridhar | Staff ML SWE / TLM | DeepMind | Agent Engineering | Going deep on Gemini Deep Research |
| 68 | Ratch Sujithan | AI Engineer | Clay GTM | Workshops | How Clay Performs Agent Evaluation |
| 69 | Ethan Sutin | CTO | Bee.Computer | Agent Engineering | Building Perfect Memory |
| 70 | Alex Volkov | AI Evangelist | Weights & Biases | Expo Stage, Workshops | AI in production: Observe, Compile, Eval; Are reasoning models better LLM judges? |
| 71 | Xiaofeng Wang | Engineering Manager, Generative AI Foundations | LinkedIn | AI Leadership | Lessons from Building LinkedIn's GenAI Platform |
| 72 | Barr Yaron | Partner | Amplify Partners | AI Leadership | Frontier Feud |
| 73 | Barry Zhang | Member of Technical Staff | Anthropic | Agent Engineering | How We Build Effective Agents |
| 74 | Maria de Lourdes Zollo | CoFounder & CEO | Bee.Computer | Agent Engineering | Building Perfect Memory |
| 75 | swyx | Editor | Latent.Space | Agent Engineering | Why Agent Engineering |

---

## 6. Companies represented — Feb 2025 (58)

567 Labs (Instructor) · AI Snake Oil · AWS · Amplify Partners · Anthropic · Arista Networks · Arize · Augment Code · Bee.Computer · BlackRock · Bloomberg · Booking.com · Brightwave · Browserbase · Clay GTM · Clerk · Contextual AI · Datadog · DeepMind · Galileo · Google · Google Gemini · Hasura · Independent · Jane Street · LangChain · Latent.Space · Letta · LinkedIn · Lux Capital · Meta PyTorch · Method Financial · Mistral · Modal Labs · Morgan Stanley · Neo4j · Neon · OpenAI · OpenPipe · Parlance Labs · Pfizer · Privacera · Profound · Pydantic Logfire · Ramp · Sierra · SignalFire · Solana · Sourcegraph · South Park Commons · SpecStory · Stride · SuperDial · Thomson Reuters · Vercel · Weights & Biases · Windsurf · Writer

**Company-type mix, for shaping the fabricated 943 rejects:** frontier labs (OpenAI, Anthropic, DeepMind, Meta, Mistral) · AI infra/devtools vendors (Datadog, W&B, Arize, Neo4j, Vercel, Modal, Neon, Sourcegraph, Windsurf) · financial institutions (Jane Street, BlackRock, Bloomberg, Morgan Stanley, Method Financial) · large non-finance enterprises (LinkedIn, Booking.com, Pfizer, Thomson Reuters, Ramp) · VC (Lux, Amplify, SignalFire, South Park Commons) · independents and one-person consultancies (Chip Huyen, Jason Liu, Minki Jung, Hamel Husain).

**Feb 2025 sponsor tiers** (useful for R9's "Sessions" — sponsor-guaranteed submissions that bypass the competitive path):

| Tier | Companies |
|---|---|
| Platinum | Solana |
| Gold | Sourcegraph, Galileo, Baseten, Hasura, Datadog |
| Silver | Windsurf, Writer, Langbase, Weights & Biases, Ellipsis, ElevenLabs, Gitpod, Vellum, Portkey, Daytona, Daily |
| Supporters | Neo4j, Brightwave, Method, OpenPipe, Paig, Arize, OpenAI, PGAI, Booking, SignalFire, SpecStory, Augment Code |

---

## 7. Secondary source — AIE CODE Summit (Nov 19–22, 2025)

Same city, same venue, same 4-day shape, nine months later. No session-level grid was ever published, but the roster and structure are public and confirm the pattern holds.

### 7.1 Structure (verbatim)

| Day | Time | Block |
|---|---|---|
| Wed 11/19 | 5:00–7:30 PM | Welcome Reception & Expo — *"AIE Speakers and leadership track ticketholders only."* |
| Thu 11/20 | 8 AM–7 PM | Leadership Sessions & Expo. Sessions 8am–5pm (speakers + leadership track only); Evening Expo 4–7pm (all ticketholders) |
| Fri 11/21 | 8 AM–5 PM | Engineering Sessions & Expo — engineering track attendees only |
| Fri 11/21 | 11 AM–2 PM | Leadership Brunch — guided discussion hosted by Gene Kim |
| Sat 11/22 | 8:30 AM–5:30 PM | Workshops and Online Track — all ticketholders welcome |

AIE's own FAQ: *"Unlike the AIE World's Fair, this is a **single track per day** conference."* Also: *"All talks will be recorded… No press, no public Q&A — followups are in-person only."*

### 7.2 Roster — 89 names in **5 published groupings**

AIE groups its speaker list by *speaker archetype*, not by track. This is a directly reusable **category taxonomy** for R1's "category-based routing":

| Grouping | Count | Names |
|---|---|---|
| **Agent Labs** | 17 | Kevin Hou (Google Antigravity) · Steve Yegge & Gene Kim (Authors, *Vibe Coding*) · Ryan Carson (Amp Code) · Beyang Liu (Amp Code) · Itamar Friedman (Qodo) · Robert Brennan (AllHands/OpenHands) · Naman Jain (Cursor & LiveCodeBench) · Alexander "Al" Harris (Amazon Kiro) · Kath Korevec (Google Labs/Jules) · Natalie Serrino (Gimlet Labs) · Erik Thorelli (CodeRabbit) · Michele Catasta (Replit) · Peter Wielander (Vercel) · Lee Robinson (Cursor) · Eno Reyes (Factory) · Nik Pash (Cline) · Ivan Leo (Manus) |
| **Model Labs** | 16 | Jed Borovik (Google DeepMind) · Mahesh Murag (Anthropic) · Barry Zhang (Anthropic) · Anjali Sridhar (Google DeepMind) · Paige Bailey (Google DeepMind) · Ammaar Reshi (Google DeepMind) · Kat Kampf (Google DeepMind) · Thariq Shihipar (Anthropic) · Katelyn Lesse (Anthropic) · Jacob Kahn (FAIR, Meta) · Olive Song (MiniMax) · Eiso Kant (Poolside) · Brian Fioca (OpenAI) · Cathy Zhou (OpenAI) · Bill Chen (OpenAI) · Will Hang (OpenAI) |
| **Leaders & Enterprises** | 15 | Max Kanat-Alexander (Exec. Distinguished Engineer, Capital One) · Samir Mody (Head of AI Eng, Browser Company of New York) · Tobin South (Head of AI Agents & MCP, WorkOS) · **Lei Zhang (Head of Infrastructure, Bloomberg)** · Mike Lacsamana & Zayne Turner (Workato) · **Martin Harrysson (Sr. Partner, McKinsey)** · Asaf Bord (AI Lead, Northwestern Mutual) · Cornelia Davis (Dev Advocate, Temporal) · Patrick Riley & Carlos Galan (Auth0) · Jake Nations (Staff Engineer, Netflix) · Kevin Madura (Director, AlixPartners) · Sarah Chieng (Head of DX, Cerebras) · Natasha Maniar (Analyst, McKinsey) · Lisa Orr (Group PM, Zapier) |
| **Academics & Notables** | 15 | Alex Lieberman (Tenex, Morning Brew) · Will Brown (Prime Intellect) · Yegor Denisov-Blanch (Stanford) · Nathaniel Whittemore (Super.ai) · Aparna Dhinakaran (Arize) · Rhythm Garg / Linden Li (Applied Compute) · Dex Horthy (HumanLayer) · Justin Reock (DX) · Jeremiah Lowin (Prefect/FastMCP) · Dan Shipper (Every.to) · Jared Zoneraich (PromptLayer) · Arman Hezarkhani (Tenex) · SallyAnn DeLucia (Arize) · Ashpreet Bedi (Agno AI) · Joel Becker (METR) |
| **Online Speakers** | 14 | Yuxuan Zhang (Z.ai/GLM — Online Track Keynote) · Alex Gavrilescu (Funstage) · Ahmad Awais (CommandCode.ai / Langbase) · Brian John (BetterUp) · Nicholas Arcolano (Jellyfish) · Johann Schleier-Smith (Temporal) · Corey J. Gallon (Rexmore) · Callan Fox & Valentin Bercovici (WEKA) · Samuel Colvin (Pydantic) · Ofer Mendelevitch (Vectara) · Mahmoud Abdelwahab (Railway) · Alberto Romero (Jointly) · Boris Bogatin (Catio) |

Note AIE's own annotation vocabulary on the roster: **"AIE Top Speaker," "AIE 2x Top Speaker," "AIE 3x Top Speaker," "AIE CODE Emcee," "AIE Online Top Speaker."** That is a returning-speaker reputation signal AIE maintains by hand today — a cheap, high-signal field for Marquee's speaker records and an obvious lever for R4's evaluation workflow.

**Two names bridge both events into 2026:** Lei Zhang (Bloomberg) and Martin Harrysson (McKinsey) appear on both the CODE 2025 roster *and* the AIE NYC 2026 "past speakers" carousel — alongside four Feb 2025 speakers. Returning speakers across events are real in AIE's world; the seed should model them (→ R45 multi-event).

### 7.3 Side events (Nov 17–25, 2025)

CODE 2025 published **21 third-party side events** across a 9-day window, and Feb 2025 published 16. AIE promotes them free of charge. Not a Marquee requirement, but if the seed wants a filled-out event surface beyond the core program, this is a real, public content type with real titles.

---

## 8. Submission volume and acceptance

There is **no public per-event submission count for either 2025 NYC event.** AIE has never published one. What exists:

| Signal | Value | Source |
|---|---|---|
| **AIE's stated historical acceptance rate** | **5–15%** — *"a highly competitive process"* | AIE NYC 2026 CFP (Sessionize) |
| Human review | *"all submissions receive human review"* / *"every proposal receives human review"* | AIE NYC 2026 CFP |
| **AIEWF 2024 CFP volume** | *"~500 that applied"* → ~30–35 accepted through inbound CFP, plus 30–50 invited directly | swyx, *Organizing AI Engineer World's Fair 2024* |
| AIEWF 2024 scale context | ~2,000 attendees; 9 tracks; 4–5 concurrent | same |
| AIEWF 2025 CFP volume | "hundreds" of speaker applications; ~3,000 attendees | latent.space CFP post |
| First AIE Summit (SF 2023) | 500 attendees, **10:1 applicant ratio** (attendees, not talks) | AIE about page |
| Rejection courtesy | Non-accepted submitters *"receive discounted tickets as a show of appreciation"* | latent.space CFP post |
| Proposal cap | "Multiple submissions are welcome" (2026); **up to 3** (Code Summit) | AIE NYC 2026 / Code Summit CFP |
| CFP tooling | **Sessionize**, all events | sessionize.com/aienyc2026, /ai-engineer-worlds-fair-2025 |
| Prior-year CFP window | AIEWF 2025: opens Feb 19, closes Apr 21, notifications Apr 30 — **~9 weeks open, 9 days to decision** | sessionize.com/ai-engineer-worlds-fair-2025 |

**The reconstruction, and it is clean.** ~500 submissions produced ~30–35 CFP-track acceptances at a 2,000-person event (≈6–7% inbound acceptance) — consistent with AIE's stated 5–15%. Scale to NYC 2026's 1,000–1,500 in-person and ~150 speakers and the numbers land where the requirements dossier already guessed (R46: ~1,000–3,000 submissions).

**Recommended seed numbers:**

| | Option A — faithful to Feb 2025 | Option B — sized to 2026's ~150 speakers |
|---|---|---|
| Total submissions | **1,000** | **1,200** |
| Accepted sessions | **60** (the exact Feb 2025 core) | **~115** (Feb 2025 core + CODE 2025 roster + fabricated) |
| Accepted speakers | 75 | ~150 |
| Implied acceptance rate | **6.0%** — bottom of AIE's stated band | **9.6%** — mid-band |
| Argument | Every accepted record is real and verifiable | Matches the budget's ~150 and the site's "100+" |

**Recommend Option A for the primary demo**, with the fabricated pool sized at 1,000. It puts 100% real, checkable data in the accepted set — the part a judge actually reads — while still producing a **940-row** rejected/pending pool that stress-tests R7 (speed) and R46 (volume). 6.0% is inside AIE's published band and reads as more competitive, not less credible.

**Status mix at the demo's frozen clock** (mid-CFP, Wave 1 dispatched, Wave 2 pending — see [§2.2](#22-cfp-timeline-and-policy-2026)):

| Status | Count | Why |
|---|---|---|
| Accepted (Wave 1) | ~32 | Wave 1 dispatched Aug 15; speakers can see status (R16) and have onboarding tasks in flight (R6, R17) |
| Accepted (Wave 2, decided not yet sent) | ~28 | Gives the demo a live batch-accept action to perform (R43) |
| Under review — assigned to a committee | ~200 | Feeds the evaluator queue (R21, R22) with real work to do |
| Under review — unassigned | ~150 | Gives the routing rules (R1) something to route |
| Rejected | ~550 | Volume ballast; also exercises bulk filters |
| Draft / incomplete | ~40 | Exercises R37 (saved drafts) and the reminder-before-close email (R35) |
| Sponsor "Sessions" (bypass competitive path, R9) | ~25 | Drawn from the real sponsor tiers in [§6](#6-companies-represented--feb-2025-58) |

---

## 9. Do not replicate

**This repo will be public open source.** These are hard rules for the seed generator and for anything committed.

### 9.1 Hard prohibitions

| Item | Rule | Why |
|---|---|---|
| **Speaker email addresses** | **Never.** The AIE schedule page's `__NEXT_DATA__` payload leaks **59 real speaker/assistant email addresses** (e.g. a Lux Capital assistant's address on Grace Isford's record). These were stripped before `sources/aie-summit-2025-program.json` was written and must never reach the repo, the seed, or a log. Generate `firstname.lastname@example.com` or `@marquee.demo`. | Real PII, incidentally exposed, not intended for publication. Republishing it in a public repo is the single worst thing this project could do. |
| **Headshots / profile photos** | **Never copy.** 77 real headshots are hosted at `aie-cms-uploads.s3.us-west-1.amazonaws.com`. Do not download, hotlink, embed, or re-host. | Portrait rights are held by the individuals and their photographers, not AIE and not us. R2 requires headshot *upload*, which needs a placeholder, not a real face. |
| Headshot substitute | Use deterministic generated avatars (initials-on-color, `boring-avatars`-style SVG, or identicons) rendered **locally, no external requests**. If a real-looking face is needed for one hero screenshot, use an explicitly licensed synthetic set and say so in the README. | Also protects R7 — no third-party image fetch on list render. |
| **Phone numbers, travel details, dietary/accessibility notes, passport/visa data** | Never fabricate anything that looks like a real person's real logistics. R49's travel intake fields exist in the schema; fill them with obviously-synthetic values. | These are the sensitive fields a real deployment would hold. |
| **AIE internal material** | The budget image, quotes, and internal figures from `sources/tweet-image.png` stay out of the seed and out of the repo. | Not ours, marked internal, partially redacted. |
| **Stage 11 internals / `Atin/` content / any token** | Never. | Per `CLAUDE.md`. |
| **Sessionboard or Sessionize assets** | No copied logos, screenshots, CSS, or marketing copy. | Trade dress. R26: judged on job-to-be-done, not fidelity. |

### 9.2 Use with care

| Item | Rule |
|---|---|
| **Speaker bios** | The published bios are public marketing copy and are in the scrubbed JSON. Prefer **shortened or lightly paraphrased** versions in the seed; do not bulk-paste long personal bios of private individuals. Never write a *new* bio that asserts facts about a real person. |
| **Session abstracts** | Public conference copy — fine to use verbatim for the 60 real accepted sessions. Do not attribute a **fabricated** abstract to a real person's name. |
| **Fabricated rejects** | The ~940 rejected/pending submissions must use **synthetic speaker names and synthetic companies**. Never attach a real named person to a fabricated *rejected* submission — a real engineer discovering a public demo that says AIE rejected them is a genuine harm, and it is trivially avoidable. Real names appear **only** on the real accepted core. |
| **Company names on fabricated rows** | Prefer plausible-but-invented companies. If real company names are used for texture, keep them on neutral rows and never in a rejection. |
| **Recording links** | The 29 YouTube links are public. Linking is fine; do not mirror the video. |
| **Attribution** | Ship a short `SEED-DATA.md` (or a README section) stating: seed data is derived from the publicly published AI Engineer Summit 2025 program, used for demonstration; all contact details, images, and non-accepted submissions are synthetic; no affiliation with or endorsement by AI Engineer / Software 3.0 Inc. |

---

## 10. Seed-generator parameters

The actionable synthesis. Everything here is derived from the tables above.

**Event** — one event, AI Engineer New York 2026, Oct 12–14, Sheraton New York Times Square. Clock frozen **~Aug 20, 2026**: CFP open, Wave 1 dispatched, Wave 2 pending.

**Tracks** — mainstage focus **AI in Financial Services**; evergreen **Evals** and **Infrastructure**; plus **AI Leadership** and **Agent Engineering** carried from Feb 2025; **Expo Stage**; **Workshops**; **Online**.

**Formats and durations** (from §2.1, validated against §3.6):

| Format | Slot | Share of program | Notes |
|---|---|---|---|
| Stage Talk | 20 min (19 on the engineering track) | ~60% | "Most talks are this format" |
| Workshop | 80 min standard; 105/120 for flagship | ~22% | Day 1, 5 rooms in parallel |
| Lightning Talk | 5–10 min | ~8% | Feb 2025's nearest analog is the 12–14 min Expo slot |
| Online Talk | 25 min typical (5–55 allowed) | ~4% | Prerecorded |
| Expo Session | 12–30 min | ~6% | Scheduled **inside** mainstage breaks/lunch, never opposite mainstage |

**Grid** — 08:00 registration, 09:00 first content, 17:00 last content; 30-min breaks mid-morning and mid-afternoon; 60-min lunch; a 7–15 min day-opening welcome; talks back-to-back with a ≤1 min turnover.

**Speakers per submission** — 1 (75%), 2 (23%), 3–4 (2%). Min 1, max 4. **Never default to a minimum of 2** (R15).

**Submissions per submitter** — cap 3 (R48). Distribution: 1 (~70%), 2 (~20%), 3 (~10%).

**Volume** — 1,000 submissions, 60 accepted (6.0%), status mix per §8.

**Conflict material to preserve** — 5 parallel workshop rooms; expo sessions overlapping breaks; at least a handful of speakers with two sessions; at least two deliberately double-booked room slots so R5's conflict detector visibly fires on load.

**Vendor-policy flag** (R47) — every submission carries `vendor_affiliation` ∈ {none, vendor-selling-to-FIs, vendor-with-customer-champion}. Mainstage acceptance requires `none` or `vendor-with-customer-champion`; the "vendor-selling-to-FIs" rows route to workshop/leadership/expo pools. This is the concrete instance of R1's category-based routing and it is drawn verbatim from AIE's real policy.

**Onboarding tasks per accepted speaker** (R6, R17, R49) — bio + headshot upload; slide deck by date; travel: economy flight request; hotel 2 nights domestic / 3 international; recording consent; A/V check; speaker handbook acknowledgement.

---

## 11. Sources

Every URL consulted, all public, all captured 2026-08-08.

**Primary — the seed source**
- [ai.engineer/summit/2025/schedule](https://www.ai.engineer/summit/2025/schedule) — the full Feb 2025 grid. Structured payload extracted from the page's embedded `__NEXT_DATA__` JSON; saved scrubbed to `sequence/research/sources/aie-summit-2025-program.json`.
- [ai.engineer/summit/2025](https://www.ai.engineer/summit/2025) — day structure, track descriptions, ticket status, sponsor tiers.
- [ai.engineer/2025](https://www.ai.engineer/2025) — track copy ("Our highest reviewed track"), side-event list, program overview.
- [youtube.com/playlist?list=PLcfpQ4tk2k0VGHcZxjSoAe_r5VbdHXmjy](https://www.youtube.com/playlist?list=PLcfpQ4tk2k0VGHcZxjSoAe_r5VbdHXmjy) — Leadership Sessions (Feb 20).
- [youtube.com/playlist?list=PLcfpQ4tk2k0WzqWDdWkN2DnZOhtYI9jyI](https://www.youtube.com/playlist?list=PLcfpQ4tk2k0WzqWDdWkN2DnZOhtYI9jyI) — Agent Engineering Sessions (Feb 21).
- [youtube.com/watch?v=L89GzWEILkM](https://www.youtube.com/watch?v=L89GzWEILkM) — Day 1 full livestream. · [youtube.com/watch?v=D7BzTxVVMuw](https://www.youtube.com/watch?v=D7BzTxVVMuw) — Day 2 full livestream.

**Secondary — CODE Summit**
- [ai.engineer/code/2025](https://www.ai.engineer/code/2025) — full 89-name roster, 4-day structure, FAQ, sponsor tiers, 21 side events.
- [apply.ai.engineer](https://apply.ai.engineer/) — attendee application portal (form itself gated; applications closed).

**The 2026 target**
- [ai.engineer/nyc](https://www.ai.engineer/nyc) — dates, venue, day structure, session formats, CFP key dates, audience demographics, past-speaker carousel.
- [sessionize.com/aienyc2026](https://sessionize.com/aienyc2026) — CFP: waves, 5–15% acceptance rate, vendor policy, speaker benefits.

**Submission-volume evidence**
- [swyx.io/aiewf-2024](https://swyx.io/aiewf-2024) — "~500 that applied," ~30–35 inbound acceptances, 30–50 invited, 9 tracks, tooling notes.
- [latent.space/p/aiewf-2025-cfp](https://www.latent.space/p/aiewf-2025-cfp) — "hundreds" of applications, rejection-courtesy discount.
- [sessionize.com/ai-engineer-worlds-fair-2025](https://sessionize.com/ai-engineer-worlds-fair-2025/) — CFP window, 18-min format, 22 track categories, desk-reject policy.
- [ai.engineer/about](https://www.ai.engineer/about) — first Summit: 500 attendees, 10:1 applicant ratio.

**Venue**
- [marriott.com — Sheraton New York Times Square, meetings & events](https://www.marriott.com/en-us/hotels/nycst-sheraton-new-york-times-square-hotel/events/meetings-and-events/) · [Cvent venue page](https://www.cvent.com/venues/new-york/hotel/sheraton-new-york-times-square-hotel/venue-f1b118a9-10ab-4513-96a5-a853608987d3) — Metropolitan Ballroom (13,768 sq ft / 2,500), New York Ballroom (8,715 sq ft / 1,200), 43 meeting rooms / 60,000 sq ft.

---

## 12. Gaps

| Gap | Impact | Recoverable? |
|---|---|---|
| **No per-event submission count for either 2025 NYC event.** AIE has never published one. | Low — AIEWF 2024's ~500 plus the stated 5–15% rate constrains the number tightly enough for a seed. | Only from AIE directly. Not worth chasing. |
| **CODE Summit 2025's session grid was never published.** `ai.engineer/code/schedule` renders a client-side stub with no session data. | Low — we have its roster and day shape; Feb 2025 supplies the grid. | Possibly via the AIE YouTube playlist for CODE 2025, if per-talk titles are needed. |
| **The Feb 2025 CFP itself** (its Sessionize page, form fields, track list) could not be located; only AIEWF 2025's and NYC 2026's CFP pages are live. | Low-moderate — AIEWF 2025's 22-category track list and NYC 2026's format list together give a defensible form shape (→ R1, R13). | Wayback may hold it; one attempt was rate-limited (HTTP 429). |
| **Sessionize's actual submission-form fields** remain unretrievable (auth-gated), as noted in the requirements dossier §8. | Moderate — R13's form builder has to infer its field set. | Only from an authenticated Sessionize account. |
| **The Feb 2025 online track** shows only 2 talks in the published grid; the real livestream track was likely larger. | Negligible. | AIE YouTube. |
| The `ai.engineer/2025` page is a hybrid that reuses Feb 2025 copy under a CODE Summit header; its headline figures (~2000 attendees, ~100 talks, ~70 workshops/expo sessions, ~35 expo companies) **cannot be safely attributed to either event**. | Low — flagged, not used. | — |

---

*Living document. Next expected inputs: any AIE material Atin relays from Discord; the Sunday clarification video if it touches demo data expectations.*
