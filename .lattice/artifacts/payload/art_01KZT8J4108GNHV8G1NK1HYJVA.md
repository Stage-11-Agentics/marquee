# Plan Review: MRQ-104 — Close the CLI parity gap

## 1. Verdict

**FAIL (plan-level)**

Two blocking issues, both verified against the tree rather than inferred:

1. The headline acceptance criterion — *"drives 9+ of the 11 walkthrough-loop steps"* — is
   **arithmetically unreachable** inside the scope the ticket and plan both declare. Best case
   is 5–6 of 11. The plan neither claims 9 nor flags the contradiction.
2. Deleting the two `curl` blocks from `SKILL.md` — an explicit AC — **breaks
   `tests/node/skill.AC-142-144.test.mjs:24-25`**, which assert those blocks' contents are
   present. The plan describes the test work as *"extend"*, which will not cover a deletion.

Neither requires a redesign. Both require the plan to say something it currently does not, and
issue 1 needs an operator ruling on the AC before a delegator starts building toward a number it
cannot hit.

## 2. Summary

Reviewed the MRQ-104 plan against `cli/{registry,marquee,client,generate-skill}.mjs`,
`cli/api-registry.json`, `src/routes/{agenda,event-settings,search,submission-record}.routes.ts`,
`src/api/concurrency.ts`, `scripts/checks/check-api.mjs`, both CLI/skill test files, and the
`sequence/research/cli-parity.md` dossier it keys to. **The technical core of this plan is
accurate and unusually well-grounded** — every one of the 13 operation IDs it names exists in
`cli/api-registry.json` with the method and path it claims, the "only two `if-match` routes"
assertion is exactly right (`grep 'concurrency: "if-match"'` returns precisely
`agenda.routes.ts:280` and `:351`), `GET /agenda` really does return `sessions[].etag`
(`agendaSessionSchema`, `agenda.routes.ts:86`), and the `check:api` reasoning is correct because
that script reads `cli/api-registry.json` against the served OpenAPI and never consults
`cli/registry.mjs` at all.

The key concern is not feasibility but **AC reconciliation**: the plan silently inherits an
impossible target from a counting error in the research dossier, and its verification section
misses a deterministic test failure that its own scope guarantees.

## 3. Issues

---

**[CRITICAL] Acceptance Criteria / "Commands added" — the 9-of-11 loop-step AC cannot be met by this scope**

The ticket's first AC is *"marquee (or node cli/marquee.mjs) drives 9+ of the 11 walkthrough-loop
steps."* The plan's own "Commands added" table claims exactly four loop steps: **2, 9, 10, 11**.
Working the full enumeration (`cli-parity.md` §5, corroborated by `SPEC.md:572` naming step 8 as
*evaluate*):

| Step | Today | After this plan |
|---|---|---|
| 1 Land & self-serve | ✅ `event seed` | ✅ |
| 2 Configure the event | partial (`event show`) | ✅ `event set` / `tracks` / `formats` |
| 3 Program dashboard | ❌ | ❌ — `getProgramDashboard` has no planned verb |
| 4 Build the CFP form | ❌ | ❌ **out of scope** |
| 5 Submit from incognito | ❌ | ❌ **out of scope** |
| 6 Speaker portal | ❌ | ❌ **out of scope** |
| 7 Evaluation plan & committee | ❌ | ❌ **out of scope** |
| 8 Work the review queue | ❌ | ❌ **out of scope** |
| 9 Accept & push to agenda | partial | ✅ `schedule` / `publish` |
| 10 Build the agenda | partial (`agenda export`) | ✅ `place` / `move` / `remove` |
| 11 Publish & embed | ❌ | ✅ `submissions publish` |

**Ceiling is 6 of 11, realistically 5.** Five steps (4–8) are explicitly excluded by both the
ticket's OUT OF SCOPE list and the plan's. Even adding the review verbs the research calls the
highest-leverage remaining gap (*"Step 8 is where an agent is most obviously useful"*) reaches
only 7.

The error's origin is upstream and worth naming so it does not propagate: `cli-parity.md` §4
(line 166) claims the recommended cut takes the CLI *"from 3 of 11 loop steps to roughly 9 of
11"*, which **contradicts its own §5** (line 190): *"Steps 2, 4, 5, 6, 7, 8, 10 and 11 have no
command."* Removing 2, 10 and 11 from that list still leaves 4, 5, 6, 7, 8 uncovered. The ticket
copied the §4 number verbatim.

This matters because the plan is otherwise scoped correctly. The risk is not that the wrong thing
gets built — it is that a delegator builds the right thing, then either fails review against a
number it was never able to hit, or expands into the form builder and evaluation verbs chasing
it, which is precisely the outcome the OUT OF SCOPE section exists to prevent.

**Recommendation:** Get the AC amended before implementation, and record the amendment in the
plan. Suggested replacement, which is both true and a stronger claim than the original:

> The CLI drives **6 of the 11 walkthrough-loop steps end to end (1, 2, 9, 10, 11 plus chase)**,
> covering **100% of the operator's post-acceptance loop** — configure → triage → accept →
> schedule → place → publish — with zero `curl`. Steps 4–8 (form building, public submission,
> speaker portal, evaluation setup, review queue) remain API-only by design; see OUT OF SCOPE.

Also worth correcting `cli-parity.md` §4 in the same pass so the next reader does not re-derive
the same wrong number.

---

**[CRITICAL] Verification §3 — removing the curl blocks breaks an existing test the plan treats as additive**

`tests/node/skill.AC-142-144.test.mjs:24-25`:

```js
assert.match(skill, /POST \/api\/v1\/events\/\{eventId\}\/submissions\/\{submissionId\}\/schedule/);
assert.match(skill, /POST \/api\/v1\/events\/\{eventId\}\/submissions\/\{submissionId\}\/publish/);
```

Those two strings occur in `SKILL.md` at **lines 63 and 77 only** — as the `# POST …` comments
immediately above each `curl` invocation inside the two fenced blocks. Confirmed:
`grep -n "POST /api/v1" SKILL.md` returns exactly those two lines. The ticket's AC is *"SKILL.md
contains zero curl blocks"*; satisfying it deletes both strings and turns these two assertions
red. The plan's verification step 3 says only *"Extend `tests/node/cli.AC-138-141-250.test.mjs`"*
and the scope line says *"Extend … `skill.AC-142-144.test.mjs`"* — framing skill-test work as
addition when it is first a **deletion/replacement**.

Simply deleting the two assertions would silently drop coverage on AC-143, which is specified in
`EVALUATION.md:510` as *"extract every fenced command and API path; assert each resolves against
the CLI registry or the OpenAPI document."* The current two-line check is a weak proxy for that;
removing it without a replacement leaves AC-143 asserted by nothing but the
`node cli/marquee.mjs <usage>` loop at line 21-23.

**Recommendation:** Add an explicit plan step: *replace* lines 24-25 with AC-143 as actually
specified — walk every fenced block in `SKILL.md`, and assert each extracted command resolves
against `COMMAND_REGISTRY` and each extracted `/api/v1` path resolves against
`cli/api-registry.json`'s `operations`. That converts the breakage into a coverage upgrade and
gives the "zero curl blocks" AC a real guard (`assert.doesNotMatch(skill, /curl/)`) rather than a
one-time manual check.

---

**[MAJOR] Plan-wide — `PHILOSOPHY.md` is an AC deliverable and appears nowhere in the plan**

The ticket's final AC: *"PHILOSOPHY.md §3's CLI bullet is true as written, or amended to what
shipped."* The plan never mentions `PHILOSOPHY.md` — not in the file list, not in "Commands
added", not in Verification. Given the first issue above, the bullet at `PHILOSOPHY.md:31` —

> `- **A CLI** (`marquee`) — every workflow drivable from a terminal, scriptable, composable.`

— will still be false after this ticket ships, because six workflow families remain command-less.
"Every workflow" cannot be made true by this scope.

**Recommendation:** Add an explicit plan step amending line 31 to what actually ships, and list
`PHILOSOPHY.md` among modified files. The research already drafted the honest version
(`cli-parity.md:114-116`); something like *"a CLI (`marquee`) — the whole operating loop
drivable from a terminal, scriptable, composable, with the full API behind everything else."*
Note this amendment and the AC-1 amendment are the same decision and should be taken together.

---

**[MAJOR] Design decision 1 — the `--set` allowlist claim is self-contradictory and unimplementable as stated**

The plan says `--set` is *"allowlisted per command against the route's own zod schema"* and, two
sentences later, that *"adding a field to a route never needs a CLI change."* These cannot both
hold. The route schemas (`scheduleInput`, `placementBody`, `updateBody`,
`event-settings.routes.ts`'s bodies) are TypeScript in `src/routes/**`, compiled into the Worker
bundle; `cli/*.mjs` is dependency-free plain ESM and imports nothing from `src/`. The existing
precedent confirms the constraint — `LIST_FILTER_KEYS` and `REMINDER_FILTER_KEYS` in
`marquee.mjs:24-34` are **hand-copied** transcriptions of `submissionFilterSchema` and
`reminderSelectorSchema`, which is exactly why `cli-parity.md:92-97` singles out their
character-for-character fidelity as a thing a careful human maintained.

An implementer will hit this on the first command and resolve it arbitrarily. The two resolutions
have materially different testing obligations.

**Recommendation:** Pick one in the plan.

- **Hand-copied allowlist** (consistent with existing convention): drop the "never needs a CLI
  change" sentence, put the key sets in `cli/registry.mjs` next to each command, and add a drift
  guard — the same exposure `LIST_FILTER_KEYS` carries today, now multiplied across seven write
  commands.
- **Pass-through, no allowlist** (simpler, and honest about where validation lives): forward
  `--set` keys unmodified and let the route's zod schema produce the 422. Then "adding a field
  never needs a CLI change" is literally true, and the CLI stops duplicating server truth. Costs
  a worse error message for a typo'd key.

I'd lean pass-through for the new write verbs specifically, since unlike `--filter` these bodies
are not selector semantics the CLI needs to understand — but either is defensible if stated.

---

**[MAJOR] "The shape of the work" — the named file list omits the three files carrying the ticket's judgement-heavy edits**

The plan states *"Three files carry almost all of the diff: `cli/registry.mjs`, `cli/marquee.mjs`,
`cli/client.mjs`."* Accurate for dispatch volume, misleading for effort. Missing:

- **`cli/generate-skill.mjs`** — `SKILL.md` is not assembled from the registry; it is a hardcoded
  prose template literal in `renderSkill()`, with only the command list interpolated
  (`commandLines()`). The `## Agenda` and `## Publish` sections must be **rewritten as prose**,
  and event-configuration and search need homes. This is the ticket's only voice-bearing work,
  bound by `DESIGN.md`/`PHILOSOPHY.md`, and `AC-142` pins the five headings (`Seed`, `Triage`,
  `Chase`, `Agenda`, `Publish`) so the restructure is constrained.
- **`package.json`** — the `bin` entry (scope item 1).
- **`PHILOSOPHY.md`** — per the issue above.
- **`tests/node/{cli,skill}.*.test.mjs`** — named in scope, absent from the file list.

**Recommendation:** Replace the three-file sentence with the real list and call out that
`generate-skill.mjs` carries prose, not dispatch. Also verify the shebang + executable bit on
`cli/marquee.mjs` for the `bin` entry — the shebang is present (`marquee.mjs:1`), the mode bit
should be checked, and note `package.json` is `"private": true`, so `marquee` only resolves via
`npm link` or `npx`; the plan should say which invocation AC-141 is being satisfied against.

---

**[MINOR] Design decision 3 — auto-reading the ETag reduces `If-Match` to near-vacuous, and the "real 409" AC needs a stated mechanism**

`GET` the snapshot then immediately `PATCH` with the tag just read is structurally
read-then-write: the CAS window shrinks to one round trip, so `agenda move` is effectively
last-write-wins. This is a defensible CLI ergonomic — the alternative makes the command unusable —
and `--if-match` is the right escape hatch. But `src/api/concurrency.ts`'s header comment names
*"route-level read-then-unconditional-write"* as a defect, so an implementer or reviewer will
reasonably pause here and should find the tradeoff already reasoned about rather than absent.

It also has a concrete testing consequence the plan does not resolve: AC *"agenda move
round-trips If-Match correctly against a real 409"* cannot be produced by the happy path, because
the CLI will always send a fresh tag. The 409 must come from either a stub that mutates between
the GET and the PATCH, or an explicit `--if-match` carrying a stale tag.

**Recommendation:** State the tradeoff in one line, and specify both test paths: (a) stub mutates
between read and write → asserts the CLI surfaces the API's 409 verbatim with a non-zero exit;
(b) explicit stale `--if-match` → same. Also specify the `--json` contract on the error path —
`marquee.mjs:301-303` writes the message to stderr and sets exit 1 with **nothing on stdout**,
which is correct but should be asserted deliberately given AC-139's "exactly one JSON value on
stdout" phrasing.

---

**[MINOR] Design decision 2 — the `eventIdFrom` failure mode is worse than described, which strengthens the fix**

The plan says a new `event set` *"would silently fail to resolve an event ID."* It is actually
worse: `eventIdFrom` returning `undefined` falls through to `resolveEventId`
(`marquee.mjs:131-138`), which calls `/api/v1/auth/me` and uses `demo_event_id`. So
`marquee event set <some-other-event> --set name=…` would **silently ignore the positional
argument and patch the demo event instead** — a wrong-target write, not a failure. The plan's fix
(explicit `event: true` per registry entry) is right; the justification is stronger than stated.

**Recommendation:** Note the real failure mode, and add a regression test asserting `event set`
targets the positional ID even when `/auth/me` returns a different `demo_event_id`. The existing
AC-138 test's stub returns `demo_event_id: "evt_test"`, so a bug here would otherwise pass by
coincidence.

---

**[MINOR] Verification §4 — the 45s suite budget under contention**

Measured on this tree: `cli.AC-138-141-250.test.mjs` + `skill.AC-142-144.test.mjs` run in
**3.86s**, of which ~3.7s is 21 serial `spawn(process.execPath, …)` calls. This plan roughly
doubles the command count, so those two files head toward ~7–8s **on an idle machine**. `CLAUDE.md`
warns the 45s budget is set to survive several agents building at once; a serial-spawn test that
scales linearly with the registry is the wrong shape to grow.

**Recommendation:** Run the new command invocations concurrently via `Promise.all` (the stub
server already handles concurrent requests; the order-dependent `api.requests.find(…)` lookups in
the existing test would need to key on method+path rather than position), or drive `main()`
in-process with a captured stdout for the assertions that do not specifically need a real process
boundary. Worth one sentence in the plan so the delegator does not simply append 12 more serial
spawns.

---

**[MINOR] Commands added — `search --query` maps to the API's `q`, and there is no room-discovery verb**

Two small specifics the implementer will otherwise rediscover:

- `searchEvent` takes query parameter **`q`** (`search.routes.ts:199`), not `query`. The plan's
  `--query <text>` spelling is fine but the mapping should be explicit, and `--query` must be
  added to `VALUE_OPTIONS` (`marquee.mjs:7-22`) along with `--set` and `--if-match`, since
  `parseArgv` hard-rejects unknown options.
- Both `scheduleSubmission` (`submission-record.routes.ts:860`) and `placeAgendaItem` require a
  `room_id` validated against the event, and rooms are created only through `saveVenues`, which
  is out of scope. The demo path works — `agenda export` returns `rooms[]` in its snapshot — but
  "stand up a conference from zero" does not, which is relevant to how the amended
  `PHILOSOPHY.md` bullet and the new `SKILL.md` prose are worded.

## 4. Positive Observations

**The factual claims hold up under verification, which is rarer than it should be.** I checked
every one that was checkable and found no errors:

- All 13 operation IDs (`updateEventSettings`, `listEventTracks`, `createEventTrack`,
  `deleteEventTrack`, `listEventFormats`, `createEventFormat`, `deleteEventFormat`, `searchEvent`,
  `scheduleSubmission`, `publishSubmission`, `placeAgendaItem`, `updateAgendaItem`,
  `removeAgendaItem`) exist in `cli/api-registry.json` with exactly the methods and paths implied.
- *"These are the only two `if-match` routes in the product"* — exactly right;
  `grep 'concurrency: "if-match"'` across `src/routes/` returns two hits, both in
  `agenda.routes.ts`. Every other write route reviewed carries `concurrency: "none"`.
- *"`GET /agenda` already returns `sessions[].etag`"* — correct, `agendaSessionSchema` line 86,
  populated by `resultFromItem`'s `strongEtag(item.id, item.updated_at)`.
- The `check:api` reasoning is right for the right reason: that script compares
  `cli/api-registry.json` against the **served** OpenAPI document and never reads
  `cli/registry.mjs`, so adding CLI commands genuinely cannot move it. Calling it out as *"the
  guard that proves it"* rather than just asserting no drift is good verification hygiene.

**The scope discipline is the plan's strongest feature.** The OUT OF SCOPE section is specific,
reasoned per-item rather than by category, and the explicit *"No generated OpenAPI passthrough —
133 machine verbs would be worse than 20 hand-written ones"* is exactly the right instinct and
worth having written down where a delegator will see it. Likewise refusing to let this ticket
absorb `check:skill-agent`/AC-145 (gate 12, MRQ-44) is a clean boundary that a less careful plan
would have blurred.

**Design decision 2 is real engineering judgement.** Noticing that `eventIdFrom`'s predicate
reduces to `path[0] !== "event" || path.at(-1) === "show"` — with three redundant clauses — and
choosing to replace the derived predicate with an explicit flag rather than append a fourth
special case is the correct call, and the plan argues for it on the merits instead of just doing
it. Removing a latent bug adjacent to your change, and saying so, is the behaviour you want.

**The verification section enumerates commands, not intentions.** Six numbered, runnable steps
with the specific failure each one catches. The `--check` idempotency step and the explicit
"including a real 409" are both things that get skipped when a plan says "add tests."
