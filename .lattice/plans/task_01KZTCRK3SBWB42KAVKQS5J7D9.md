# MRQ-122: Headshot seeding and public rendering

## Contract and scope

Implement T-I3 / register row 35 for EMB-04 and EMB-12, including the visible half
of SPK-08. Work from the isolated `mrq-122-headshot-seeding` worktree rooted at
`/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-122-headshot-seeding`.

In scope:

1. Add deterministic, deliberately synthetic monogram/geometric SVG assets for
   the 30 speakers on the 23 published seeded sessions. Give 27 speakers an
   asset and intentionally leave three without one so the public UI exercises an
   honest initials fallback. Assets must be local, static, and contain no faces,
   stock imagery, external URLs, or personal image data.
2. Add `headshotUrl: string | null` to `PublicSpeakerSummary` and derive it in
   `parseSpeakers` only for the allowlisted seeded demo identities; a real or
   unrecognised public speaker remains `null`.
3. Render the fixed-size synthetic avatar or initials fallback on `/p/:slug`
   and both public speaker embed kinds (cards and list). Keep the shared avatar
   component available for MRQ-121's directory cards; MRQ-121 owns the directory
   page/card render tree and this ticket must not create a competing `/speakers`
   implementation or edit its card markup.

Non-goals:

- Do not add an R2/media-origin route, fetch attachment bytes, or reinterpret
  `person_headshot` attachments as public assets. The real upload-to-public path
  belongs to T-D2/post-deadline work.
- Do not change the public-speaker directory route owned by MRQ-121.
- Do not alter contract documents, mint AC IDs, or expose private people data.

## Implementation plan

- Add a small public-headshot manifest/helper that maps the 27 synthetic demo
  speaker slugs to `/headshots/<slug>.svg`, keeping the 3 intentional gaps
  explicit and deterministic.
- Extend the public projection's speaker JSON with the demo marker needed to
  keep synthetic assets demo-only, then parse to `headshotUrl` without exposing
  that marker in the public shape. Preserve existing published-only filtering.
- Add a reusable fixed-size `PublicSpeakerAvatar` renderer with stable reserved
  dimensions, `alt` text that calls the asset an avatar (not a real photograph),
  and initials fallback when `headshotUrl` is null. Use it in the speaker detail
  page and embed card/list rows; leave MRQ-121's directory markup to that ticket.
- Add focused tests for the manifest/card/detail projection and for the seeded
  27-assets/3-fallback contract. Test synthetic paths and the no-external-request
  boundary, not R2 or deployed media.

## Verification and handoff

- Targeted Vitest for each touched test file; never run the full `npm test` on
  the shared fleet box.
- Self-review the exact branch HEAD adversarially for leaked real image URLs,
  accidental R2 wiring, missing null fallback, unpublished-speaker disclosure,
  and layout shifts. Attach a PASS review artifact naming that exact HEAD.
- Enter `in_validation`, run the targeted live/local public render smoke that
  proves `/p/:slug` and speaker embeds emit the expected image/fallback markup,
  and attach the evidence (or a precise N/A if the environment makes it
  impossible).
- Check `uptime` before `npm run pr-gate -- --ticket MRQ-122`; if the one-minute
  load exceeds 24, wait 2–3 minutes and retry. Paste the passing gate output in
  the completion comment and open the GitHub PR against `github/main`, citing
  MRQ-122, T-I3, row 35, EMB-04, EMB-12, and SPK-08. Stop at `pr_open`.
