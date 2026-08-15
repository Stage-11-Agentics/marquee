# MRQ-199: CLAUDE.md's fast-forward rule names two files when the property belongs to a class: every prompt read from the primary checkout's working copy

## The rule as written

CLAUDE.md says that merging a change to `CLAUDE.md` or `AGENTS.md` does not
deliver it, because both are auto-loaded from the **primary checkout's working
copy**, and the board-home rule keeps that checkout parked on `main`. So a
merged guidance fix sits on the ref while every session goes on reading the old
text. Whoever merges such a change fast-forwards the board home as part of the
merge, and verifies the working copy rather than the ref.

That is correct. It is also too narrow.

## The property is not about those two files

`sequence/auto-eval/prompts/*.md` have exactly the same property and are not
covered. They are dispatched with:

    c11 launch-agent ... --prompt-file sequence/auto-eval/prompts/implementer.md \
      --cwd /Users/atin/Projects/Stage11/deployments/Marquee

`--prompt-file` resolves against `--cwd`, which is the primary checkout — so
the prompt is read from the **working copy**, not from the ref, exactly like
CLAUDE.md. A merged change to a prompt file changes nothing about what executes
until someone fast-forwards that tree.

This was live during PR #222. That PR's whole point was removing
`implementer.md`'s instruction to hand off to a 'merge warden' deleted four PRs
earlier. Merging it would have changed nothing: every implementer and reviewer
dispatched before the fast-forward would still have read the old line — the exact
line the review had blocked the PR over. A PR that merges and does not take
effect is worse than one that does not merge, because the board says done.

## The fix, stated as a class rather than a list

Widen the rule to cover **anything auto-loaded or `--prompt-file`'d from the
primary checkout's working copy**. Today that is:

  - `CLAUDE.md`
  - `AGENTS.md`
  - `sequence/auto-eval/prompts/*.md`

Do not ship it as that list. The next prompt directory someone adds inherits the
trap silently, and a list is exactly what fails to warn them. Name the property —
*read from the working copy of a checkout that is parked by design* — and give
the list as an illustration of it.

## Acceptance criteria

1. CLAUDE.md's fast-forward section states the rule as a class, not as two
   filenames, and names the mechanism (working copy vs ref) as the reason.
2. `sequence/auto-eval/prompts/` is explicitly included.
3. The verification step still insists on reading the file rather than the ref —
   `grep` the working copy, not `git show`. That is the half of the existing
   rule that actually catches the failure.
4. The recovery path for a refused fast-forward is preserved verbatim: untracked
   `.lattice` files that the incoming commits also add — back them up, remove,
   fast-forward, restore byte-identical, verify with `diff`. Never `git clean`,
   never `--force`; that tree is the fleet's board.
5. Because this ticket edits CLAUDE.md, its own merge is subject to the rule it
   is fixing: whoever merges it fast-forwards the board home and verifies by
   reading the working copy.

## Note

The operator is watching PR #222 and will fast-forward the board home by hand the
moment it merges, so tonight's run is not blocked on this. This ticket is about
the rule misleading the next agent, not about tonight.
