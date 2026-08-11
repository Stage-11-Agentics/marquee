# Operator preconditions — the account work no agent can do

**Owner: a human with Stage 11 account access. Status: OPEN.**
**Deadline: Wed 2026-08-12 22:00 PT (= Thu Aug 13 01:00 EDT).**

> ⚠️ **This file must not reach the public repo.** It names accounts and dashboards. It
> contains no secrets and must stay that way — never paste a key, token, or password in here.
> Curation before the public push is **MRQ-42**; the full-history scan is **MRQ-43**.

## Why this document exists

The build fleet has merged 27 of 65 tickets and is running six agents wide. Almost everything
left is agent-doable. **The items below are not** — they need a browser, a login, and in two
cases a credit card. They share one nasty property:

> **They fail at deploy, not in dev.** Every one of them is invisible while we develop locally
> and detonates the first time we ship to real Cloudflare. That moment is **MRQ-57**, currently
> in backlog and scheduled for Tuesday. If something here is wrong, we want to know tonight —
> not at 10pm the night before submission.

Everything is on the **Stage11 Projects** account (`projects@stage11.ai`) unless noted.
Dashboard logins live in **1Password → `Stage11-Platform/*`**. API keys live in `.env` in the
platform repo. Service-by-service background: `~/Projects/Stage11/code/platform/{service}.md`.

**Do not touch** the `Stage11Agentics` (company) or `atin@atin.me` (personal) Cloudflare
accounts. Wrong-account work is worse than no work.

---

## 1. Cloudflare — Workers **Paid** ⬜ BLOCKING

**Why it matters.** The Free plan caps CPU at **10 ms per invocation**. Marquee
server-renders a 1,000-row submissions table, generates ICS files, and hashes session tokens —
each of which blows past 10 ms. This is not a performance nicety; **SSR does not work at all**
on Free. It costs **$5/month** and the research called it "a non-decision."

**How to check.** Dashboard → Workers & Pages → Plans. Confirm the account reads **Workers
Paid**, not Free.

**Done when.** The plan page says Paid on `projects@stage11.ai`.

---

## 2. Cloudflare — R2 entitlement, proven by fetching an object ⬜ BLOCKING

**Why it matters.** Speaker headshots and slide decks live in R2. Stage 11's R2 entitlement
has **silently lapsed account-wide before** — every public object URL starts returning 403 and
the fix is dashboard-only. Nothing in our code detects this; it looks like a bug in our upload
path.

**How to check — do not trust the dashboard's word for it.** Create a bucket, upload any small
file, expose it, and **actually `curl` the public URL and get a 200**. The entitlement is only
proven by a successful fetch.

**Done when.** A real object returns 200 over a public R2 URL.

---

## 3. Cloudflare — `wrangler login` + account ID on the build machine ⬜ BLOCKING

**Why it matters.** MRQ-57 (the real deploy) is blocked until Cloudflare auth exists on the
machine. Until then the deployed URL a judge opens does not exist — and the deployed URL *is*
the submission.

**How to do it.**

```sh
export CLOUDFLARE_ACCOUNT_ID="<from .env in the platform repo>"
npx wrangler login          # authenticate as projects@stage11.ai
```

This is interactive (it opens a browser), which is exactly why an agent cannot do it.

**Done when.** `npx wrangler whoami` shows the Stage11 Projects account.

**Note.** The account ID is supplied through the environment and **never committed** —
`wrangler.jsonc` still carries `REPLACE_ME-*` placeholders, which MRQ-57 fills in.

---

## 4. Resend — **stays on the free/demo tier** ✅ RULED (Atin, 2026-08-11)

**No upgrade. This is a decision, not a task.**

**What that means.** Free gives 3,000/month but **100/day**, one custom domain, 30-day
retention. `marquee@stage11.systems` has been verified and sending-enabled since **2026-03-11**,
so there is no domain warm-up risk and nothing to provision.

**What it costs us.** The 100/day cap is now a hard constraint rather than a cushion, so two
things carry more weight:

- **Demo-safe mode is load-bearing, not a nicety.** Exactly **two** `always_live` write sites
  exist in the tree; everything else suppresses to the outbox. That count is a guardrail —
  audit ticket **MRQ-45** exists to prove it.
- **The outbox pattern is what keeps us under the cap** during seeding and judging. A bulk
  rejection to 900 submitters would blow through 100/day nine times over; it must land in the
  outbox, not the wire.

**Anyone verifying:** confirm the tier is unchanged and the domain still shows verified. Do
**not** upgrade.

---

## 5. Airtable — Team plan + **two** bases ⬜ BLOCKING for the mirror

**Why it matters.** The Airtable two-way mirror is the competition's explicitly named bonus.
Free caps at **1,000 records per base** — and our seed is **exactly 1,000 submissions**, before
speakers, sessions, evaluations, or tasks are counted. We are dead on the cap on day one.
Team raises it to **50,000/base**, which fits comfortably. Seats run ~$20–24/month.

**Two bases are needed, not one:**

| Base | Purpose |
|---|---|
| **Demo base** | The judge-visible mirror of the seeded conference |
| **Test base** | For `check:mirror` — **the suite writes destructively** and must never point at the demo base |

**Done when.** Team plan active, both bases created, and their base IDs handed over for
`.dev.vars` / Wrangler secrets (**never committed** — the repo goes public).

**Blocks:** MRQ-54 (the Airtable inbound-webhook spike, which will stall within five minutes
without a base), then MRQ-26 and MRQ-27 (the outbound and inbound mirror), and audit MRQ-46.

**Heads-up for whoever takes this:** there is **no `airtable.md` in the platform knowledge
base** (`~/Projects/Stage11/code/platform/`), unlike Cloudflare and Resend. Whatever you learn
doing this, please write it up there — that's the house rule and it saves the next person.

---

## 6. The ICS oracle — three real inboxes ⬜ OPEN (partly reassigned)

**Why it matters.** Marquee emails calendar invites when a session is scheduled. The bet is
`METHOD:REQUEST` ICS attachments, and **neither Google nor Microsoft publishes a normative
statement** about how they render. Three behaviors must hold: the invite shows **Accept/Decline**
(not a bare `.ics` download), a `SEQUENCE+1` update **replaces** the event rather than
duplicating it, and a `CANCEL` **removes** it. **MRQ-25 is written against the verdict, not the
reverse** — that is the entire reason the spike exists.

**Current state.** The wire-format and delivery halves are done and merged. Client rendering
is unresolved:

| Client | State |
|---|---|
| Gmail | Triplet delivered to `benevolent.futures@gmail.com` on 2026-08-09 06:21 UTC — **awaiting inspection**. Assigned to the watchdog agent to drive by browser. |
| Outlook | **Never sent — needs an Outlook.com address** |
| Apple Calendar | **Never sent — needs an iCloud-backed address** |

**How to run a row.** From `spikes/s2-ics-clients/`, with `RESEND_API_KEY` set:

```sh
node send.mjs <address>
```

Then the two-minute checklist in `spikes/s2-ics-clients/VERDICT.md`: open 1/3 → are there RSVP
buttons? Accept → one 15:00 event. Open 2/3 → did 15:00 become 16:00 with no duplicate? Open
3/3 → is it gone?

**What a collaborator can unblock immediately:** supply an Outlook.com address and an
iCloud-backed address. Those two rows are pure operator input.

**Careful.** Clicking **Accept** writes to a real calendar. Use an account you don't mind
touching.

---

## 7. Fixtures the build needs ⬜ OPEN, lower stakes

- **One real Sessionize export file** (any event, any conference) — validates the importer
  fixture for **AC-109 / MRQ-31**. Without it the importer is tested only against data we
  invented, which is exactly the trap the importer exists to avoid.
- **A Cloudflare API token for CI** — `check:readme` does a scratch deploy.
- **A model credential** for `check:skill-agent` (MRQ-44).

---

## Suggested order for a fresh collaborator

Ordered by *blast radius if wrong*, not by effort:

1. **Workers Paid** (#1) — one dashboard page; blocks everything downstream
2. **R2 proven by a real `curl`** (#2) — has silently failed before, and only a fetch proves it
3. **`wrangler login`** (#3) — unblocks MRQ-57, the ticket that produces the judged URL
4. **Airtable Team + two bases** (#5) — unblocks a whole feature branch and the named bonus
5. **Outlook + Apple addresses** (#6) — two lines in a message, unblocks a real verdict
6. **Sessionize export** (#7) — nice to have, genuinely improves the importer

Items 1–3 are perhaps twenty minutes total and remove the entire class of Tuesday-night
surprises. Item 4 is the one with a purchase decision in it.

## Where to report back

Post results to the Marquee orchestrator (c11 `workspace:9`, `surface:60`), or append to this
file. For each item: what you found, what you changed, and any IDs the build needs — **base
IDs and resource IDs are fine here; keys, tokens, and passwords are never fine anywhere in
this repo.**
