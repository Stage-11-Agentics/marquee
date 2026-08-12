# Plan Review: MRQ-74 — Delivery and system health surface

## 1. Verdict

**FAIL (plan-level)**

The ticket brief is excellent. The *plan* is a verbatim copy of it, and three of its
load-bearing factual claims do not survive contact with the schema.

## 2. Summary

Reviewed the MRQ-74 plan (delivery/system-health screen) against the task description,
the D1 migrations, `src/api/router.ts`, `src/ui/shell/route-table.ts`, and
`scripts/checks/verify-design-contract.mjs`. The plan section is byte-identical to the task
description — it restates *what* to build and never states *how*, so the decisions an
implementer must make (what "owed" means, where amber becomes red, what the quota is counted
over, where the page mounts) all remain open at the moment implementation starts. The key
concern is that the plan's central premise — "this is mostly a READ over columns we already
populate" — is partly false: `outbox` has no `attempts` column, and there is no `bounced`
state and no bounce ingestion anywhere in the tree, yet "what bounced" is named as a headline
deliverable *and* as a smoke-test step.

## 3. Issues

**[CRITICAL] The key finding — `outbox.attempts` does not exist**
The plan asserts `outbox` carries `status`, `suppressed_reason`, `error`, `attempts`,
`provider_message_id`, `idempotency_key`, `scheduled_for`, `sent_at`, `send_policy`. Every one
of those exists (`migrations/0001_init.sql:287-310`) **except `attempts`**. The only later
change to the table is `ALTER TABLE outbox ADD COLUMN entity_id TEXT`
(`migrations/0004_calendar_reversal.sql:5`). `attempts` exists on `mirror_outbox`
(`0001_init.sql:639`) and `webhook_deliveries` (`0005_task_cancellation_webhooks.sql:75`) only.
This matters because retry depth is the natural amber/red signal for the email capability, and
the plan simultaneously forbids a migration. An implementer will discover this after committing
to a derivation shape.
**Recommendation:** State explicitly that email health is derived from `status` + `error` +
age-since-`scheduled_for` with no retry count available, and say so in the PR as the plan's own
"if a column is genuinely missing" clause instructs. Do not let the implementer decide this at
the keyboard.

**[CRITICAL] Delivery ledger — "what bounced" is not derivable from existing data**
`outbox.status` is `CHECK (status IN ('queued','sent','suppressed','failed'))`
(`0001_init.sql:298-299`). There is no `bounced` state, and a grep for bounce handling across
`src/` and `migrations/` at the pre-ticket tree returns nothing — no Resend webhook, no
suppression-list ingestion. A provider-side bounce (accepted by Resend, rejected by the
recipient's server) leaves the row as `sent` forever. So the screen's flagship promise —
"an acceptance email that bounced, so a speaker never learns they were accepted" — cannot be
told from D1 today, and verification step 4's "mark outbox rows suppressed/**bounced**" is not
an executable instruction.
**Recommendation:** Pick one and write it into the plan: (a) descope bounce to
sent-vs-suppressed-vs-failed and say plainly on the screen that provider bounces are not yet
tracked (honest, ships this cycle); or (b) file a follow-up ticket for bounce ingestion and
have this screen reserve the row with an em dash. Silently rendering `sent` as "delivered" is
the worst option — it is the exact cry-wolf-in-reverse failure this screen exists to prevent.

**[MAJOR] The plan is the task description, verbatim**
Lines 85–155 reproduce lines 14–82 with no additions. For a `high`-complexity ticket, the plan
contributes no route paths, no response schema, no component decomposition, no test-file names,
no build ordering, and — most consequentially — no *definitions* for the things it then
mandates unit tests on ("owed-but-not-notified", "the amber/red thresholds", "quota arithmetic
near the cap"). A plan review can only confirm the ticket is well-written; it cannot confirm the
approach is sound, because no approach is stated.
**Recommendation:** Return to `in_planning` and add an implementation section: the exact route
path(s) and grant, the shape of the JSON, the capability list with each one's green/amber/red
predicate written as a condition over named columns, the definition of "owed", and the file
list with test files. Roughly one page. Everything above and below in this review would have
been settled by it.

**[MAJOR] Amber/red thresholds are required to be tested but never specified**
"Amber and red must be earned" is a taste rule, not a threshold. Verification 1 requires unit
tests on "the amber/red thresholds"; there is nothing to test against. Six-plus capabilities
each need a predicate, and several are genuinely non-obvious — is `demo_safe` suppression amber
(mail is being held back) or green (configured behaviour, working as asked)? Is one queued row
older than an hour amber, or ten? A missing cron heartbeat for a *daily* trigger cannot use the
same staleness window as an hourly one.
**Recommendation:** Write the table into the plan — capability, green condition, amber
condition, red condition, organizer sentence for each. This is the single highest-value thing
missing, and it is where the screen's credibility lives.

**[MAJOR] Quota read is underspecified and probably not per-conference**
The Resend free-tier 100/day cap is an **account** limit, not a per-event one, but the plan says
"how close **this conference** is to the 100/day send cap". If the deployment ever holds two
events, a per-event `COUNT(sent_at within today)` understates the true headroom and the screen
reassures an organizer immediately before a wave hits the wall — the precise failure the read
exists to prevent. The plan also leaves the day boundary undefined (UTC vs. the conference's
timezone; Resend resets on its own clock) and does not say whether `queued` rows scheduled for
today count against remaining headroom.
**Recommendation:** Specify: count across all events, define the day boundary explicitly,
include scheduled-for-today rows in the projection, and label the number as an estimate of what
*this system* has sent rather than an authoritative provider reading.

**[MAJOR] File ownership contradicts itself on `cli/`**
"MUST NOT TOUCH: … `cli/`" sits three lines above "Both regenerate `cli/api-registry.json`",
and the constraints section makes regenerating it mandatory for any new route
(`check:api` asserts exact parity). An implementer following the prohibition literally ships a
red gate.
**Recommendation:** Amend the prohibition to `cli/` **except** `cli/api-registry.json`.

**[MAJOR] The ownership list omits the file that mounts the screen**
Routes are glob-registered — `src/api/router.ts` is closed and genuinely needs no edit, so that
prohibition is fine. But a new *screen* has to be reachable: the client entry (`src/ui/app.tsx`)
must know about it, and the plan neither lists that file under OWNS nor explains how the route
renders without it. It also grants MRQ-74 no seam into `src/routes/telemetry.routes.ts`, which
is where MRQ-73's diagnostics response is produced and the natural place any consumption
contract gets adjusted.
**Recommendation:** Add the UI entry file to OWNS, and state explicitly whether MRQ-74 may
touch `telemetry.routes.ts` or must consume the endpoint strictly over HTTP. Parallel tickets
fail at exactly the file the ownership map forgot to name.

**[MINOR] MRQ-73 dependency makes half of verification step 4 unrunnable**
The plan says build against a fixture until MRQ-73 merges, then requires a smoke test that
stales a cron heartbeat — which reads through MRQ-73's diagnostics endpoint. If MRQ-73 has not
landed, that step cannot run, and the plan gives no fallback.
**Recommendation:** Make the ordering explicit: fixture-driven development is fine, but the
smoke test runs *after* the rebase onto merged MRQ-73. Also specify the degraded rendering when
diagnostics is absent — "not reported yet", never green-by-default.

**[MINOR] Speed is a stated feature but no budget is claimed**
The ledger joins `outbox` to `people`/submissions and adds an upstream HTTP call to diagnostics.
`check:speed` measures against declared budgets (`scripts/checks/speed-budgets.mjs`); the plan
neither claims a budget for the new surface nor caps the ledger's row count.
**Recommendation:** Name a page budget and a hard row cap with a "showing N of M" line, and say
whether a budget entry is being added.

**[MINOR] "Every row opens the record behind it" has an unstated gap**
`outbox.person_id` is nullable and `to_email` is free text, so a row may have no record to open
(a message to an address with no person). The house rule forbids removing rows or shifting
layout.
**Recommendation:** Specify the non-navigable row's treatment — em dash, same height, not a
dead link.

**[VERIFIED — no issue] Route-table and design-contract claims are accurate**
`verify-design-contract.mjs:28` requires exactly seventeen labels and the pre-ticket table has
exactly seventeen `sidebar: true` rows. Adding an eighteenth is safe, as the plan states.
Glob-driven route registration also makes the `src/api/router.ts` prohibition workable.

## 4. Positive Observations

- **The problem statement is genuinely first-rate.** "The failures that hurt do not throw" is
  the correct framing for this product, and the six concrete examples make the abstraction
  falsifiable rather than decorative.
- **It cites an existing precedent instead of inventing an idiom.** Pointing at
  `decided_not_notified` (`dashboard.routes.ts:221` → `DashboardPage.tsx:93`) and saying "extend
  this" is exactly how a codebase stays coherent under a parallel fleet.
- **The verification section refuses the easy pass.** "A green screen against healthy seed data
  proves nothing" — mandating manufactured failure is the difference between a status screen and
  a decoration, and it is the right hard gate.
- **Parallel-work hazards were anticipated, not discovered.** The MRQ-73 ownership split, the
  predicted `api-registry.json` conflict, and the stated resolution (rebase, rebuild, regenerate)
  are the kind of foresight that prevents a mid-cycle collision.
- **The design constraint is specific.** "Elements never jump" is restated with its concrete
  mechanics — reserved heights, fixed widths, constant row counts, tabular numerals — rather than
  gestured at.

The gap is not care or judgment; it is that the ticket was never converted into a plan. Add the
implementation section and the threshold table, correct the three schema claims, and this passes.
