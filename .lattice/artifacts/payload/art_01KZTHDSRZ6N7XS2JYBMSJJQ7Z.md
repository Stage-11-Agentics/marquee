# MRQ-107 code review — reviewed commit `0bf998a` (branch HEAD)

Three rounds, one headless reviewer per round (`claude -p`, timeboxed 900s), each reading
`git diff github/main...HEAD` adversarially. Lattice's auto-fired review timed out at 600s under
machine load 118, so these were spawned directly per COMMON's fallback rule.

## Verdict: PASS

Round 3 returned **PASS-WITH-NITS** against `b721670`; all four nits were fixed in `0bf998a`,
which is the reviewed commit and the branch HEAD.

## Round 1 — `20dffe9` → PASS-WITH-NITS (2 major, 5 nits)

| Finding | Resolution |
|---|---|
| MAJOR: person lookup case-sensitive against a lowercased needle; `uq_people_org_email` is case-sensitive, so `Nora@` beside `nora@` creates a duplicate identity and mints the link for the wrong one | Fixed: `lower(email) = ?`, with an exact-case-first tie-break added in round 3. Test: "an address that differs only in case reaches the person who already holds it" |
| MAJOR: a magic link is person-scoped, so an invitation aimed at a staff address returns an owner session on demo conferences | Fixed: the route refuses any address resolving to a person holding `owner`/`program_lead`/`ops`. Test: "an invitation cannot be aimed at a program-team member" |
| NIT: `invite_sent` claimed a send that demo suppression swallows | Fixed: `demoMailWouldBeSuppressed()` exported from the consumer decides it; response carries `invite_suppressed`; copy names the right cause |
| NIT: scope replacement undocumented | Fixed in the OpenAPI description and the dialog copy |
| NIT: unbounded `track_ids` | Fixed: `.max(50)` |
| NIT: unguarded `people` insert races `uq_people_org_email` | Accepted, not fixed. Two simultaneous invites for the same new address 500 rather than corrupt; the unique index holds the invariant |
| NIT: 409 pre-check races the `WHERE NOT EXISTS` insert in `addCommitteeReviewer` | Accepted, not fixed. Same shape as above |

## Round 2 — `4209a2c` → FAIL (2 blockers)

Both blockers were contract registries the branch had turned red, and both were amended with
argued entries rather than loosened:

- `tests/node/auth-boundary.test.mjs` enumerates every `mintMagicLink` issuer (A-5). The reviewer
  invitation is a third one. It is enumerated with the argument — the ticket's own instruction is
  to reuse `mintMagicLink` rather than invent a second credential path — plus two new assertions
  pinning the staff refusal and the `purpose: "login", redirectTo: "/reviewer"` shape.
- `tests/node/bulk-paths.AC-66-69.test.mjs` classifies every dynamic placeholder expansion. The two
  in `findDemoPersona` are classified (bounded by a two-entry preference table and a three-value role
  taxonomy) and the `replaceReviewerScopes` entry is renamed to its extracted owner `ownedTrackIds`.

Also in round 2: MAJOR — the staff guard was event-scoped while the credential it gates is
org-scoped. Fixed: the guard now spans the organization and fails closed.

## Round 3 — `b721670` → PASS-WITH-NITS (4 nits, all fixed in `0bf998a`)

| Finding | Resolution |
|---|---|
| `invite_sent`/`invite_suppressed` asserted nowhere | Fixed: a test covers both the suppressed and the allowlisted-delivery case |
| the refusal message claimed staff "already has review access", untrue for staff on a sibling event | Fixed: the message now states only what the guard knows |
| the re-submit guard covered the confirmation state but not the in-flight one | Fixed: `inviteSaving` guards the handler, not just the button |
| `demoMailWouldBeSuppressed` dropped the `always_live` short-circuit its caller applied | Fixed: the predicate takes `sendPolicy` and owns the whole rule; `shouldSuppress` now delegates entirely |

## Standing exposure, stated rather than hidden

On a demo conference an organizer can type any existing non-staff address and read back a working
sign-in link for that person. The shipped public `POST /api/v1/auth/magic-link` already returns an
on-screen link for any address on a demo event to an *anonymous* caller, so this route sits at a
strictly higher privilege bar (`program_lead`) than an exposure that already exists. Worth closing
across both routes; out of scope here.
