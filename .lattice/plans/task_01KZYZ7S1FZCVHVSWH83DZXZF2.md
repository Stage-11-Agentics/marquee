# MRQ-192: A source-text contract test forced a production type-safety regression

Found by #199's author while working around a test that would not go green. **I verified the
production half on current `main` before minting: the degraded code is still shipped.**

## What happened

MRQ-93's contract test asserts on the **literal source spelling** `requestJson('/api/v1/me/profile'`.
To satisfy that regex, production code was changed to cast the response as
`{ person: PortalPerson }` instead of using the typed generic.

**The test made the shipped code less type-safe, and the test was green throughout.**

Current `main`, `src/ui/portal/PortalPage.tsx:593`:

```ts
await requestJson("/api/v1/me/profile", { method: "PATCH", body: JSON.stringify(body) });
```

No generic. That is the shape the regex demanded, and it is what is running.

#199 fixes it in the right direction: the regex now accepts the optional generic while still
checking the shared write path exists, and production restores
`requestJson<{ person: PortalPerson }>(...)`.

From #199's author, verbatim: *"That was a type-safety regression caused by the test, not an API
requirement."*

## Why this is a ticket and not a note

There is already a known follow-up that MRQ-169's contract test asserts source text across five
page files and would fail on a rename. **This changes the argument for it.** That style of test is
not merely brittle:

> **It has already degraded production code once, silently, in the direction of less safety.**

A test that can only stay green if the code gets worse is a defect in the test. It applies pressure
in a direction nobody chose, it does so invisibly, and it will do it again — a green suite is
exactly what it produces while doing it.

Note the shape: this is the night's recurring failure inverted. Everywhere else we found guarantees
with no live path — a declaration with no call site, a check that cannot fail. **This is a check
that fires perfectly and enforces the wrong thing.**

## Scope

**Enumerate the source-text-asserting contract tests, and for each ask whether the shipped code has
been shaped to satisfy the string rather than the behaviour.**

Sizing, measured rather than guessed — 20 test files read source files as text
(`read("src/…` / `readFile(… "src/…`), with a control: the same pattern over `migrations/` returns
0, so the search is discriminating rather than matching everything. `tests/node/onboarding-column-widths.test.mjs`
is in that set and is the file whose CNT-07 assertion I already flagged this week for proving a
call site exists rather than that the helper sorts.

For each of the 20, the question is not "is this test brittle" but **"has production been bent to
satisfy it"** — a rename is an inconvenience, a type cast is a regression. Report the files you
checked and **cleared**, not only the ones you changed; a list of "these are fine" is the evidence
the sweep happened.

Two known: MRQ-169's five-file test (rename-fragile, not yet shown to have bent anything) and
MRQ-93's (bent production, confirmed). **MRQ-93's was found by accident**, when someone had to work
around it. The others are found by grepping, not by waiting for the next accident.

## What to do with each finding

Not "delete the test". Source-text assertions have a legitimate job here — several of them pin CSS
rules and rendered class names that no type system or unit test can see, which is precisely the
class of defect the merge guard exists for. The fix is to **assert the property, not the spelling**:
accept the forms that satisfy the contract, and where a behavioural test can carry the same
guarantee, move it there and say so.

## Acceptance

- The 20 source-text-asserting test files are enumerated, each marked bent / brittle / fine, with
  the reasoning.
- Every case where production was shaped to satisfy a string is restored to the better form and its
  assertion widened to accept it.
- A regression test for at least the MRQ-93 case that fails if the generic is stripped again.
- No test is deleted without saying what guarantee it was carrying and where that guarantee now
  lives.

## Constraints

- Cut your worktree from `github/main`; CLAUDE.md now carries the correct instruction. Verify:
  `if git fetch github; then if git merge-base --is-ancestor github/main HEAD; then echo current; else echo 'behind -- rebase'; fi; else echo 'FETCH FAILED -- not attempted'; fi`
- **Never `git stash` anywhere in this repo** — the stash stack is shared across every worktree.
- **Push when the work is written, before the verification run.**
- **A red gate is real.** `fail` from a findings-derived check is load-invariant; `pass-over-budget`
  is a warn; `timeout` is the only status contention can manufacture. Never dismiss failing tests as
  a baseline without naming the commit that made them pass.
- Gate through `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/gate-lock.sh`.
- Test titles start with `CONTRACT` or `AC-<n>`, then a middle dot.
- No migration. Do not deploy.
