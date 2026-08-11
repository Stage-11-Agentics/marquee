FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-25-calendar" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-25** (BUILDPLAN **M-24 + M-33** — calendar invites and the un-accept cascade; ~10h). Actor: `agent:delegator-mrq-25`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-25-calendar`, branch `mrq-25-calendar`, cut clean off `forgejo/master` (`f83de44`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-25 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. **Headless reviews are suspended** — self-review inline, attach a standard-shape review naming your exact HEAD.

**Push `mrq-25-calendar` to Forgejo as soon as it has its first commit**, and after every meaningful commit after that. Do not wait for the PR.

## The two traps that are already known

1. **The Resend batch endpoint carries no attachments.** Anything with an ICS goes **single-send at ≤10/s**. Both paths must exist — do not quietly route invites through batch because it is faster to write. Name which path each call site uses in your PR body.
2. **One `UID`/`SEQUENCE` lifecycle.** M-33's calendar cancellation is literally M-24's `METHOD:CANCEL` path — that is why these are one ticket. A cancel that does not reuse the original invite's `UID` with an incremented `SEQUENCE` is not a cancellation, it is a second event that no client will reconcile. Test the full triplet: request → update → cancel.

## Scope and ACs

Read the full scope with `lattice show MRQ-25 --json`. ACs: **AC-95 – AC-97, AC-121 – AC-124, AC-252.**

ICS builder: `METHOD:REQUEST`, `ATTENDEE;RSVP=TRUE`, stable `UID`, `SEQUENCE`, `DTSTAMP`, `VTIMEZONE`+`TZID`, **CRLF folding** (get this wrong and clients silently drop fields), `multipart/alternative` calendar part, Add-to-Google and Add-to-Outlook links, and `/i/{uid}.ics`.

**AC-252 — ICS `LOCATION` renders "Room · Building".** MRQ-62 merged real venue geography; buildings now carry `lat`/`lng`, `access_minutes`, and `access_note`. Use the existing label helper rather than re-deriving the string. **Do not** put `access_note` or AV capabilities into a public ICS — those are operator-facing (AC-253).

**AC-123 — the reversal dialog enumerates portal tasks, scheduled emails, and calendar invites, each with cancel/retain, and honours the choice.** "Honours the choice" is the assertion that matters: prove retain actually retains and cancel actually cancels, with a row-level assertion, not a UI-state one.

## What you inherit

- **MRQ-12** — the mail core and the demo-safe outbox. **`send_policy` has exactly TWO `always_live` write sites** (`src/jobs/mail/outbox.ts`) and that is guardrail G3, audited by A-3. Your invites are **not** a third one — they enqueue `demo_safe` like everything else. If you believe an invite must send live, stop and ask the Orchestrator; do not add a write site.
- **MRQ-19 (just merged)** — bulk and record-owned decisions with cascade, in `src/jobs/cascade/decisions.ts`. Both the single and bulk decision paths already funnel through one `insertDecisions` writer. **Your un-accept reversal extends that path; it does not fork it.** A second decision-writing path is the exact defect AC-235 exists to prevent.
- **MRQ-55** — the ICS spike verdict has returned; read its findings before choosing a shape rather than rediscovering them.

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-25.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. After any rebase run `npm ci` before trusting a red test — never `npm install --no-save`. Route modules are named `*.routes.ts`; verify your paths actually reach the generated manifest and OpenAPI document before opening the PR (`check:api` fails a route that bypasses it).

Before the PR: `npm run pr-gate -- --ticket MRQ-25`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
