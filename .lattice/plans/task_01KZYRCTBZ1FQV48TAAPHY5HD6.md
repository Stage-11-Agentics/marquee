# MRQ-175: Bulk send ships raw template syntax: an unknown merge token is never validated

Round-9 defect, **major**, `speaker-management` (`runs/2026-08-13T22-25-26/judgements/speaker-management.json`).
New this round — it does not appear in round 4. **No rubric item punishes it**; the area
scored 15/15. It is on the list because a bulk send is irreversible and this one goes to 81
people.

## The judge's own words

> **`/communications` — compose body, preview pane, and queued log entries.** An
> unsupported merge token is neither rejected nor stripped: `{{portal.link}}` is absent
> from the MERGE FIELDS palette, yet it renders literally as "{{portal.link}}" in the
> preview pane and, after queueing, in the stored per-recipient message body ("Your speaker
> portal is here: {{portal.link}}"). Nothing warns at save or queue time, so recipients
> would receive raw template syntax in a bulk send that went to 81 people.

## Read this before you "fix" the renderer — the passthrough is deliberate

`src/jobs/mail/render.ts:22-31`:

```
 * Merge fields are deliberately boring: the template owns the field names,
 * and an absent value stays visible in previews rather than disappearing.
 * This keeps an operator from sending a message that silently lost context.
```

and `mergeTemplate` returns `` `{{${key}}}` `` when the value is null/undefined.

**That choice is right and must survive.** Silently deleting a token is worse than showing
it: the operator would send a sentence with a hole in it and never know. Do not change
`mergeTemplate` to strip unknown tokens.

The defect is that the deliberate behaviour is doing two different jobs and only one of
them is honest:

- **A known field with no value for this recipient** — showing `{{speaker.company}}` in the
  *preview* is the designed warning. Correct.
- **A field name that does not exist at all** — `{{portal.link}}` is a typo or a guess. It
  is not a missing value; it can never resolve, for any recipient, ever. Rendering it into
  the preview and then *queueing it anyway with no warning at save or queue time* turns a
  typo into 81 emails containing raw template syntax.

The renderer is the wrong layer. The compose and queue path is the right one.

## What to build

1. **Validate at compose/save and again at queue.** Extract every `{{token}}` from the
   subject and body with the same regex the renderer uses
   (`/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g`), and compare against the known merge-field set — the
   same set the MERGE FIELDS palette renders, read from one place, not a second hardcoded
   list that can drift from the palette.
2. **Name the offenders.** The message says which tokens are unknown, verbatim, not "invalid
   template". The operator must be able to fix it without hunting: *"`{{portal.link}}` is
   not a merge field. Available fields are listed under MERGE FIELDS."*
3. **A bulk queue with unknown tokens does not proceed.** This is the irreversible step and
   it is the one that currently has no guard at all. Blocking here is the point of the
   ticket.
4. **Ad-hoc and stored templates go through the same check.** `renderAdHocMail` exists
   precisely so callers "do not get a second renderer with subtly different merge-field
   behavior" — the validator inherits that rule.
5. **Do not degrade the preview.** An unknown token still renders literally in the preview,
   now accompanied by the warning. The preview keeps telling the truth; it simply stops
   being the only thing that noticed.
6. **Elements never jump.** If the warning appears above or below the composer, reserve its
   space so the body textarea does not move under the operator's cursor as they type.

## Acceptance

- Queueing a bulk message whose body contains `{{portal.link}}` is refused, and the refusal
  names `portal.link`.
- Queueing the same message with `{{speaker.first_name}}` succeeds.
- A known field that is null for a given recipient still queues, and still renders its token
  literally — the existing designed behaviour, pinned by a test so a later change cannot
  quietly take it away.
- Regression test fails on `main`, passes on the branch.

## Constraints

- Your **own linked worktree**, created first:
  `git worktree add ../Marquee-worktrees/mrq-173-merge-token -b mrq-173-merge-token main`.
  Verify with `pwd` and `git branch --show-current`. Never the primary checkout (it is the
  Lattice board's home); never `mrq-auto-eval*`.
- **Never `git stash` anywhere in this repo** — the stash stack is shared across worktrees.
- **No migration without the operator.** This needs none.
- **Do not deploy.** An eval round is running; a `.deploy-freeze` marker sits at the primary
  checkout. Merging is wanted; deploying is not, and is not yours.
- Gate serialized. macOS has no `flock(1)`; wrap it, e.g.
  `python3 -c 'import fcntl,subprocess,sys; f=open("/tmp/marquee-gate.lock","w"); fcntl.flock(f, fcntl.LOCK_EX); sys.exit(subprocess.run(["npm","run","pr-gate"]).returncode)'`
- PR: `gh pr create --repo Stage-11-Agentics/marquee --base main`.
