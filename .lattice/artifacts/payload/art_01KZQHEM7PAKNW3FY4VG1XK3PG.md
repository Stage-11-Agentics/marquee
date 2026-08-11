# Plan Review: MRQ-15 — Public CFP form

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

Reviewed the MRQ-15 plan against the ticket description, `SPEC.md` §5.5 / §4.2, `EVALUATION.md` §2, `BUILDPLAN.md` M-14, and the current state of `master` (`f8e824d`) and the `mrq-15-public-form` worktree (`b85cfb1`, based on `a05a015`). The plan is structurally strong — it correctly internalizes the two hazards the dispatch note was written to prevent (single `projectApplicableAnswers()` call site; Turnstile on draft-create/submit/presign but **not** autosave) and it carries a real verification matrix rather than a vibe.

Two things block it. First, it silently drops **AC-38's demo-mode on-screen portal magic link** — the one affordance `SPEC.md` §5.5 (F-10) added specifically to keep walkthrough steps 5 → 6 connected for a judge who types `test@test.com`. Second, the plan was written against a **stale base**: the worktree predates MRQ-20 and MRQ-22, both of which have landed on `master` and both of which now occupy the exact surfaces this plan calls "module-local, shared files: none" — `src/routes/public.routes.ts`, `src/ui/public/`, and the `src/index.ts` mount block. Beyond those, the AC-claims instruction as written will fail `trace:ac` on duplicate ownership, and two capabilities the plan states as reuse (per-token KV rate limiting, the AC-36 speed evidence path) do not exist in the form the plan assumes.

## 3. Issues

**[CRITICAL] §3 SSR/client surface — AC-38's demo-mode portal magic link is missing entirely**

`SPEC.md` §5.5 ships this as a named, non-optional affordance: *"in demo mode the confirmation screen also renders the portal magic link on screen — 'Open your speaker portal →' — by the same mechanism as §4.1's demo magic link"*, and `EVALUATION.md` AC-38 repeats it: *"following it lands the portal of the speaker just submitted (the judge's incognito path — loop steps 5 → 6)."* SPEC's F-10 note explains the failure it exists to prevent: a judge who submits as `test@test.com` and then clicks `[Enter as speaker]` lands a *different, seeded* speaker, and the walkthrough — the evaluation rubric — dead-ends at the step transition. The plan's §3 says only "confirmation state." AC-38 is in the Tier A no-waiver set (gate 18) and is `oracle`-tagged, so `trace:ac` will **not** catch the omission; nothing mechanical will. The mechanism already exists — `src/routes/auth.routes.ts:160` (`if (event.demo_mode === 1) onScreenLink = absoluteLink;`) and `mintMagicLink()` in `src/lib/auth/magic-links.ts`.

**Recommendation:** Add an explicit plan step: on successful submit, when the event is `demo_mode = 1`, mint a magic link for the submitting speaker via the §4.1 mechanism and render it on the confirmation screen as `Open your speaker portal →`. Note in the plan that `/portal` itself is MRQ-16 (M-15) and therefore the link target may 404 until that ticket lands — this is a known ordering fact, not a reason to omit the affordance. Add an integration assertion that the confirmation payload carries the link in demo mode and does not in non-demo mode.

---

**[CRITICAL] §1 / "Shared files: none" — the plan is written against a stale base; three genuinely shared surfaces are unnamed**

The worktree is at `a05a015`; `master` is at `f8e824d`, two merges ahead (MRQ-20 agenda, MRQ-22 public site). On current `master`:

- `src/routes/public.routes.ts` **already exists** and already owns the `/api/v1/public/*` namespace (`getPublicAgenda`, `getPublicSession`, `getPublicSpeaker`, `getPublicEmbed`), with `src/lib/public-site.ts` as its data layer. The plan proposes adding `/api/v1/public/forms/:slug` and friends without acknowledging the incumbent module or deciding whether to extend it or add a sibling `*.routes.ts`.
- `src/ui/public/` **already exists** (`src/ui/public/agenda`). The plan's file surface `src/ui/public/form/*` is a sibling under a now-shared parent.
- `src/index.ts` **must be edited** to mount the SSR route — `app.route("/", landingRoutes)` / `publicAgendaRoutes` / `embedRoutes` at lines 102–104. The plan says "mount it without changing the generated API manifest by hand," which is correct about `_manifest.ts` (glob-driven) but silently elides the one hand edit that *is* required, in a file MRQ-33 and other in-flight tickets also touch.

The ticket header's "Shared files: none — module-local" was accurate when written and is not accurate now. Carrying it forward unexamined is how a clean-looking branch produces a conflicted merge.

**Recommendation:** Rebase the worktree onto `f8e824d` **before** implementation and re-read `src/routes/public.routes.ts`, `src/lib/public-site.ts`, and `src/index.ts`. Then state in the plan: (a) whether the public-form API operations extend `public.routes.ts` or land in a new `public-forms.routes.ts` (a sibling is preferable — the glob picks it up and it avoids a hot shared file), (b) that `src/index.ts` gains exactly one `app.route("/", publicFormRoutes)` line, listed as a shared-file edit, and (c) that `/f/*` is already in `wrangler.jsonc`'s `run_worker_first` list so no config change is needed. Also note the OpenAPI path-param convention is `{slug}`, not `:slug` (see `public.routes.ts:58`).

---

**[MAJOR] §4 Evidence and claims — the AC-claims instruction will fail `trace:ac` on duplicate ownership**

"Add `tests/ac-claims/MRQ-15.json` owning only public-form ACs; list AC-132/AC-133 and AC-231 as exercised" is under-specified against the live ownership map. `scripts/checks/trace-ac-core.mjs:77` raises `duplicate-owner` and fails the run. Currently owned elsewhere, all of them inside this ticket's AC list:

| AC | Already owned by |
|---|---|
| AC-29, AC-30, AC-31, AC-32 | `MRQ-13.json` |
| AC-33 | `MRQ-12.json` |
| AC-231 | `MRQ-14.json` |
| AC-234 | `MRQ-5.json` (MRQ-13 exercises) |
| AC-155, AC-156, AC-157 | reserved for **MRQ-37** — `BUILDPLAN.md` line 353: *"AC-155–157 → M-43's ticket (MRQ-37); the other claimant (M-14/M-13) tests but does not own"* |

That leaves MRQ-15's actual `owns` set as **AC-25, AC-26, AC-34, AC-35, AC-36, AC-37, AC-38, AC-39, AC-40, AC-41, AC-42**. Of those, every `auto`-tagged one needs at least one test whose title is prefixed `AC-NN · ` or `trace:ac` reports it `uncovered` and `pr-gate` fails (AC-26 is `felt` and AC-38 is `oracle`, so neither requires a test). Note especially that **AC-35 is `e2e:mobile` and AC-36 is `speed:`** — both harnesses are stubbed (`run-e2e.mjs` → MRQ-50; `check-speed.mjs` → MRQ-50) yet both are `auto`, so owning them requires a local contract test carrying the tag regardless.

**Recommendation:** Write the exact `owns` array into the plan (the eleven IDs above), and the exact `exercises` array (AC-29 – AC-33, AC-132, AC-133, AC-155 – AC-157, AC-231, AC-234). Add a line committing to one `AC-NN · `-prefixed test per owned `auto` AC — nine of them — and name where the two stubbed-harness ones (AC-35, AC-36) get their local contract test.

---

**[MAJOR] §3 SSR/client surface — no commitment to the binding prototype or to SPEC §5.5's ship-as-written details**

`DESIGN.md` names `prototypes/pipeline-v1.1/index.html` at v1.9 as the binding visual contract — *"The build reproduces it one-to-one; every designed control ships"* — and `CLAUDE.md` repeats it. The plan never references the prototype file. `check:design` (`verify-design-contract.mjs`) only verifies the token block lifts verbatim from `skin-c.html` and that no `PROTOTYPE` marker leaks; it cannot catch a structurally divergent screen. So the only thing standing between this build and a divergent public form is the plan, and the plan is silent.

SPEC §5.5 specifies, as shipping detail, controls the plan does not enumerate: the header block (`"Call for speakers · closes Sep 12"`, headline, welcome copy — AC-30, **progress dots**), **character counters where a max exists**, the **speaker-limit sentence before the first add-person control** (AC-29), the footer row (`Draft saved locally · just now` left, `Submit abstract` right), the at-limit state that *lists existing submissions*, the draft-resumed private-link banner naming when it was saved, and two validation strings that "**ship as written**": *"Use at least 8 characters so reviewers can identify your session."* and *"Tell reviewers a little more — at least 40 characters."* AC-42 additionally requires the draft state to carry a **distinct textual status label (not colour alone) and a distinct container class**. F-11's submit-failure treatment is specific too: an **inline banner above the submit row**, every entered value preserved, retry offered, draft-saved stated.

**Recommendation:** Add a fidelity clause to §3: name `prototypes/pipeline-v1.1/index.html` (v1.9) as the binding reference, and enumerate the SPEC §5.5 controls above as a checklist the implementation satisfies. Quote the two ship-as-written validation strings into the plan so they are not paraphrased. Add AC-42's textual-label-plus-container-class requirement explicitly.

---

**[MAJOR] §2 Persistence — the per-token KV rate limiter the plan "applies" does not exist**

The plan says autosave will "apply a per-token KV rate limit," phrased as reuse. In fact `src/api/router.ts:131` falls back to `allowAllRateLimiter(now)` — `src/api/rate-limit.ts` defines the *vocabulary* (`RATE_BUCKETS`, `RATE_KEYINGS`, `deriveRateKey` with an `ip_submission` keying that already extracts `/drafts/([^/]+)`) but the KV-backed `RateLimiter` adapter is unimplemented in the API layer. The only working limiter is `checkUploadRateLimits` in `src/lib/r2/rate-limit.ts` (MRQ-14's, upload-scoped). AC-231's `EVALUATION.md` row explicitly requires proving autosave "is rate-limited per token," so this cannot be waved through — and it is unbudgeted build work inside an 8-hour ticket.

**Recommendation:** Decide and state which path is taken: implement a KV-backed `RateLimiter` adapter behind the existing `runtime.rateLimiter` seam using `deriveRateKey(..., "ip_submission", ...)`, or generalize `src/lib/r2/rate-limit.ts`'s KV counter for the draft path. Either way, name the file, note the hour cost, and add the assertion that a rejected autosave mutates nothing.

---

**[MAJOR] §4 Evidence — AC-36's 1000 ms budget has no plan line at all**

The ticket description calls AC-36 out by name as an AC-sourced budget (cold load → interactive p95 ≤ 1000 ms; manifest id `cfp-cold-interactive`, `kind: "acceptance"` in `scripts/checks/speed-budgets.mjs:3`), and `PHILOSOPHY.md`/`CLAUDE.md` treat slowness as a defect rather than a tradeoff. The plan's §4 evidence list — type checks, build, design/API checks, full suite, trace, wrangler probes, 375 px — contains no speed item, and §3 makes no architectural commitment to the thing that actually wins the budget: `SPEC.md` §2.2's rule that HTML arrives complete and **JS hydrates only the interactive islands** (form validation), because "an SPA boot plus a fetch cannot be relied on to." `check:speed` is a stub until deployed measurements arrive with `--input` (owner MRQ-50), so the local proof has to be structural.

**Recommendation:** Add to §3 an explicit hydration-island commitment (server-rendered HTML complete; client JS limited to blur validation, autosave, upload, and conditional show/hide — no SPA shell on `/f/:slug`), and to §4 an `AC-36 · `-tagged contract test asserting the island boundary (e.g. no admin bundle import reachable from the public form module). State plainly that the measured p95 is deferred to MRQ-50's deployed `check:speed --input` run, and say so in the PR body rather than claiming the budget locally.

---

**[MINOR] §2 Persistence — the outbox rows this surface writes should be named individually**

MRQ-12 owns AC-33, but MRQ-15 is the write site for three of its four assertions: the **draft resume link**, the **thank-you on submit**, and the **named-admin new-submission notice**. The plan says "confirmation/outbox behavior" and separately gets the policy right (resume mail `demo_safe`, confirmation `always_live`), but never mentions the admin notice — which is the one most likely to be forgotten, since no test in this ticket owns it.

**Recommendation:** Name all three enqueues in §2, and reuse the existing writer by name: `enqueuePublicFormConfirmation()` in `src/jobs/mail/outbox.ts:120` already enforces the typed-address invariant, so the "no third `always_live` writer" non-goal is satisfied by calling it rather than by restraint. Template keys are `submission_confirmation` and `draft_resume` per `SPEC.md` §3.8.

---

**[MINOR] §4 Evidence — "headless reviews are suspended" and the browser scope are asserted without a source**

"Run self-review inline at the exact final HEAD; headless reviews are suspended" and "the genuine 375px pass within the approved local browser scope" both reference operating conditions that a fresh implementer cannot verify from the artifacts. If the browser scope was approved (per the global rule that browser validation is scoped at planning time), the plan should record what was approved.

**Recommendation:** Record the approved browser scope in one line — tool/surface, local URL, the flow to be driven — so the 375 px pass is reproducible by a validator who was not in the planning conversation.

## 4. Positive Observations

- **The two dispatch-note hazards are both correctly internalized.** §2's "route every answer write through exactly `projectApplicableAnswers(fields, rawAnswers).answers`; never a hand-written filter or a second applicability evaluator" is precisely the one-caller discipline `394b632` was committed to protect, and the fail-closed note matches the actual behavior of `isFieldApplicable()` (`src/lib/form-conditions.ts` — malformed condition ⇒ `false`). The plan also correctly refuses to own AC-132/AC-133.
- **The Turnstile gating shape is exactly right,** including the subtle part: gated on draft creation, submit, and every presign; deliberately *not* on `PATCH …/drafts/:token`, with the resume token as its authorization. This is the reading `SPEC.md` §5.5 spent a paragraph defending against its own literal wording, and the plan restates it without drift. "Inherited presign coverage retained" is accurate — `verifyTurnstile` is already wired in `src/routes/uploads.routes.ts`.
- **Lifecycle states are treated as data, not as rendering.** "Closed and at-limit reads remain successful page loads; writes are rejected before persistence" is the AC-31 distinction stated exactly, and "resume does not bypass the current limit or lifecycle checks" catches an edge case that would otherwise ship as a bug.
- **The verification matrix is the right artifact.** Pairing each area with its evidence — rather than listing tests — is what makes a plan reviewable at all, and the zero-rows-written assertions attached to every rejection case are the correct shape of proof for a Tier A guardrail.
- **The non-goals section is genuinely load-bearing**, not decoration: "do not mint AC IDs," "no third `always_live` writer," "do not fabricate deployed Turnstile evidence," and the push-early commit discipline all name real, previously-observed failure modes.
