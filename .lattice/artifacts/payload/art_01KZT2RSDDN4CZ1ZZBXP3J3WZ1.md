# Code Review: MRQ-92

## 0. Blocking context defect — the review prompt does not describe this diff

The prompt asks me to review **MRQ-92: "Speaker file upload fails with `upload PUT network error`"** — an R2 CORS
ticket whose acceptance criteria are a committed CORS policy JSON, an idempotent apply script, a slow-suite
preflight check, and a human-readable upload failure sentence.

**The attached diff implements none of that.** It changes two files:

- `scripts/checks/repo-policy.mjs` — the public-repository publish policy
- `tests/node/check-repo.test.mjs` — its tests

This matches the checked-out branch `publish-policy-history` (`11a5235`, `9b59c97`), not MRQ-92. `git diff
main...HEAD` is exactly the two files above. No R2, CORS, `presign.ts`, `upload-client.ts`, or `PortalPage.tsx`
change is present.

**Consequence:** I cannot evaluate this work against MRQ-92's acceptance criteria, because the work does not
address them. Against MRQ-92 the correct verdict is trivially FAIL — but that would be a review of a harness
error, not of the code. **Everything below reviews the diff on its own merits as a publish-policy change.**
The orchestrator should re-pair the ticket with its diff before acting on the MRQ-92 status.

---

## 1. Verdict

**FAIL (implementation-level)**

The approach is sound and the mechanical execution is careful, but two defects in the changed lines break the
policy the file itself declares: an operator email that exists in this repo today is now matched by zero rules,
and the header comment asserts a publishing policy that neither the assembler nor this ruleset implements.
Both fixes are small.

## 2. Summary

Reviewed a rewrite of the public-repo publish gate that stops policing internal vocabulary (`Lattice`,
`delegator`, `orchestrator`, `Stage-11`, `C11_*`, surface/workspace ids) and stops path-denying the development
record (`.lattice/`, `sequence/research/`, `AGENT-BRIEF-*`, `run-state`), while retaining third-party-source and
operator-private rules and adding `OPERATOR-PRECONDITIONS`. Quality is good: literals are assembled at runtime
so the file cannot match itself, the new full-history deletion test is the sharpest test in the suite, all six
tests pass in 6.8s, and the shipping artifact still passes the gate (verified: `check:repo` against
`github/mrq-42-assembly` → `pass`, zero findings).

**Key finding:** the diff removes the three independent rules that were covering `atin@authentic.tech` in
`.lattice/orchestration/run-state.md` and replaces them with an enumeration that does not include it — in the
same change that declares run-state publishable.

## 3. Issues

**[MAJOR] scripts/checks/repo-policy.mjs:47 — the personal-email rule misses the operator address this repo actually contains**

`atin@authentic.tech` appears twice in `.lattice/orchestration/run-state.md` (lines 57 and 158), in a passage
discussing subscription accounts. Before this diff, three separate rules covered it: the `.lattice/` path rule,
the `run-state` path rule, and the broad "any non-`example`/`invalid`/`test` address" content rule. **This diff
removes all three.** The replacement matches only `benevolent.futures` and `atin@atin.me`.

The file's own header (line 13) lists "personal email addresses" as policed operator-private material. For the
personal address that is actually in this repository, in the very file the header says now ships, nothing fires.
An enumeration of two addresses is a fail-open default in a one-shot gate whose failure mode is permanent
publication.

**Fix:** invert to fail-closed — restore the broad real-address rule and allowlist the role addresses the
comment says ship deliberately (the sending identity and platform account, which are enumerable and few). If the
enumeration is preferred, at minimum add
`const personalWork = joinParts("atin", "@", "authentic", "\\.", "tech");` to the alternation, and add a test
case per enumerated address — the current test exercises only the `benevolent.futures` local part.

---

**[MAJOR] scripts/checks/repo-policy.mjs:1-18 — the header states a policy that neither the pipeline nor this ruleset implements**

The comment opens: *"The repository publishes its full development history on purpose: the task board, the
research dossiers, the agent briefs, and the run-state ... are part of what is being released."* Two independent
contradictions, both verified:

1. **The assembler does not ship them.** `scripts/checks/assemble-public.mjs:19-27` builds the public tree from
   an allowlist — `.github, cli, fixtures, migrations, scripts, src, tests`, named root files, two prototypes.
   `.lattice` and `sequence` are named in `excludedRoots` (line 351). Nothing in this diff touches the
   assembler. The development record does not ship, and cannot, from the current publish path.
2. **This ruleset would reject them anyway.** Of the files under `.lattice/` + `sequence/` on `main`, **177 match
   the diff's own `private filesystem path` rule** (`/Users/<name>/`) and **96 match the retained tailnet /
   Forgejo-hostname rules**. Publishing the development record under this ruleset yields hundreds of
   `denied-history-content` findings.

So the diff removed the *path* rules that kept the record out while retaining *content* rules the record
massively violates — leaving a stated policy that is unreachable in both directions. The gate passes today only
because the assembler's allowlist means none of this material reaches the scanned ref.

**Fix:** either scope the comment to what actually changed (this ruleset stops policing internal *vocabulary*
and takes no position on whether the board ships), or — if shipping the record is the real goal — land the
assembler allowlist change and the corresponding scrub pass in the same PR so the two files agree. As written,
the next reader will trust the comment over the code and assume a publishing decision that has not been made.

---

**[MAJOR] scripts/checks/repo-policy.mjs:40-48 — the check no longer verifies the scrubs the assembler still performs**

`assemble-public.mjs:155-177` still rewrites `Stage 11` → `Marquee`, `Lattice` → `task tracker`, `delegator` →
`agent`, `orchestrator` → `runner`, `C11_*` → `INTERNAL_ID`, `surface:N`/`workspace:N`, and every real email →
`contact@example.com`. `check-repo.mjs` was the independent verification that those scrubs succeeded. After this
diff it asserts none of them.

That is a real loss of defence-in-depth on the exact seam where it matters: `scrubTree` skips any file
containing a NUL byte (`assemble-public.mjs:204`), and its rules are regex-per-form, so a new file format,
an unusual casing, or a new host spelling silently passes. Previously the gate caught the miss; now nothing does.

**Fix:** decide explicitly whether the scrubber's vocabulary rules are still policy. If they are, keep matching
assertions in the gate. If they are not, remove them from `assemble-public.mjs` too so one file owns the answer —
a scrubber enforcing rules the verifier has abandoned is the worst of both.

---

**[MINOR] scripts/checks/repo-policy.mjs:41-42 — the trailing `/` narrows the path rules further than the stated reason requires**

The justification (lines 37-39) is avoiding self-match on audit prose like *"scanned for /Users/ paths"*.
Requiring one following segment character achieves that. Requiring a **trailing slash** additionally drops
terminal paths — `HOME=/Users/atin`, `cd /Users/atin`, a path at end of line — which the old rule caught. Same
for `Atin/` at a line end.

**Fix:** drop the trailing slash: `/\/Users\/[A-Za-z0-9._-]+/`. Verified — this still does not match
`"for /Users/ paths"` (the space fails `[A-Za-z0-9._-]+`) and does match `/Users/atin`. No such occurrence
exists in the repo today, so this is prevention, not a live leak.

---

**[MINOR] tests/node/check-repo.test.mjs — the change's own motivating behaviour is untested**

The narrowing at `repo-policy.mjs:41-42` exists specifically so the ruleset does not fire on audit reports that
quote its vocabulary. Nothing pins that. A future well-intentioned "tighten the path rule" edit reintroduces the
self-match with a fully green suite.

Two further gaps: `atin@atin.me` has no coverage (only the `benevolent.futures` branch is exercised), and
`OPERATOR-PRECONDITIONS` is tested by **path** only — its *content* pasted into another file is unpoliced and
untested, which is not hypothetical, since `run-state.md` already carries the same class of account material.

**Fix:** add a case whose history contains `scanned for /Users/ paths and Atin/ directories` asserting status 0;
add an `atin@atin.me` case; and either add a content rule for the runbook's distinguishing strings or state in
the comment that runbook content is out of scope by design.

---

**[MINOR] scripts/checks/repo-policy.mjs:22-30 — third-party quotation in the newly-allowed research dossiers**

`sequence/research/` is no longer path-denied; only `sources/` beneath it is. But the dossiers are *derived from*
the organizers' brief and the walkthrough transcript and quote them at length. Rationale #1 in the header —
material "we do not own and cannot relicense under this repository's Apache-2.0 LICENSE" — applies to
substantial quotation, not only to the captured file. This deserves an explicit operator call rather than an
implicit one. Not blocking; the assembler excludes `sequence/` today.

## 4. Positive Observations

- **Self-match immunity is handled correctly and deliberately.** Every literal that would trip a rule is
  assembled at runtime, and the two inline regexes survive by virtue of their own escaping (`\/Users\/` in
  source is `\`+`/Users` — the pattern needs a literal `/Users/`, so it cannot match itself). I verified this
  rather than assuming it. The comment at lines 17-18 explains the constraint to the next editor, which is
  exactly the kind of non-obvious footgun that earns a comment.
- **The `OPERATOR-PRECONDITIONS` test is the best test in the file.** It commits the file, then `git rm`s it,
  then asserts the check *still* fails — pinning that the scan covers full history rather than the tip. That is
  the precise failure mode a publish gate has, and most such tests never check it.
- **No regression to the artifact that actually ships.** `npm run check:repo -- --ref github/mrq-42-assembly`
  passes with zero findings at `f4240644`. I ran it.
- **The suite stays well inside budget** — six tests, 6.8s against a 45s ceiling, with a stubbed `gitleaks`
  binary keeping it hermetic.
- **Labels got more honest.** "personal email address" names the actual policy where "real email address" named
  a mechanism, and the two section comments make the third-party / operator-private split legible at a glance.
- **Test names track behaviour, not implementation** — the rename from "rejects internal publication vocabulary"
  to "rejects operator-private content" describes what the contract now is.
