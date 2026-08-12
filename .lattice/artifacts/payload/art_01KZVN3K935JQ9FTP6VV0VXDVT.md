# Plan Review: MRQ-73 — Instrumentation and resilience platform

## 0. Provenance note (read first)

This review is a **replay**. MRQ-73 is already `done` on the board
(`task_01KZRNBMEGZC2XSK6RBMRF8ZTZ`) and merged to `main` as
`030a3a78` (PR #3), on top of base `78137f91`. Everything below evaluates the
plan *as a plan*, at the moment it was submitted — but where the merged result
settles a question, I say so, because that is unusually hard evidence about
whether a plan-level concern was real. Two of the concerns below were not
hypothetical: they materialized in the shipped work.

If this review is being consumed as a live gate on a fresh MRQ-73, the gate is
stale and should be dismissed rather than acted on.

---

## 1. Verdict

**FAIL (plan-level)**

Not for lack of thought — the underlying design work is strong and, where I
could check it, factually accurate. It fails because **the document filed under
`### Plan` is a verbatim restatement of the task description**, and because two
of its sections contradict its own constraints in ways that force a decision
during implementation that the plan was supposed to make.

---

## 2. Summary

Reviewed a ten-part instrumentation ticket (A–J: server logging, build
identity, cross-async correlation, client fallback layer, error beacon, deep
diagnostics, performance, support handshake, CLI, trust docs) against the task
description, the repo at MRQ-73's merge base, and the parallel MRQ-74
constraints. The scoping is excellent and unusually well-grounded — I spot-checked
its numbers and they are exact — but the plan adds **zero** information beyond
the task description: no file-by-file steps, no ordering inside the ten parts,
no named test files, no risk register, no cut-line for what gets dropped if the
suite budget or the deadline bites. The key concern is that section J
("join `audit_log` to `request_id`") requires a schema change that the plan's
own out-of-scope list forbids, and section D's file list contradicts the
ownership contract that keeps MRQ-73 and MRQ-74 from colliding.

---

## 3. Issues

**[CRITICAL] `### Plan` — The plan is a byte-for-byte copy of the task description**

Lines 104–193 of the review packet reproduce lines 14–101 with no additions.
A task description states *what and why*; a plan is supposed to add *how, in
what order, in which files, verified by which test*. Everything a plan review
exists to catch — sequencing, file conflicts, test placement, the point where
scope must be cut — is precisely what was omitted. The single sentence of actual
planning in the whole document is the Delivery line "Commit part A+B+D first as
a standalone landable unit," which is good instinct and also the only ordering
decision made anywhere across ten workstreams.

This is what lets the two contradictions below survive to implementation: nobody
re-derived the scope against the constraints, because nothing was re-derived at all.

**Recommendation:** Return to `in_planning` and produce a plan that adds, at
minimum: (a) an ordered landing sequence of commits with what each one makes
true; (b) for each part, the files created/modified — not the ownership glob,
the actual paths; (c) the name and pool (`tests/unit` node vs `tests/integration`
worker) of every new test file, with an estimate against the 29s hard kill;
(d) the explicit cut-line — which of E–J are dropped, in what order, if the
gate or the clock bites.

---

**[CRITICAL] Scope J vs. "Explicitly out of scope" — the `audit_log` join requires the migration the plan forbids**

Section J ends with "Join `audit_log` to `request_id` so 'who did this, and what
broke' is one query." The out-of-scope section states "No D1 tables, no
migration." `audit_log` at MRQ-73's base (`78137f91`) has migrations 0001–0005
and no `request_id` column — so the J item is unimplementable without a
migration, and the plan gives no signal about which of the two statements wins.

Verified outcome: it could not be done inside MRQ-73. The column shipped later
as `migrations/0006_audit_log_request_id.sql` in a separate PR (`23253a27`, #5).
That is the correct engineering answer, but it was discovered during
implementation rather than decided during planning, which is exactly the cost
this gate exists to avoid.

**Recommendation:** Pick one and write it down. Either (a) move the `audit_log`
join out of MRQ-73 into its own ticket and delete the bullet from J, or (b) carve
a single explicit exception — "one additive nullable column plus an index,
migration 0006, no new tables" — and amend the out-of-scope line to match. Option
(a) is what actually happened and is the cleaner unit.

---

**[MAJOR] Scope D vs. File ownership — the declared OWNS list does not contain the files D requires**

D says: "Convert the dashboard plus the highest-traffic screens (submissions,
review, portal)." The OWNS list names `src/ui/shell/api-client.ts`,
`error-reporting.ts`, `AppShell.tsx`, `dashboard/DashboardPage.tsx` — and no
submissions, review, or portal file. With MRQ-74 running in parallel and the
ownership list functioning as the collision contract between them, a scope item
that mandates edits to unlisted files is a contract the implementer must break
to satisfy.

Verified outcome: MRQ-73 landed edits to eight `src/ui` files outside its OWNS
list — `submissions/SubmissionsPage.tsx`, `review/ReviewerPage.tsx`,
`portal/PortalPage.tsx`, `portal/CoSpeakerPage.tsx`, `app.tsx`,
`shell/ErrorSurface.tsx`, `shell/error-surface.css`, `dashboard/dashboard.css`
(commit `2b4621f4` et al.). It happened to be safe because MRQ-74 was nowhere
near those files, which is luck, not design.

**Recommendation:** Extend OWNS to the exact paths D requires — including the
new `ErrorSurface.tsx`/`error-surface.css` and `app.tsx` — before either ticket
starts, and confirm MRQ-74's plan claims none of them.

---

**[MAJOR] Overall scope — ten workstreams in one implementation pass, with one sentence of sequencing**

A–J spans roughly 45 discrete deliverables across the Worker, the client, the
build, the CLI, the generated `SKILL.md`, and the docs — several of which
(diagnostics endpoint, beacon route, CLI commands) each independently obligate
the `vite build` → `generate-api-registry` → `check:api` cycle, and one of which
(`SKILL.md` byte-equality) fails the suite if forgotten. The plan acknowledges
the risk implicitly ("even if a later part hits a gate wall") without ever
resolving it into an order.

**Recommendation:** Declare the landing sequence explicitly as commits — e.g.
1) B build identity, 2) A server logging, 3) D client + fallback (closes the
provoking defect; this is the landable unit), 4) C queue correlation, 5) E beacon
+ route, 6) F diagnostics + heartbeat, 7) G perf, 8) I CLI + skill regen,
9) H handshake, 10) J docs + off switch — and state which suffix is droppable.
Regenerate the registry once per route-adding commit, not once at the end.

---

**[MAJOR] Scope E — a public, unauthenticated log-write endpoint with only client-side throttling described**

`POST /api/v1/telemetry/client-errors` is `auth: { kind: "public" }` — correct,
since errors happen on signed-out pages — and every abuse control the plan
describes (throttle per session, dedupe by message+stack, `sendBeacon`) lives in
the client. An attacker does not run your client. The only server-side control
named is "`write` rate bucket," with no cap stated. Section J itself warns that
Workers Logs costs real money at conference scale, which makes an
anonymous-write-to-log endpoint a cost-amplification surface, not just a spam one.

**Recommendation:** Specify the server-side controls in the plan: per-IP rate
limit and its number, a hard request-body byte cap rejected *before* Zod parse,
the per-field length caps as concrete integers, and what the Worker does when the
bucket is exhausted (drop silently at 204 — never log the rejection, or the flood
becomes the log). Add a test that an oversized body is rejected without emitting a
log line.

---

**[MAJOR] Scope F — MRQ-74 consumes `/telemetry/diagnostics`, but its response shape is never specified**

F lists the diagnostics *contents* (D1 ping, KV, R2 head, queue bindings,
migration version, build info, `status: ok|degraded`) but not the response
*schema*. MRQ-74 is told to consume it, runs in parallel, and is forbidden from
touching MRQ-73's files — so MRQ-74 must code against a shape that will not exist
until MRQ-73 merges. "MRQ-73 merges FIRST" sequences the merge, not the work.

**Recommendation:** Freeze the diagnostics response contract in the plan itself —
the Zod schema and one example JSON body — so MRQ-74 can build against a written
artifact instead of against a promise. Also define the degraded-vs-ok predicate
explicitly (which failing probes downgrade the verdict); MRQ-74 will render it and
must not invent its own rule.

---

**[MINOR] Scope G vs. E — Web Vitals are routed through an endpoint named and validated for errors**

G sends LCP/INP "from the client through the same beacon," but E defines that
beacon as `/api/v1/telemetry/client-errors` with an error-shaped Zod schema. A
performance sample is not a client error, and a route whose name asserts one
thing while carrying another is a contract lie that outlives the ticket.

**Recommendation:** Choose in the plan: either a discriminated union
(`{ kind: "error" | "vitals", … }`) on a route renamed to something honest
(`/api/v1/telemetry/events`), or a second route. Note that renaming after E lands
costs a second registry regeneration — which is an argument for deciding now.

---

**[MINOR] Scope A — `console.*` call sites are pinned by line number**

"`src/index.ts:145`", "`submission-record.routes.ts:588`" will drift the moment a
sibling agent touches those files, and this fleet has dozens of live worktrees.

**Recommendation:** Identify them by predicate, not coordinate, and make the
invariant enforceable: a check (or test) asserting zero raw `console.*` outside
`src/lib/observability/`. That also prevents regression, which the line list
cannot.

---

**[MINOR] Verification 4 — the smoke instruction names a dev server the repo does not use**

The plan says "`wrangler dev`"; `CLAUDE.md` documents `npx vite dev` (the
Cloudflare plugin runs the real Worker locally). Smoking a different runtime than
the one the repo builds and ships weakens the one gate the plan itself calls
non-negotiable.

**Recommendation:** Use `npx vite dev` and say what "induce a genuine failure"
concretely means — the exact route or input that produces the 500, so the smoke is
reproducible by the reviewer rather than improvised by the implementer.

---

**[MINOR] Contract position — no AC coverage, and the compensating control is a hand-driven pass**

Shipping `tests/ac-claims/MRQ-73.json` with `owns: []` is right (observability is
genuinely absent from R1–R50, and MRQ-72 set the precedent). But it means ten
workstreams land with no acceptance criterion, and the plan's answer is a manual
browser smoke — the one verification step that leaves no artifact.

**Recommendation:** Have the smoke pass emit a durable artifact: paste the
matching log line and the on-screen reference code into the PR body, so the
correlation claim is evidenced rather than asserted. Cheap, and it makes the gate
auditable after the fact.

---

**[MINOR] Scope J — the "real off switch" is promised but never verified**

J commits to `observability.enabled: false` plus an env var disabling the client
beacon. Verification tests the allowlist, truncation, caps, throttle, backoff and
taxonomy — but never the off switch, which is the single control an
organizer-operator is most likely to exercise and the one whose failure is a
privacy defect rather than a bug.

**Recommendation:** Add two assertions: beacon-disabled env → zero network calls
from `error-reporting.ts`; observability disabled → the app still serves normally.

---

## 4. Positive Observations

- **The factual grounding is exact, and I checked it.** "39 `fetch(` call sites
  across 21 files in `src/ui`" is precisely right at the merge base (`git grep`
  at `78137f91`: 39 hits, 21 files). "The fast suite has a 29s hard kill and a
  30s budget" matched `run-test.mjs` at that commit exactly
  (`HARD_LIMIT_MS = 29_000`, `budgetMs: 30_000`). Plans that cite numbers usually
  cite them approximately; this one earned them.
- **The diagnosis is better than the symptom.** The provoking defect was a bad
  banner; the plan correctly identifies it as a correlation break with the id
  present at both ends and used at neither, then fixes the *class* rather than
  the banner.
- **Allowlist-not-denylist is the right architecture, stated as the load-bearing
  rule.** Making a speaker's email unloggable because the shape has no slot for it
  is structurally stronger than any redaction pass, and elevating it above the
  other bullets is good editorial judgment for a PII-carrying OSS tool.
- **Out-of-scope is explicit and principled.** Naming Sentry as a deferred
  extension point while rejecting PostHog *on principle* is the kind of boundary
  that survives contact with a deadline.
- **Cross-async correlation (C) is the item most plans omit.** Threading the id
  into the queue message body is what separates logs that answer questions from
  logs that merely exist, and the plan says so plainly.
- **Real-artifact smoke is named non-negotiable, with the reason.** "Green tests
  would not have caught the provoking defect; a smoke pass would have" is exactly
  the right justification, and it is the standard this house holds.
- **Parallel-ticket hygiene was attempted at all** — an ownership split, a
  declared merge order, and a named expected conflict with its resolution. The
  contract has the gap noted above, but most plans do not write one down.
