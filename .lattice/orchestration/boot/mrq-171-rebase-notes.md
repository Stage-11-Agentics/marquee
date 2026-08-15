STOP AND READ BEFORE YOU RESOLVE THE REBASE. The reviewer went and read what is on the other side of your conflict, and there is a trap in it that typechecks.

WHAT CHANGED UNDER YOU. main is now 4bf7d2db. The conflict in src/ui/portal/PortalPage.tsx is not incidental — 32729a87 is #202, "Social profiles: a handle the speaker types, a badge everyone sees", and it REWROTE ProfileForm, the exact component your reviewer home reuses:

1. platforms: SocialPlatformId[] is now a REQUIRED PROP (PortalPage.tsx:519 on main). Your call site renders <ProfileForm eventId={...} person={profile} onSaved={...} /> with no platforms.
2. ProfileForm IS NO LONGER EXPORTED on main. Its export list is { NoSeatNotice, PortalPage, SubmitterPortal }. Your "export function ProfileForm" was the conflicting hunk — so re-establishing that export is a DELIBERATE act you must redo, not something you inherit by resolving.
3. The social-links input changed shape entirely: the free-text textarea became per-platform prefixed fields, with initialSocialDraft(person.social_links) in and composeSocialLinks(handles, other) out.
4. Therefore your onSaved(person) widening AND your "as { person: PortalPerson }" cast must be RE-VERIFIED against the new PATCH body. Do not carry them forward on the assumption they still match — that cast was proved correct against a nine-field response that no longer exists in that shape.
5. #202 also loosened the MRQ-93 ProfileForm contract regex "to the reuse it actually guards" — that contract is now load-bearing for precisely the reuse you are performing. Read it and make sure you still satisfy it.
6. portal.routes.ts auto-merges, but #202 touched the same updateProfile whose auth gate you rewrote. A clean textual merge there is NOT semantic clearance. Read that pair together.

THE TRAP, AND IT IS TONIGHT'S SHAPE ONE MORE TIME. After you rebase, the missing platforms prop is a hard typecheck error. Loud, good — the compiler is doing its job. But it has a right answer and a wrong answer AND BOTH COMPILE:

  WRONG, and it typechecks clean:  platforms={[]}
  RIGHT:                           the event's configured platforms

platforms={[]} is what the compact task-surface call site legitimately passes, so it looks idiomatic and it is sitting right there in the same file. On the REVIEWER HOME it renders a profile editor with NO SOCIAL FIELDS AT ALL — a form that looks like it works, silently missing a capability, with a green gate behind it. And the reviewer queue payload has no social_platforms field today, so [] is genuinely the path of least resistance.

CORRECTED 2026-08-13 — my earlier phrasing here was harmful and produced the exact defect it
was warning about. It offered `speaker.event.social_platforms ?? [...SOCIAL_PLATFORM_IDS]`,
and the right-hand side was taken alone. **A `??` can be half-copied; a resolver cannot.**

The right answer is ONE thing, not a choice: carry the event's configured platforms on the
reviewer payload and resolve them through the existing reader, `readEnabledPlatforms`
(`src/lib/social-platform-setting.ts:17`, already `readEnabledPlatforms(row?.value_json ?? null)`).
It also filters unknown ids and sorts into product order, which a hardcoded spread does not.

Do NOT pass `[...SOCIAL_PLATFORM_IDS]`. It renders fields — so a presence check passes it —
while silently overriding what the conference configured. Only set-equality catches it. Whichever you pick, PROVE IT IN THE BROWSER — open the reviewer home's profile editor and confirm the social fields actually render and save. A screenshot of a profile block with no social section is what failure looks like here, and nothing else will catch it.

SO YOUR REBASE IS NOT MECHANICAL. Budget for it. Order:

  1. Commit your uncommitted work first. DO NOT STASH — the stash stack is shared across every worktree in this repo and two agents stashing in the same minute swap stacks. Commit, even broken.
  2. git fetch github && git rebase github/main
  3. Resolve PortalPage.tsx and portal.routes.ts BY HAND, with the six points above in front of you.
  4. Re-establish the ProfileForm export deliberately.
  5. Fix the platforms prop the RIGHT way.
  6. Run the merge guard (it is fixed now; a LOST is real): /Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/portal-merge-guard.sh
  7. Re-verify the seam behaviourally: reviewer home profile renders/saves/persists WITH social fields; speaker portal unchanged; #193's no-seat fix intact; #197's legibility intact; #202's social fields intact on the speaker side.
  8. Then the outstanding three — nit (A)'s Refresh ejection, the deep-link browser drive, the test-only-seam collapse — plus the PR body corrections.

The reviewer's code verdict on your logic is UNCHANGED and still stands: the dead end is closed, the deep-link authorization is safe in three layers, revise-vs-new distinguishes, reviewer-scope.ts is a provable pure extraction. None of that lives in PortalPage.tsx, so the rebase should not disturb it. It is the profile seam — third time it has moved under this PR — that needs the care.

Report the sha when it is pushed and green.

## Before you believe ANY negative browser result — confirm the instrument is live

A dead or stale local Worker produces symptoms identical to a broken merge: blank surface,
stuck "Loading…", missing styling, no data. None of it distinguishes "the code is wrong"
from "nothing is serving the code". An agent came within one message of reporting a
regression that did not exist tonight because its Worker had died mid-rebuild.

```sh
lsof -i :<port>                   # is anything actually listening?
curl -s localhost:<port>/health   # and is it serving YOUR build?
```

`/health` is at the ROOT — `/api/health` and `/api/v1/health` both 404. The field is
**`build`**, not `build_sha` (that name only appears in log lines), and it is a 12-char sha:

```sh
curl -s localhost:<port>/health   # -> {"service":"marquee","status":"ok","build":"3a5314dc743d",...}
git rev-parse --short=12 HEAD      # compare against `build`
```

Compare that against the commit you think you are testing. **A stale server
is worse than a dead one** — it answers confidently with the wrong program, which is how
you "verify" a fix that was never loaded.

Same class as `node --test` on a vitest file printing "fail": a harness that is not up is
not a result. Read the failure, not the count, and confirm the instrument before trusting
the reading.

### Instrument-liveness is asymmetric — know which direction your evidence is exposed in

A dead or stale Worker manufactures **false negatives** freely and **cannot manufacture a
false positive**. It cannot serve you a rendered social-fields section that only exists in
your change.

- **Validating a NEGATIVE** (nothing broke, the regression is absent, X no longer happens)
  → confirm the instrument *first*. This is the exposed direction.
- **Validating a POSITIVE** (the new thing renders, the fix works) → ask instead: *could
  this result exist without my change?* If not, the instrument proved itself live by
  producing it. Cheaper, and self-verifying.

Restate checks as positives wherever possible. For the `platforms` trap specifically:
"the social section is missing" is a **negative** you could equally get from a dead server.
Assert the social fields **are present and save**, not that nothing looks wrong.

Caveat on `build`: it is not always your branch, legitimately. A diff touching only
seed scripts or data never rebuilds the Worker binary — the changed thing is the DATA in
D1. Compare against the commit you expect the *binary* to be.
