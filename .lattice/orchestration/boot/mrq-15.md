FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-15-public-form" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-15** (BUILDPLAN **M-14** — the public CFP form; ~8h). Actor: `agent:delegator-mrq-15`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-15-public-form`, branch `mrq-15-public-form`, cut clean off `forgejo/master` (`394b632`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-15 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. **Headless reviews are suspended** — self-review inline, attach a standard-shape review naming your exact HEAD.

**Push `mrq-15-public-form` to Forgejo as soon as it has its first commit**, and after every meaningful commit after that. Do not wait for the PR.

## You are walkthrough step 5 — the judge's own path

This is the surface an evaluator personally fills in. It is also the one place where a stranger writes to the database. **`lattice show MRQ-15 --json` carries a BINDING REQUIREMENT comment from me about the condition evaluator — read it before you plan.** Summarised, and non-negotiable:

MRQ-13 (merged `7ecbef8`) shipped `src/lib/form-conditions.ts`. Its `projectApplicableAnswers()` is correct, fail-closed on malformed conditions, and drops values supplied for hidden fields. **At merge it had exactly one caller: its own unit test.** You are the submit path, so the server-side half of "a hidden field is never required and never persisted" lands with you and nowhere else.

1. Persist **only** `projectApplicableAnswers(fields, rawAnswers).answers`. Never the raw body, never a hand-rolled filter, never a second applicability check. The file's header says later surfaces add consumers there and do not create a second evaluator — that is binding. If you need behaviour it does not express, **add to it** and say so in your PR body.
2. Ship an **integration** test, not a unit test: POST a real submission supplying a value for a conditionally-hidden field, then assert against the database that the value was **not written**, and that the hidden field was **not required**. Assert the absence of the value — a status-only assertion passes while the value lands.
3. **The vendor conditional is an ordinary schema-driven field rendered through `isFieldApplicable()` — never a hardcoded alternate form** (SPEC §5.4/§5.5). A hardcoded branch here is the exact defect MRQ-13 was pulled forward to prevent.

You exercise **AC-132/AC-133** on the public surface; **MRQ-13 owns those IDs for `trace:ac`**, so do not claim them.

## The other guardrail: Turnstile

**Turnstile is verified server-side before every write and every presign.** AC-231's gated set is draft creation, submit, and every presign. One deliberate exception: `PATCH …/drafts/:token` autosave requires **no** Turnstile token — the literal reading would break AC-41 — but it **is** rejected without a valid resume token and **is** rate-limited per token. Prove the gate the way the merged guardrails do: assert **both** the status code **and** that no row was written when the token is missing or invalid. I hand-review this at merge.

Demo credentials are in place for Cloudflare; there is no live account this run (deferred to MRQ-57). Validate against local `wrangler dev`/miniflare, and put anything provable only against real infrastructure in your PR body as a named MRQ-57 checklist item rather than faking it locally.

## Scope and ACs

ACs: **AC-25, AC-26, AC-29, AC-30 – AC-42, AC-155 – AC-157, AC-231, AC-234.** SSR form in builder order; the complete participant/profile/file/conditional path; client-blur plus **server-authoritative** validation; drafts with an emailed resume link and restored values *and files*; real **open, closed, at-limit, resumed, submitted, and re-opened** states — all six are real states, not error text; confirmation email; a genuine 375 px pass.

## Voice — felt checkpoint C3 reads this surface aloud

Force **every** validation failure and **every** submit failure (5xx, Turnstile challenge failure, 429, dropped connection). **No sentence may contain a field name, a type name, an error code, or the word "invalid" without a remedy.** Read your own copy out loud before you call it done; `PHILOSOPHY.md` and `DESIGN.md` bind, and the organizer's noun is **"conference"** (the wire API keeps `/api/v1/events/...` — SPEC Amendment 13).

## What you inherit

- **MRQ-13** — the builder, `forms.queries.ts`, and the evaluator. **MRQ-12** — mail and the demo-safe outbox: your confirmation email and resume link enqueue `demo_safe`; the public-form confirmation is one of only **two** sanctioned `always_live` sites and it may deliver **only** to the address typed in that request. Do not add a third.
- **MRQ-14** — presign/verify/serve for uploads. **MRQ-8** — API core and the generated route manifest (`*.routes.ts`; `check:api` fails a route that bypasses it — verify your paths reach the OpenAPI document before opening the PR).

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-15.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. After any rebase run `npm ci` before trusting a red test — never `npm install --no-save`.

Before the PR: `npm run pr-gate -- --ticket MRQ-15`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
