# Thorough review of PR #24 — a human collaborator's PR

Repo root: `/Users/atin/Projects/Stage11/deployments/Marquee`. Read its `CLAUDE.md` first — it is binding.

You are an Opus reviewer launched by the merge driver at **surface:261**, on Atin's instruction. Your job is a **thorough review of PR #24** and nothing else. You do not merge it — `main` sits behind a manual merge gate (`CODEOWNERS` + the "main: manual merge gate" ruleset) that Atin added deliberately this evening. Your output is a verdict he can act on.

```
gh pr view 24 --repo Stage-11-Agentics/marquee
gh pr diff 24 --repo Stage-11-Agentics/marquee
```

## Who wrote it, and what that changes

**PR #24 is from `ninjaa` — Aditya, a human collaborator, working with Claude.** Not a fleet agent. This is the collaborator the whole GitHub-is-canonical ruling exists for.

That changes your tone and your thoroughness in opposite directions. Be **more** thorough, because nobody else on the fleet has reviewed it and it arrived through a different process than every other PR tonight. Be **more generous in framing**, because this is a guest contribution from someone doing genuinely useful judge-path QA, and the findings behind it are good ones. Lead with what is right. Where you disagree, disagree on evidence, not on process.

## What it claims

KYS judge-path QA. Two public doors misdirect a signed-out judge:

- "View public CFP" on the landing pointed at `/submissions` — the organizer register behind a sign-in — instead of the public form at `/f/cfp`. Changed to `/f/cfp`.
- The public agenda header's "Organizer demo" pointed at `/submissions?demo=organizer`, but the PR claims nothing outside the landing page reads `?demo=`, so no auth fires and a signed-out visitor lands on a 401. Changed to `/`.
- It also claims `AC-4`'s `href="/submissions"` assertion only passed *because* the CFP link was broken — it was the last bare `/submissions` in the document — and updates it.

Code surface is tiny: 3 changed lines across `src/routes/landing.route.tsx` and `src/ui/public/agenda/PublicAgendaPage.tsx`, plus `tests/integration/landing.test.ts`. **The rest of the diff is `.lattice/` board state**, which is where the risk concentrates.

## Verify every claim against the code. Do not take the PR body's word for anything.

Specifically:

1. **Is `?demo=` really only read by the landing page?** Grep it yourself across `src/`. The whole justification for the second change rests on this.
2. **Is `/` the right destination for "Organizer demo"?** It loses the intent — the visitor wanted the organizer demo, and now gets a landing page where they must click again. Would `/?demo=organizer` work, given the landing *does* read `?demo=`? Is there a reason it would not? Say which you would ship and why.
3. **Does the landing's own `/submissions?demo=organizer` door still work?** The PR leaves it untouched while changing the agenda's copy of the same pattern. Either it works on the landing (because the landing's JS authenticates) and the asymmetry is correct, or it does not and this PR fixed one instance of a two-instance bug. Determine which. **This is the highest-value question in the review.**
4. **The AC-4 claim.** Verify that the old assertion really was passing for the wrong reason. If true, say so prominently — a test that passes because of a bug is a better find than the bug.
5. **`/f/cfp` is currently BROKEN** — see MRQ-81, a critical open bug: the public CFP form cannot accept a headshot, so no submission can be completed. This PR points the landing's most prominent public door *at a dead end*. That does not make the PR wrong — `/f/cfp` is unambiguously the correct destination and `/submissions` was worse — but the two interact, and Atin needs to know that merging #24 alone routes judges to a broken form. Another Opus agent is fixing MRQ-81 in parallel right now. **Recommend a merge order.**

## The `.lattice/` risk — check this carefully, it is the one that can actually hurt

The PR commits board state, including `.lattice/ids.json`. Its diff shows:

```
"next_seqs": { "KYS": 3, "MRQ": 73 }
```

**Our board is at MRQ-83.** Work out precisely what merging this does to the ID sequence. If it can regress the MRQ counter, the next `lattice create` re-mints IDs that already exist, and the board silently corrupts — that is a merge blocker and a one-line fix, not a reason to reject the PR.

The PR body already discloses this honestly: the guest's create-time mint read a stale `ids.json` and initially handed them MRQ-73, so they moved to a `KYS-` prefix to avoid collision. That was the right instinct. Confirm the fix is complete in the committed state, not just in the narrative. Also check whether the diff drops map entries for MRQ-73…MRQ-83, and note `ids.json` losing its trailing newline.

Run `lattice doctor` against the merged result if you can do so safely without mutating the live board. **Do not mutate the board.** This is a read-only review.

## Base staleness

The PR was cut from an older `main`. Thirteen commits landed tonight. Establish:

- Does it still apply cleanly? (`gh pr view 24 --json mergeStateStatus`)
- Do its changes conflict semantically with anything merged since — particularly #7 (public routes never 401 on a bad credential), #20 (local cookie), and #15/#17/#21?
- The PR body says "Full gate green locally (`npm test` → pass, hermetic, **under budget**)". The suite runs ~150s against a **45s** objective, and `run-test.mjs` treats over-budget as a warning rather than a failure. "Under budget" is therefore surprising and suggests they ran against a stale base predating #8/#14. Worth a sentence — gently. It does not invalidate their result.

## Your gate

Read-only where you can be. If you need to run checks, use a **fresh worktree off `github/main` with the PR's branch merged in** — never the main checkout, and never their branch in place.

Permitted: three `tsc --noEmit` passes, `npx vite build`, `check:design`, `check:api`, `trace:ac`, and the landing/agenda test files. **No full `npm test`** — it takes ~150s and concurrent full-suite runs are what wedged this machine at load average 158 earlier tonight. GitHub CI already reports SUCCESS on this PR; use that.

## Output

Post your review as a comment on the PR **and** send a summary to surface:261.

Structure it as: **verdict** (merge as-is / merge with named follow-ups / needs a change first), then findings ranked by severity, each with `file:line`, a concrete failure scenario, and the smallest correct fix. Separate what you **verified** from what you **suspect** — label them differently and never blur the two.

Then state explicitly: **what merge order do you recommend for #24 relative to the MRQ-81 fix**, and **is there anything here that must not merge tonight**, given the deadline is Wed 2026-08-12 22:00 PT.

Set your c11 title and description now (`c11 rename-tab --surface "$C11_SURFACE_ID" "…"`). If two browser attempts fail, stop and report rather than grinding.
