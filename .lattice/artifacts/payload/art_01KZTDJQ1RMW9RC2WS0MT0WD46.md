# Plan Review: MRQ-122 — Headshot seeding and public rendering

## 1. Verdict

**FAIL (plan-level)** — one major coordination gap leaves a named task deliverable
(headshots on directory cards) with no owner under the two live plans. Everything
else in the plan is sound; this is a narrow revision, not a rewrite.

## 2. Summary

Reviewed the MRQ-122 plan against the task description, spec section T-I3
(`sequence/eval-response-tickets.md`), the actual code (`src/lib/public-site.ts`,
`src/ui/embeds/EmbedPage.tsx`, `scripts/seed/`, `wrangler.jsonc`), and the
authoritative MRQ-121 board plan the task tells the delegator to coordinate with.
The plan is well-scoped, privacy-aware, and technically feasible — the demo-marker
approach is directly supported by the existing `people.is_demo` column and the
seed already sets it. The key concern: the plan forbids itself from ever touching
MRQ-121's directory card markup, while MRQ-121's plan (Cycle-1 resolutions,
authoritative) explicitly scopes headshots *out* — so under the two plans as
written, requirement (3)'s directory-card leg is implemented by nobody.

## 3. Issues

**[MAJOR] Contract and scope, item 3 — directory-card headshots fall into the gap between MRQ-121 and MRQ-122**
The task requires "img with initials fallback on **directory cards**, embed
speaker kinds, and /p/:slug" and directs coordination with the directory ticket.
MRQ-121's plan states "MRQ-121 does not seed or serve headshots (T-I3 owns that
follow-up)" and ships an initials-only avatar slot; its card cannot reference
`headshotUrl`, because that field won't exist on its branch. This plan, in turn,
says MRQ-122 "must not … edit its card markup" and only keeps the shared avatar
component "available." Passive availability renders nothing: if both plans
execute exactly as written, the directory — the surface EMB-04/EMB-14 rubric
credit most depends on — never shows a headshot, and the miss surfaces at code
review or later, when both PRs are already open.
**Recommendation:** Make the integration explicit and owned. Either (a) add a
sequencing step: after MRQ-121 merges, MRQ-122 rebases and swaps the directory
card's avatar slot to the shared `PublicSpeakerAvatar` component inside this
ticket's PR (a small, mechanical edit — the task's "coordinate" directive and
MRQ-121's "T-I3 owns that follow-up" language both sanction it, superseding the
blanket no-touch rule); or (b) post a board comment agreement that MRQ-121 will
consume `headshotUrl`/the shared component once MRQ-122's projection change
lands, and record that agreement in both plans. Either resolution is fine; the
plan must name one.

**[MINOR] Contract and scope / risks — no mention of the EmbedPage.tsx merge collision**
Both tickets edit the same lines: MRQ-121 turns the speaker card/list renderers
(`EmbedPage.tsx:154–168`) into anchors; MRQ-122 adds avatars to the same two
functions (`:157`, `:165`). Both branches are `in_progress` concurrently. A
textual merge conflict here is near-certain and trivially resolvable, but the
plan should acknowledge it and state the expectation (rebase onto whichever
lands first; preserve MRQ-121's anchors when adding the avatar element).
**Recommendation:** Add one line to the risk/verification section naming the
expected conflict and the resolution rule.

**[MINOR] Implementation plan — static-asset location and serving path unstated**
The plan commits SVGs "as static assets" at `/headshots/<slug>.svg` but never
names where they live. There is no `public/` directory in the repo today;
Vite's default `publicDir` must be created so the files flow into `dist/client`
and get served by the Worker's assets binding. That path works — `/headshots/*`
is absent from `run_worker_first` in `wrangler.jsonc`, so assets serve directly —
but the review checklist asks plans to identify files created, and this plan
names neither `public/headshots/` nor the manifest module's location.
**Recommendation:** Name the concrete paths (e.g. `public/headshots/<slug>.svg`,
`src/lib/headshot-manifest.ts` or similar) and note that `public/` is being
introduced, so the implementer verifies the Vite→assets pipeline picks it up
rather than discovering it mid-build.

**[MINOR] Implementation plan — slug-keyed manifest is the fragile key choice**
`publicSpeakerSlug` is `slugify(name)` with the id only as fallback
(`public-site.ts:268`), so two same-named speakers collide on slug, and any
name edit silently detaches the avatar. The `is_demo` gate prevents the worse
failure (a real production speaker inheriting a synthetic avatar), so this is
robustness, not privacy.
**Recommendation:** Key the manifest by seeded person id (stable via `seedId`)
rather than slug, deriving the URL filename however is convenient. Also verify
the asserted counts (30 speakers / 23 published sessions / 27+3 split) against
the actual seed at implementation time, and if the real count differs, hold the
"2–3 photo-less" rule from the task rather than the hard-coded 27/3.

## 4. Positive Observations

- **The demo-marker design is verified feasible, not aspirational.** The
  `people.is_demo` column exists (`migrations/0001_init.sql:142`), every seeded
  person sets it to 1, and the speakers subquery already builds `speakers_json`
  via `json_group_array(json_object(...))` — adding the marker, gating
  `headshotUrl` in `parseSpeakers`, and stripping it from the public shape is
  exactly the right seam. Keeping real/unrecognized speakers at `null` is a
  well-considered privacy boundary.
- **Honesty rules internalized, not just repeated.** Alt text that calls the
  asset an avatar rather than a photograph extends the task's "a fake face is a
  lie" principle into a detail the task didn't ask for.
- **Non-goals are sharp and correct.** The R2/media-origin refusal, the
  no-competing-`/speakers` rule, and the no-AC-minting line all match the spec's
  explicit traps.
- **Fleet-aware verification.** Targeted Vitest instead of the full suite, the
  `uptime`-before-`pr-gate` load check, evidence attached at `in_validation`,
  and stopping at `pr_open` all follow the shared-box operating rules. The
  adversarial self-review list (leaked real image URLs, accidental R2 wiring,
  missing null fallback, unpublished-speaker disclosure, layout shift) is a
  genuinely good checklist — layout shift in particular tracks the operator's
  "elements never jump" ruling.
