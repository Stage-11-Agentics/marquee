# Marquee — state-model gaps, verified

**Date:** 2026-08-10
**Source:** the Sunday-evening state-model conversation (Maria's AV form; webhooks; the handbook; "decided but not told"; the assistant who gets the invite).
**Verified against:** `migrations/0001_init.sql` + `0002_venue_geography.sql` (the real shipped schema, 46 tables) · `SPEC.md` §3/§4/§5 · `USER_STORIES.md` · `EVALUATION.md` · `BUILDPLAN.md` · `SITEMAP.md` · `STATEMAP.md` · `prototypes/pipeline-v1.1/index.html` at v1.7 · the 65 Lattice tickets.

**Why this reads as good news.** Every ticket these six touch is still `backlog` — the un-accept cascade, the speaker portal, the chase board, webhooks, the public form. The one exception is *Bulk and record-owned decisions with cascade*, `in_progress`. Nothing here is a rewrite of merged code; it is contract work landing ahead of its builders.

---

## Part 1 — the six issues

### 1. A cancelled task has nowhere to live

**Claim.** Un-accepting a talk should stop the homework, but `open|done` has no third value.

**Verified — worse than stated.** Three things are simultaneously true:

- `migrations/0001_init.sql:608` — `status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done'))`. The CHECK constraint is real; there is no third value and no `cancelled_at`.
- The **prototype already offers the choice.** `showUnacceptModal()` renders a `<select>` with *Cancel open tasks* / *Retain for records*, and the confirm handler does nothing with it but write a toast string. The design promised a state the schema cannot store.
- **AC-123 makes honouring that choice a graded criterion**, and `EVALUATION.md:450` tests it e2e: *"the reversal dialog enumerates portal tasks, scheduled emails, and calendar invites, each with cancel/retain, and honours the choice."*

So a builder picking up *Calendar invites and the un-accept cascade* has an AC that requires the behaviour, a prototype that draws the control, and a CHECK constraint that rejects the value. They will stall or improvise — and the improvisation is `DELETE`, which destroys the record the option calls "for records."

**The consequence nobody named.** It is not two wrong screens. `AC-125` puts **`task overdue`** in the minimum set of automated triggers. An open task on a cancelled talk keeps firing overdue mail *at a real speaker, about a talk that no longer exists*, on the one product whose headline claim is that the system does the chasing. That is the demo failure, not the bookkeeping one.

**A design ambiguity that falls out of it.** Once `cancelled_at` is a tombstone rather than a delete, the dialog's *"Retain for records"* label becomes wrong — cancelling already retains the record. Either the second branch means *keep chasing this person anyway* (real, if they still moderate another session), or the two options collapse into one. See open question Q1.

### 2. The state map draws only forward edges

**Claim.** The state diagrams aren't great.

**Verified, with a specific diagnosis.** `STATEMAP.md` is 313 lines and 12 machines, and it is not slop in the sense of being wrong — §1 (submission status) and §7 (acceptance cascade) are precise and load-bearing. The defect is systematic and worth naming, because it *caused issues 1 and 5*:

- **§6 Speaker onboarding** runs `Assigned → InProgress → Complete` and `→ Overdue`. Every edge moves forward. There is no cancellation, no reversal, no arrival from the un-accept cascade — the exact machine whose missing state is issue 1.
- **§7 Acceptance cascade** draws the accept path and the Airtable-inbound path. It does not draw the **un-accept cascade at all**, despite it being AC-121–124 and one of the product's named differentiators (`List B #6`: *"Nobody ships reversal"*).
- **No machine for notification state** — which is issue 5, sitting in the gap between §1 and §7.

A state map that only draws the paths that succeed is a diagram of the demo, not of the product. Its whole value is catching what issue 1 is: an edge with no state at the end of it.

### 3. Outbound webhooks: no table, and no routes and no screen either

**Claim.** The spec promises outbound webhooks with real ACs but the schema has no table.

**Verified, and it is a three-hole gap, not one:**

| Layer | Status |
|---|---|
| Story + AC | ✅ `US-68` / **AC-241** — HMAC over `id.timestamp.body`, six-event allowlist, replay idempotency |
| Build plan | ✅ `BUILDPLAN.md:109` — **M-54**, 4 h, gated on CP-2; ticket *API surface completion and signed outbound webhooks* (`backlog`) |
| Validation | ✅ `validation-plan.md` row 197, `post-merge-smoke` |
| **Schema** | ❌ No `webhook_endpoints`, no `webhook_deliveries` in either migration |
| **API surface** | ❌ `SPEC.md` §4.2 has **no** `/webhooks` routes. The only `webhook` in §4.2 is `POST /mirror/webhook` — Airtable **inbound**, the opposite direction |
| **Screen** | ❌ Not in `SITEMAP.md` (`#settings/api` is tokens only) and not in the prototype |

The queue binding exists (`WEBHOOK_QUEUE`, wired in MRQ-1's plan), which is exactly why this reads as complete on a skim.

**The sharp edge:** `check:api` asserts CLI-registry/OpenAPI parity and fails on any request path missing from the public OpenAPI document. M-54 must invent routes absent from the SPEC — so the gate that exists to catch drift will fire on the feature's own PR, at gate time, on Tuesday.

### 4. Speaker Handbook: in the prototype, in the prose, in no table

**Claim.** Same shape as webhooks — promised screen, no table.

**Verified, and Atin's recollection is right — it *is* in the 1.7 prototype.** Two pages render in the portal ("Venue, arrival, and green room" · "Presentation and A/V guidance"), as a `Handbook page` chip card opening a modal with hardcoded body copy.

| Layer | Status |
|---|---|
| AC | ✅ **AC-233**, appended to US-39 — *"authored as static markdown per event"* |
| Screen prose | ✅ `SPEC.md:450` — renders in the portal's right stack |
| Prototype | ✅ v1.7, two pages, content inline |
| Ticket | ✅ M-15 / *Speaker portal* (`backlog`) |
| **Schema** | ❌ No `handbook_pages` table, and no `event_settings` key for it |
| **Authoring surface** | ❌ No route in `SITEMAP.md`, nothing in the prototype's settings |

"Authored as static markdown per event" names a writer that does not exist. AC-233 is the one cuttable criterion sitting on a Tier A story (`EVALUATION.md` gate 19 exists specifically so it can't vanish silently) — which makes it *more* likely, not less, that a builder quietly drops it and the gate report never says so.

### 5. "Who have I decided but not told yet?" has no answer

**Claim.** Decisions and notifications are separate steps, and no screen shows the gap.

**Verified — the gap is real, but narrower and more interesting than Sessionboard's.** Ours is not *"notification is a separate manual act"* (`PHILOSOPHY.md` 2: the status change **is** the notification, and `List B #4` sells that as a win). Ours is that the automatic notification has exactly **three ways to not arrive**, all of them designed in on purpose:

1. **Airtable inbound.** `AC-226` is explicit: an inbound status change sets the status and `last_write_source='airtable'` and **does not run the cascade** — zero outbox rows. Correct (a spreadsheet edit must not mass-mail 300 speakers) and it manufactures decided-but-unnotified records by design.
2. **Suppressed or failed.** `outbox.status ∈ queued|sent|suppressed|failed` with `suppressed_reason`. Demo-safe suppression is the ordinary case during judging.
3. **No valid recipient.** The accept-cascade modal already carries "the honest line about records with no valid speaker email" — the honest line, and then nowhere for that record to go.

**What exists already:** the v1.7 prototype paints a `Notified` column and a `notifiedAt` field with the comment *"Status change queues it automatically; this answers 'did it land, when.'"* That is the receipt on a row. It has **not been folded into SPEC/USER_STORIES/EVALUATION** — no AC covers it. And a column you can add is not an answer to *"what have I missed?"*; you have to already suspect.

**Good news:** it is fully derivable, zero schema. `submission_decisions.outbox_id` is null, or joins an outbox row not in `sent`. Three producers, three distinguishable reasons, one query.

### 6. The assistant gets everything

**Claim.** Assistant submits for their boss; login link, confirmation and calendar invite all go to the assistant. Known limitation; write it in the gate report.

**Verified — and the model is further along than the framing suggests.**

The *fusion is in the form*, not the schema. The public CFP collects one email under **`Primary speaker`**, and the submission record labels the first participant **`Submitter · Speaker`** — one person wearing both roles by construction. Whoever types becomes both.

But underneath: `submissions.submitter_person_id` is a real column; `participations.role` already includes `submitter` alongside `speaker`; `people` is org-level and keyed by email; `speaker_tasks.person_id` is per-person; auth is per-person magic links. **The split is already modeled.** And it is already specified — **AC-223**: *"Confirmation and status emails go to the submitter; task and profile requests go to the speaker"*, with **AC-224** putting both on the record with roles labelled.

AC-223/224 sit in `AC-170 – AC-224`, the post-competition band — *"modeled where cheap, not built."* So this is not an unknown limitation. It is a **known one with an AC number**, deferred on the record, and never surfaced anywhere a judge or a README reader would see it.

**Atin's question — "would it complicate any subsequent state? maybe multi-login clashing":** no clash. Two emails means two `people` rows means two magic-link identities means two portals; `participations` already carries who holds which role, and task assignment is already `person_id`-scoped. The one genuinely new surface is **a submitter who is not a speaker opening the portal** — today the portal assumes a task list and a status hero for its own talk. That is one empty state, not a state-model change.

---

## Part 2 — proposal

### The consolidated schema move — one migration

Three of the six want schema, and `0002_venue_geography.sql` already established that additive migrations are fine after M-02. **Migration `0003` carries all three, one ticket, one review:**

```sql
-- 1. task cancellation (issue 1)
ALTER TABLE speaker_tasks ADD COLUMN cancelled_at INTEGER;
--    the open|done CHECK stays exactly as it is; cancelled is a timestamp, not a status.
--    completed_at is never written or cleared by cancellation.

-- 2. handbook pages (issue 4)
CREATE TABLE handbook_pages (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
  title TEXT NOT NULL, slug TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

-- 3. outbound webhooks (issue 3)
CREATE TABLE webhook_endpoints (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
  url TEXT NOT NULL, secret_hash TEXT NOT NULL, events_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, last_delivery_at INTEGER
);
CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY, endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id),
  event_type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, response_code INTEGER, error TEXT,
  created_at INTEGER NOT NULL, delivered_at INTEGER
);
```

**Why `cancelled_at` and not a third `status` value.** Adding `'cancelled'` to the CHECK makes every existing `status='open'` read site silently wrong — the chase board, the portal list, the overdue trigger, the comms selector all currently mean "open" and would start including cancelled work until each is found and fixed. A nullable timestamp inverts that: the *predicate* changes (`cancelled_at IS NULL`), so a read site that hasn't been updated is loudly wrong in review rather than quietly wrong in production. It also carries *when*, which a status enum doesn't, and it leaves `completed_at` untouched — Maria's slides stay done. This is the same shape as `magic_links.used_at` and `imports.undone_at`, both already in the schema.

### Per issue

| # | Prototype | Contract fold | Ticket |
|---|---|---|---|
| **1 Cancelled tasks** | Reversal modal: make the two branches *do different things* and show the receipt — a `Cancelled` chip in the portal task list, the speaker leaving the chase board. Relabel per Q1. | New **US-80**, **AC-264 – AC-267** (below). Amend `SPEC.md` §3.7 `speaker_tasks`, §5.6 portal, §5.11 chase board. | *Calendar invites and the un-accept cascade* (`backlog`) — add `cancelled_at` semantics; migration `0003` to its own ticket. **~3 h.** |
| **2 State map** | — | Repair `STATEMAP.md`: cancellation into §6, the un-accept cascade drawn in §7, a new §13 notification machine. Add a standing rule: **every machine draws its reversal edge or says there isn't one.** | Doc-only, no ticket. **~1 h.** |
| **3 Webhooks** | A `#settings/webhooks` card — endpoint list, secret, event checkboxes, `Send test`, deliveries log. | `SPEC.md` §3 (two tables), §4.2 (`GET/POST /webhooks`, `PATCH/DELETE /webhooks/:id`, `POST /webhooks/:id/test`, `GET /webhooks/:id/deliveries`), `SITEMAP.md` row. **No new AC — AC-241 already covers it.** | M-54 / *API surface completion* unchanged at 4 h and unchanged in rank. **Contract work ~45 min.** |
| **4 Handbook** | Add an authoring card in settings; keep the two portal pages, read from data. | `SPEC.md` §3 (`handbook_pages`), §4.2 (`/handbook-pages` CRUD + portal read), `SITEMAP.md` row. AC-233 unchanged. | *Speaker portal* (M-15) + a settings card. **~2 h.** |
| **5 Decided, not told** | Attention-strip row on the pipeline dashboard + an immutable built-in view. Reuse the painted `Notified` column. | New **US-81**, **AC-268 – AC-269**. Amend §5.2 attention strip and §5.9 built-in views. | *Bulk and record-owned decisions with cascade* (`in_progress` — get this to them now) or a thin new ticket. **~2 h.** |
| **6 Two emails** | Form: *"I'm submitting on behalf of someone else"* disclosure splitting name/email. Portal: submitter-without-tasks state. | **Must land regardless, and costs nothing:** name it in `EVALUATION.md`'s gate report and `SPEC.md` §10 as a known limitation **with its existing AC numbers (AC-223, AC-224)**. Draft US-82 / AC-270–272 held unminted pending Q3. | Extra credit. **~5 h** if adopted. |

### Draft stories and criteria

Next mint is **AC-264** and **US-80** (last minted: AC-263, US-79, Amendment 14).

**US-80** — *As a program lead who has reversed an acceptance, I want the speaker's outstanding homework to stop existing, so that neither of us is chased for work on a talk that isn't happening.*

- **AC-264** Reversing an acceptance with *cancel* stamps `cancelled_at` on every open task for that submission. Tasks already complete are untouched: `completed_at` is never written, cleared, or overwritten by cancellation, and the task still reads as done.
- **AC-265** A cancelled task is absent from the speaker's portal task list and from its progress count; absent from the chase board's severity, per-task-type counts and overdue totals, so a speaker whose only outstanding tasks are cancelled leaves the board; and invisible to every automated trigger and filtered-recipient selector — in particular **no `task overdue` mail is ever sent for one**.
- **AC-266** Re-accepting the submission clears `cancelled_at`, restoring those tasks to open with their due dates intact. Tasks completed before the reversal remain complete and are not re-opened; tasks completed *while* cancelled are not disturbed.
- **AC-267** Both branches are recorded: the cancellation and any restoration appear in the record's history, timestamped and attributed, and the two dialog options produce observably different states rather than the same one.

**US-81** — *As a program lead, I want to see which decisions haven't reached their speaker, so that I find out before the speaker does.*

- **AC-268** An immutable built-in view, **Decided · not notified**, lists every submission carrying a decision row whose notification has not been sent, and names which of the three reasons applies: **changed in Airtable** (no outbox row, cascade deliberately not run), **not delivered** (outbox `queued`, `suppressed` or `failed`, with the reason), or **no valid recipient**. The count also appears on the pipeline dashboard's attention strip, and when it is zero the row says so rather than disappearing.
- **AC-269** Notifying from that view is one action; it writes a new outbox row against the existing decision row and never rewrites the decision. A record that is decided and notified cannot appear in the view.

**US-82 (drafted, not minted — pending Q3)** — *As someone submitting on behalf of a speaker, I want the speaker to receive their own portal, tasks and calendar invite, so that the person who has to do the work is the person who gets asked.*

- **AC-270** The public form offers *"I'm submitting on behalf of someone else."* When on, it collects the submitter's own name and email separately from the speaker's and creates two `people` rows and two `participations` rows (`submitter`, `speaker`). When off, behaviour is exactly as today.
- **AC-271** Confirmation and decision mail goes to the submitter; task assignment, profile requests, the portal magic link and the calendar invite go to the speaker. Both appear on the record with their role labelled. *(This is AC-223 + AC-224, promoted out of the post-competition band.)*
- **AC-272** A submitter who holds no speaker role opens a portal showing their submissions' status and no task list, stating plainly that the speaker holds the homework.

---

## Part 3 — recommended adoption

Bands in the shape of the gap analysis's Decided-scope gate, so the argument is over before Tuesday.

**Contract now** — ~6 h build, ~3 h doc/prototype, all landing ahead of their builders:

- **Issue 1** in full (US-80, AC-264–267, migration `0003`). Non-negotiable: an AC already requires the behaviour and the schema forbids it, and the failure mode is overdue mail to a real speaker about a cancelled talk.
- **Issue 3's contract holes** — tables, routes, sitemap row. Not the build; the build stays at rank 7 behind CP-2. Writing 20 lines of SPEC now is what stops `check:api` firing on M-54's PR at gate time.
- **Issue 5** in full (US-81, AC-268–269). Derived, no schema, and it closes the one place our "status change *is* the notification" claim has a hole a judge could find.
- **Issue 2** — the STATEMAP repair, because it is an hour and it is the instrument that found issues 1 and 5.
- **Issue 6's honest half** — the known limitation named in the gate report and §10, citing AC-223/224. Free, and it is the difference between a judge reading a documented deferral and discovering a bug live.

**If capacity** — after the walkthrough-loop tickets are green:

- **Issue 4** (handbook table + authoring). The portal already renders it in the prototype; without the table AC-233 gets cut, and gate 19 then has to name the cut. Cheap, but genuinely cuttable.
- **Issue 6's build half** (US-82). Atin filed it as extra credit; it stays there. The state answer is clean — no multi-login clash — so if the loop goes green early this is a good use of the hours.

**Not proposed:** promoting M-54's webhook build, or building the handbook authoring UI before the loop is green.

---

## Part 4 — open questions

**Q1 — what does the reversal dialog's second branch mean?** Once `cancelled_at` is a tombstone, "Retain for records" is what cancelling already does. Either it means **keep chasing this person anyway** — real when they still moderate another session — in which case relabel to *Cancel open tasks* / **Keep tasks active**, with a sublabel naming who keeps getting chased; or the two options collapse and the dialog should offer one. Recommend: **relabel and keep two**, because "keep chasing" is a genuine case and a dialog that enumerates consequences shouldn't offer a no-op.

**Q2 — does re-accept restore, or reassign?** AC-266 proposes *restore* (clear `cancelled_at`, keep due dates), which preserves partial progress and is what "we un-cancelled the talk" means. The alternative is running the acceptance cascade fresh, which would double-assign against the restored set. Recommend restore, and let the cascade skip templates already represented.

**Q3 — mint US-82 now or hold it?** Minting adds three criteria to a contract 2.5 days from deadline; holding risks it never being written down. Recommend **draft-in-place as above, minted only if the if-capacity band opens** — with the known-limitation note landing either way.

**Q4 — noticed while verifying, not part of the six.** `#settings/venues` ships in the v1.7 prototype but is absent from `SITEMAP.md`, which lists only `tasks`, `airtable` and `api` under settings. Amendment 14 folded the venue work everywhere else; the sitemap row was missed. One line, and worth catching before the fidelity audit does.
