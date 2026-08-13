# Plan Review: MRQ-79 — Inbound Resend webhook

Reviewed against `github/main` @ `75b871d9` (the sha the plan itself names). All
line numbers below were re-verified on that tree, not on the primary checkout
(which sits behind at `2aa398a0`).

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The plan is well-researched on the parts it covers — it names the right sha,
correctly identifies the outbound-webhook namespace collision, and calls out the
out-of-order/at-least-once trap with the real retry ladder. But it drops three
things the ticket makes mandatory: the `consumer.ts` batch-provider-id fix the
ticket says must be *carried with this work*, AC1's "moves the outbox row off
`'sent'`" (which collides with a `CHECK` constraint and ~8 modules of mirrored
enums), and AC5's self-hoster `unknown` degradation. It also points the builder
at the wrong interface for its one UI scope item — `WebhookFacts` is the
*outbound* connected-tools card, i.e. precisely the ground the plan's own sibling
boundary forbids touching.

## 3. Issues

**[CRITICAL] Scope (missing entirely) — the "CARRY THIS FIX WITH IT" mandate is absent**

The ticket is explicit: `src/jobs/mail/consumer.ts` stamps
`providerIds[index] ?? providerIds[0] ?? \`batch:${row.idempotency_key}\`` on
batch rows, and "a wrong provider id would join a bounce event to the WRONG
speaker, so it must be fixed as part of this work, not before it." Verified still
present on main at `src/jobs/mail/consumer.ts:251`. The plan never mentions
`consumer.ts`, does not list it in Scope, and does not claim it in the Sibling
boundary section — so a builder following the plan literally will ship the join
(Scope item 2) on top of a provider id that can be another speaker's. That is
worse than the current state: today a stranded speaker is invisible; after this,
a stranded speaker could be *named as delivered* while a different speaker is
flagged as bounced.

**Recommendation:** Add a scope item claiming `src/jobs/mail/consumer.ts`.
Specify the corrected behavior, not just "fix it": when `providerIds[index]` is
absent, never fall back to another row's id — write `NULL` (or a
provably-non-joinable sentinel that cannot collide across rows) and treat the row
as un-joinable rather than mis-joinable. Add a test that a short or misaligned
batch response never assigns the same `provider_message_id` to two rows. Add
`consumer.ts` to the "You own" list so MRQ-80 does not race it.

---

**[CRITICAL] Scope §3 / Acceptance — AC1 ("moves the outbox row off 'sent'") is unaddressed and its blast radius unscoped**

Ticket AC1: "A hard bounce moves the outbox row off `'sent'`." The plan proposes
only a parallel structured `delivery_state`, which leaves the row at
`status='sent'` forever. On main, `status` is constrained by
`CHECK (status IN ('queued','sent','suppressed','failed'))`
(`migrations/0001_init.sql:298`), mirrored in `OUTBOX_STATUSES`
(`src/db/schema.ts:99`) and re-declared as literal unions or Zod enums in at
least: `src/routes/submissions.routes.ts:44`,
`src/routes/submission-reversal.routes.ts:62`,
`src/routes/submissions.queries.ts:187`, `src/lib/delivery-health.ts:68`,
`src/api/submissions.ts:69`, `src/ui/submissions/AcceptanceReversalPanel.tsx:10`,
plus `status = 'sent'` predicates in `health-surface.routes.ts` (four) and
`submissions.queries.ts` (two). SQLite/D1 cannot `ALTER` a `CHECK`, so adding a
fifth status means a full table rebuild migration. The two readings of AC1 differ
by an order of magnitude in blast radius, and the plan picks neither.

**Recommendation:** Resolve this explicitly before implementation, with an
operator ruling on the ticket. Option (a), likely correct and much smaller: keep
`status` as the *handoff* fact and restate AC1 as "`delivery_state` removes the
row from the 'this speaker was told' set everywhere the product asks that
question" — then enumerate in the plan exactly which predicates change. Option
(b): rebuild the `CHECK` with a `'bounced'` status and list every enum, type, and
query above as in-scope. Either way the plan must name the choice and the file
list; it currently implies (a) by omission while the ticket's wording reads as (b).

---

**[CRITICAL] Scope §6 — points at the wrong interface, and at the sibling's ground**

The plan says `src/lib/delivery-health.ts` "already carries a `WebhookFacts`
interface (line 138) and a comment at line 195 naming this exact missing signal.
Wire real state into it." Both halves are wrong:

- `WebhookFacts` at line 138 is `{ endpoints, failed, retrying }` — consumed by
  `webhooksCapability` at line 704, which renders the card labelled **"Connected
  tools"** with `href: "/settings"`. That is Marquee's *outbound* webhook health,
  i.e. exactly the MRQ-128 territory the plan's own Non-goals and Sibling
  boundary sections forbid touching.
- The comment about the signal we don't receive is at lines 192–196, on
  `DeliveryTotals.sent` ("whether these arrived is reported over a provider
  webhook Marquee does not receive") — a different structure entirely.

A builder executing §6 as written will edit MRQ-128's capability card and trip
the boundary the plan drew two sections earlier.

**Recommendation:** Rewrite §6 to name the real surfaces: `DeliveryTotals`,
`OwedFact` / `summarizeSpeakerFollowups`, and the `outbox_status` fact at
`delivery-health.ts:68`. Introduce a *new* fact type (e.g.
`InboundDeliveryFacts`) rather than overloading `WebhookFacts` — the name
collision is precisely the confusion the plan's own warning section exists to
prevent.

---

**[MAJOR] Scope (missing) — AC5 self-hoster degradation has no plan step**

Ticket AC5 is unambiguous and is the acceptance the open-source framing hangs on:
a different mail provider or none leaves delivery state `'unknown'`, the UI says
"your mail provider does not report delivery", and it must never imply green. The
plan mentions no `unknown` state, no absent-binding path, and no copy. This is
also a runtime-safety gap: with no webhook secret bound, the route must degrade
deliberately rather than throw on an undefined binding.

**Recommendation:** Add a scope item. Default `delivery_state = 'unknown'` for
every existing and new row. When the secret binding is absent, the endpoint
answers a clean, non-5xx refusal and logs once, not per request. The health
surface renders the unreported sentence at neutral tone (not success, not
warning). Test both the missing-binding path and the rendered copy.

---

**[MAJOR] Scope §3 — event-type coverage is unenumerated, so AC2 is storage-only**

The plan lists the *stored values* but never the *inbound event types* or the
mapping between them. Resend emits `email.sent`, `email.delivered`,
`email.delivery_delayed`, `email.bounced`, `email.complained`, `email.opened`,
`email.clicked`. `email.delivery_delayed` is the natural "still trying" signal
that AC2 asks for and it appears nowhere in the plan. AC2 also asks how a soft
bounce *reads* ("still trying, we will tell you if it stops") and that it does
**not** alarm — a health-level decision, not a storage decision.

**Recommendation:** Enumerate the handled types and their mapping to
`delivery_state`, including which are deliberately ignored (`opened`, `clicked`)
and how an unknown future type is absorbed. State the `HealthLevel` each state
produces, with soft bounce explicitly informational.

---

**[MAJOR] Non-goals — AC3 is delegated to MRQ-80 with no record on the ticket**

The delegation is substantively correct: MRQ-80's AC1 covers the
`settled.status = 'sent'` exclusion at `src/jobs/cascade/decisions.ts:524` inside
`notifyExistingDecisions` (line 484). But MRQ-79's ticket still carries AC3 as
its own, and the terminal audit reads the ticket, not the plan — so MRQ-79 will
be audited against an AC its plan deliberately declined.

**Recommendation:** Amend the ticket (strike AC3, point to MRQ-80) or record the
delegation as a Lattice comment on MRQ-79 before implementation starts. Separately,
note the *data* dependency the plan omits: MRQ-80's ledger reads the state MRQ-79
writes, so the column and enum names must be agreed across the two branches now,
not reconciled at merge.

---

**[MAJOR] Scope §1 — the HMAC "reuse" is not the drop-in the plan asserts**

The plan says "Reuse the `crypto.subtle` HMAC already in
`src/lib/r2/rate-limit.ts:24` — do not hand-roll a second one." That function is
`async function hmacHex(...)` — **not exported** (verified: the file's only
exports are `RateLimitPolicy`, `UPLOAD_RATE_LIMITS`, `RateLimitDecision`,
`checkUploadRateLimits`, `rateLimitHeaders`). It also keys the HMAC on a raw
UTF-8 string and returns hex. Svix needs: strip the `whsec_` prefix and
**base64-decode** the remainder as key material; sign
`` `${svix-id}.${svix-timestamp}.${rawBody}` ``; compare against **base64**
signatures in a space-separated, versioned header (`v1,<sig> v1,<sig>` — multiple
during secret rotation); in constant time. Reused verbatim, it produces a
verifier that rejects every legitimate event.

**Recommendation:** Plan to *extract* a shared HMAC primitive (exported, with a
raw-bytes output the callers format) rather than "reuse in place". State
explicitly: raw body read via `await c.req.text()` **before** any JSON parse
(re-serializing parsed JSON breaks the signature — the classic footgun here),
constant-time comparison, and a timestamp tolerance (5 minutes) for replay
rejection distinct from idempotent replay of a valid event.

---

**[MAJOR] Scope §3/§4 — the migration's shape is unspecified, and idempotency depends on it**

"Store structured delivery state" does not say *where*: new columns on `outbox`,
or a new table? Both AC4 (idempotent replay) and Scope §5 (out-of-order) hinge on
this and neither is satisfiable without persisted keys the plan never names —
replay-suppression needs a stored `svix-id` under a uniqueness constraint;
out-of-order needs a stored event timestamp to compare the incoming
`created_at` against.

Also: `outbox.provider_message_id` (`migrations/0001_init.sql:304`) has **no
index** — the existing outbox indexes are on `(status, scheduled_for, created_at)`,
`(event_id, created_at)`, `(person_id, created_at)`, and `ics_uid`. Scope §2's
join is therefore a full scan of the outbox on every inbound event.

**Recommendation:** Name the shape in the plan. Suggested: columns on `outbox`
(`delivery_state`, `bounce_type`, `bounce_subtype`, `delivered_at`,
`delivery_event_at`) for the current-state read, plus a `mail_delivery_events`
table with `UNIQUE(svix_id)` for replay suppression and audit trail. Add
`CREATE INDEX idx_outbox_provider_message_id ON outbox(provider_message_id)
WHERE provider_message_id IS NOT NULL` — R7 makes a scan-per-webhook a defect,
not a nit. State the guard as a rule: apply only if
`incoming.created_at > stored delivery_event_at`.

---

**[MINOR] Scope §1 — the route's policy block is unstated**

Every route in this codebase carries an explicit policy
(`policy: { auth: { kind: "public" }, rateLimit: {...}, concurrency: ... }` —
see `src/routes/public-form.routes.ts:808`). The plan says "public by grant,
unauthenticated" but names no rate-limit bucket or keying. This matters both ways:
an IP-keyed limit on a provider webhook silently drops legitimate bursts (and a
dropped event becomes a permanently wrong screen after the retry ladder expires),
while no limit at all is an unauthenticated abuse surface.

**Recommendation:** State the chosen policy and the reasoning. Also note the
latency constraint: the handler must answer 2xx fast enough that Resend's
5s/5m/30m/2h/5h/10h ladder is never triggered by our own slow work.

---

**[MINOR] Acceptance — repo-convention deliverables are missing from the list**

A new JSON API route moves `check:api` (served-JSON ↔ rendered-docs parity, in
`pr-gate`), and every ticket in this repo carries a `tests/ac-claims/MRQ-*.json`
(262 files on main) consumed by `trace:ac`. The plan's Acceptance list stops at
"`npm run pr-gate` green", which is true but hides two concrete artifacts the
builder must author.

**Recommendation:** Add `tests/ac-claims/MRQ-79.json` and any regenerated API
docs to the deliverables explicitly.

---

**[MINOR] Scope §1 — the secret binding is unnamed and its operator path undocumented**

"a `whsec_` secret in a new binding" gives no name, does not say it is a Worker
*secret* (not a `wrangler.jsonc` var — compare `RESEND_API_KEY`, absent from
`wrangler.jsonc` and typed on `MailConsumerEnv` at
`src/jobs/mail/consumer.ts:16`), and does not name the env interface it joins or
the `.dev.vars` entry local tests need. The ticket's operator dependency is
undischargeable without this.

**Recommendation:** Name it (e.g. `RESEND_WEBHOOK_SECRET`), say which env
interface(s) it extends, and add the `wrangler secret put` + Resend-dashboard
steps to `DEPLOY.md` as a listed deliverable — the plan says "document them" but
does not say where.

---

**[MINOR] Scope §4 — migration number is right; keep the re-check instruction**

Verified: `github/main` has duplicate `0009` (×3), `0010` (×3), `0011` (×2) and
tops out at `0012_people_annotations.sql`. `0013` is correct today. The plan
already says to re-check at write time — keep that, since MRQ-80 and MRQ-128 are
both live and either may take it first.

## 4. Positive Observations

- **Verified against a named sha.** The plan states its basis
  (`github/main` @ `75b871d9`) and its claims hold up against it — the
  "confirmed absent on main" section is accurate, and the migration-number
  research is real research rather than a guess.
- **The namespace warning is the single most valuable thing in the plan.**
  Calling out `WEBHOOK_DELIVERY_STATUSES` and `webhook_endpoints` /
  `webhook_deliveries` as outbound-and-not-yours would have saved a builder
  hours. (That the plan then trips on the same confusion in §6 is the issue
  above — but the instinct was right and the warning should stay.)
- **The sibling boundary is concrete.** Three live agents named, with the exact
  files and tables each owns and a "stop, you have crossed a line" test the
  builder can apply mid-edit. This is the right shape for a fleet.
- **The ordering trap is stated as a trap.** At-least-once plus no ordering
  guarantee, the actual retry ladder, and the specific failure ("a
  later-arriving older event must not overwrite a newer state") — stated
  precisely enough to test against.
- **Non-goals are crisp and correctly reasoned.** The MRQ-79/MRQ-80
  detection-vs-recovery split is a genuinely good decomposition; the only defect
  is that it was never recorded against the ticket AC it displaces.
