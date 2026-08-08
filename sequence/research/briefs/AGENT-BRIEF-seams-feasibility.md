# Mission: External Seams & Feasibility — Marquee

You are the **seams-and-feasibility researcher** for Marquee, Stage 11's entry in swyx's "$10,000 Kill My SaaS" hackathon: an open-source speaker/session-management platform (Sessionboard replacement). Your product: the real semantics of every external system Marquee must touch, so architecture decisions get made on facts, not vibes. The build stack is undecided — your job is evidence, not the decision.

Work in `/Users/atin/Projects/Stage11/deployments/Marquee`.

## c11 etiquette (first)

Load the c11 skill. Your tab is pre-named **"Seams Feasibility"**; keep it. Keep your description current (live subtitle), preserving the last line: `Lineage: Marquee Initiation → Seams Feasibility`.

## Read first

`sequence/research/competition-requirements.md` — ground truth. Your work directly serves: **Q1** (Airtable primary vs mirror), **Q9** (ICS vs OAuth calendar), **R3** (comms + calendar invites), **R7** (speed is graded), **R46** (~1,000–3,000 submissions), §5 (stack signals: Airtable bonus > Cloudflare mild bonus, "because those are what we use"). Also check `~/Projects/Stage11/code/platform/` for existing Stage 11 knowledge on cloudflare/resend/etc. — read what exists, and note anything reusable.

## Systems to map (real semantics: objects, limits, failure modes — not marketing)

1. **Airtable as a datastore** — API rate limits (per-base and per-token), record caps per plan tier, field types vs relational integrity, transactions (none?), webhooks, sync latency, pagination, cost at AIE scale (~775 speakers/yr, 1k–3k submissions/event). Then the patterns: (a) Airtable as primary store — where exactly it breaks against R7/R46, with numbers; (b) real DB as source of truth + genuine two-way or one-way Airtable mirror — sync architecture options, conflict handling, what "genuine" must mean for the judges' ops people to live in Airtable; (c) prior art: existing Airtable-sync libraries/tools worth borrowing.
2. **Cloudflare platform** — Workers, Pages, D1 (SQLite limits: db size, row reads/writes pricing, latency), R2 (file uploads: headshots/slides — presigned upload patterns, egress), KV, Queues, Durable Objects, Workers cron, cold-start behavior, and speed characteristics that serve R7. What a fast, seeded, judge-proof deployment on Cloudflare looks like; any sharp edges (D1 write limits, Worker CPU ms caps, request-size caps for slide uploads).
3. **Outbound email** — Cloudflare has no outbound SMTP: real options (Resend — Stage 11 already has an account, check platform notes — SES, Postmark, MailChannels-from-Workers current status). Deliverability for a hackathon-fresh domain: SPF/DKIM/DMARC setup time, custom-domain sending (the judges paid $500 for exactly this — dossier §5). Templated email + merge fields + scheduled reminders (R35, R3) — what the sending layer gives us vs. what we build.
4. **Calendar invites (R3/Q9)** — ICS format real semantics: METHOD:REQUEST vs plain .ics attachment (which renders as an actual invite in Gmail/Outlook/Apple), organizer/attendee fields, updates/cancellations (SEQUENCE), timezone handling (VTIMEZONE), all-day vs timed. "Add to Google Calendar" / Outlook deep-link URL formats. Confirm the dossier's read that OAuth calendar-write is infeasible by Wednesday (consent-screen verification timelines) — or refute it.
5. **Auth for two seats** — organizer logins + speaker magic-link auth (speakers must reach their portal with zero friction; judges will test logged-out form → speaker login). Options on Cloudflare (roll-your-own sessions on D1/KV, Lucia-style, Clerk/WorkOS free tiers) with setup-time and speed costs. Judge-friendly demo credentials patterns.
6. **File uploads** — headshots (images: resize/thumbnail) and slides (PDF/PPTX, tens of MB): R2 direct-upload from browser, size limits through Workers, virus/abuse considerations for a public form.

## Output

`sequence/research/seams-feasibility.md` — per-system: objects/limits table with numbers and citations, the viable patterns ranked with setup-cost estimates (hours, not story points), and a clear **"what I'd bet"** line per open question (Q1, Q9) marked as recommendation-not-decision. Flag anything that is a trap under the 104-hour deadline (e.g. OAuth verification, domain warm-up) in a dedicated **Deadline traps** section.

Cite everything — official docs over blog posts, version/date noted. Aim for a complete first pass in ~2 hours.

When done: `c11 send --workspace workspace:16 --surface surface:128 "Seams Feasibility: first pass complete — <one-line headline incl. Q1 bet>. File: sequence/research/seams-feasibility.md"` — then stay alive for follow-ups.
