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

## 1. Cloudflare — Workers **Paid** ✅ PASS (verified 2026-08-11, MRQ-57)

**Why it matters.** The Free plan caps CPU at **10 ms per invocation**. Marquee
server-renders a 1,000-row submissions table, generates ICS files, and hashes session tokens —
each of which blows past 10 ms. This is not a performance nicety; **SSR does not work at all**
on Free. It costs **$5/month** and the research called it "a non-decision."

**How to check — by creating a paid resource, not by reading a page.** Both documented
subscription endpoints lie: `/accounts/{id}/workers/subscription` returns `7003` ("no route")
and `/accounts/{id}/subscriptions` returns `10000` even with `Account Settings: Read`. Queues
is a **paid-only feature**, so creating one is the honest test:
`npx wrangler queues create <name>`.

**Done when.** A real Queue creates successfully.

**Evidence (2026-08-11).** `marquee-mail` created on `Projects@stage11.ai's Account`
(`16483d…`). The account is on Workers Paid.

---

## 2. Cloudflare — R2 entitlement, proven by fetching an object ✅ PASS (verified 2026-08-11, MRQ-57)

**Why it matters.** Speaker headshots and slide decks live in R2. Stage 11's R2 entitlement
has **silently lapsed account-wide before** — every public object URL starts returning 403 and
the fix is dashboard-only. Nothing in our code detects this; it looks like a bug in our upload
path.

**How to check — do not trust the dashboard's word for it.** Create a bucket, upload any small
file, expose it, and **actually `curl` the public URL and get a 200**. The entitlement is only
proven by a successful fetch.

**Done when.** A real object returns 200 over a public R2 URL.

**Evidence (2026-08-11).** `GET https://videos.stage11.dev/c11-intro.mp4` with
`Range: bytes=0-1023` returned **HTTP 206** with real bytes. `/accounts/{id}/r2/buckets`
returned `success: true` with no error `10042`, and `aws s3 ls` listed buckets rather than
`NotEntitled`. The entitlement is live.

---

## 3. Cloudflare — Workers credentials on the build machine ✅ PASS (verified 2026-08-11, MRQ-57)

**Why it matters.** MRQ-57 (the real deploy) is blocked until Cloudflare auth exists on the
machine. Until then the deployed URL a judge opens does not exist — and the deployed URL *is*
the submission.

**Where the account ID actually lives.** `code/platform/.credentials/.env` — **not** the
platform repo root. The root holds only `.env.template` (`op://` references, never hydrated
here per `secrets.md`), so "pull it from `.env` in the platform repo" sends you to a file that
does not exist. `.credentials/` is gitignored; the file also carries the R2 token, both R2 S3
keys, the R2 endpoint, all three zone IDs, and `RESEND_API_KEY`.

**Use a scoped API token, not `wrangler login`.** The OAuth flow starts a throwaway server on
`localhost:8976` and must stay running to catch the redirect; if the command has exited when
you approve, consent is granted with nowhere to deliver the token and the browser lands on a
dead port. A token is also durable, non-interactive, and usable by CI and other agents.

```sh
set -a; source ~/Projects/Stage11/code/platform/.credentials/.env; set +a
export CLOUDFLARE_API_TOKEN="$MARQUEE_CLOUDFLARE_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID
```

Token scopes (account): Workers Scripts, D1, Workers KV Storage, Queues, Workers R2 Storage,
Turnstile — all Edit; Account Settings — Read. Zone (`stage11.dev`): Workers Routes, DNS —
Edit. Turnstile: Edit is what lets an agent mint the widget by API instead of sending a human
to the dashboard.

**Done when.** `/user/tokens/verify` returns `status: active` and the account resolves to
`Projects@stage11.ai's Account`.

**Evidence (2026-08-11).** `MARQUEE_CLOUDFLARE_API_TOKEN` active to 2027-06-03; account
`16483d…` resolves to `Projects@stage11.ai's Account` — **not** `Stage11Agentics`. Every
`REPLACE_ME-*` in `wrangler.jsonc` is now a real resource ID. `R2_ACCOUNT_ID` moved from
`vars` to a **secret**, because it identifies the account and this repository goes public.

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
