# MRQ-185: A published session with no on-stage participant renders a bare em dash to attendees

Round-9 **minor** defect, recorded independently by **two** area judges in the same run —
`ai-agenda` and `public-widgets` — and a repeat of a round-4 defect. No rubric item punishes it;
both areas scored 100% and 97.1%.

## The judges' own words

`public-widgets`:

> **`/agenda?event=aie-ny-2026` (first Mon Oct 12 09:00 card) and the `/embed/config` live
> preview.** A published session renders with no speaker on the public program: the 'Lightning:
> Agents in Production Q&A' card shows a bare em dash '—' where the speaker line belongs, on the
> public agenda, and **the same empty line reproduces inside the embed widget's live preview**.
> Attendees see a scheduled talk with nobody attached to it.

`ai-agenda` adds the part that identifies the cause:

> although the same session lists 'Marcus Okafor' as its speaker **in the builder tile and in the
> publish review list**. Sibling cards on the same page (e.g. 'Advanced AI Engineering with AI
> SDK' — Nico Albanese) render speaker name, title and company correctly, so the speaker data is
> dropped for this record rather than absent by design.

Round 4 logged the same shape: *"A session with no assigned speaker renders a bare em dash '—' in
place of the speaker line rather than [an honest empty state]."*

## The cause, traced — and the filtering is CORRECT

`src/lib/participants.ts:40-44`:

```ts
function roleFilterSql(alias: string, audience: ParticipantAudience): string {
  if (audience === "program") return "";
  const roles = SPEAKING_PARTICIPATION_ROLES.map((role) => `'${role}'`).join(", ");
  return ` AND ${alias}.role IN (${roles})`;
}
```

`SPEAKING_PARTICIPATION_ROLES` is `speaker`, `co_speaker`, `moderator`, `chairperson`. The agenda
builder tile and the publish review list read audience **`program`**, which applies **no** role
filter and therefore prints everyone including a `submitter`. The public agenda card and the embed
read audience **`public`**, which correctly restricts to on-stage roles.

**So the person the judge saw in the builder is attached in a non-speaking role, and filtering them
off the public page is right.** Do not widen `SPEAKING_PARTICIPATION_ROLES` and do not make the
public audience read `program`. A submitter is not on stage and the public programme must not say
they are — `participants.ts:12-15` says exactly this and it is correct.

**The defect is the empty state.** When the filter removes everyone, the card renders a bare `—`,
which reads to an attendee as a data error and to a judge as a dropped record. The product knows
the difference between "nobody is on stage for this session" and "we lost the speaker"; the card
does not say either.

## What to build

1. **An honest empty state on the public session card** when no participant survives the public
   audience filter. Say what is true — "Speaker to be announced" is the conference's own language
   for it — rather than printing punctuation. Whatever the wording, it must not read as a
   rendering failure.
2. **The same treatment inside the embed preview and the embed output**, since the judge saw it
   reproduce there. One renderer, not two.
3. **Elements never jump** — the speaker line must occupy the same height whether it names a
   person or states the absence, so cards in a grid stay aligned.
4. **Give the organizer the other half.** A published session with no on-stage participant is
   usually a mistake the organizer would want to know about before attendees do. If there is a
   cheap place to surface it — the publish review list already enumerates exactly these sessions —
   name it there. Keep this small; if it grows beyond a line and a count, stop and say so on the
   ticket rather than expanding the PR.

## Acceptance

- A published session whose participants are all non-speaking roles renders a stated empty line on
  the public agenda and in the embed, never a bare em dash.
- A session with a real speaker renders exactly as it does today.
- `SPEAKING_PARTICIPATION_ROLES` and the public/program audience split are unchanged.
- Regression test fails on `main` and passes on the branch, covering both the public agenda and the
  embed path.

## Constraints

- Your **own linked worktree**, created as your first act, then `pwd` and `git branch --show-current` to prove it. Never the primary checkout (it is the Lattice board's home); never `mrq-auto-eval*`.
- **Never `git stash` anywhere in this repo** — the stash stack is shared across every worktree.
- **No migration without the operator.**
- **Do not deploy.** Deploys are queued and coordinated by the merge captain; shipping is not yours even though the freeze has lifted.
- **Gate serialization is a fleet rule.** Route EVERY `npm run pr-gate` and EVERY full `npm test` through `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/gate-lock.sh`, one-off runs included.
- **Read the `status` field before you believe a red.** `fail` is load-invariant — believe it. `pass-over-budget` is a warn. `timeout` is the only status contention can manufacture: re-run the SAME sha once on CI (safe and recommended — CI is idempotent) and compare the parent commit's `elapsedMs` before investigating.
- PR: `gh pr create --repo Stage-11-Agentics/marquee --base main`.

## Implementer plan

1. Add one shared public speaker-empty label and use it for the public agenda card,
   public session detail, and both embed layouts so the attendee sees a stated
   absence rather than punctuation.
2. Preserve the existing public/program role split and speaker rendering; reserve
   one speaker-line height for the new label so card geometry stays stable.
3. Use the existing program-role payload in the publish-review candidate to flag a
   candidate with no on-stage role as `Speaker to be announced` without changing
   the data model or adding a migration.
4. Add integration coverage for a published submitter-only session on the public
   agenda and embed HTML/config-preview path, plus a unit assertion for the
   publish-review warning and the unchanged real-speaker path.
5. Run the focused regression tests, then the serialized full suite and PR gate;
   record the exact commands and results on the ticket and open one PR.
