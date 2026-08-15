# Plan Review: MRQ-207 — Organization settings fold

**Reviewer note on inputs.** The review prompt's "Plan" section is a verbatim copy of the
task description — the harness appears to have embedded the wrong field. The real plan
exists at `.lattice/plans/task_01M00Y3WPXYJ5Z5X9HKSQRNP3V.md` (66 lines, written
2026-08-14 16:32) and is what this review evaluates. If the harness intended to review a
plan that genuinely was only the description, that would have been an automatic FAIL; the
actual artifact is far better than that.

## 1. Verdict

**PASS** — the plan is complete against the ticket's scope list, its coordination claims
verify against the repo, and its decomposition is sound. The issues below are worth a
plan-file touch-up or explicit handling during implementation, but none blocks starting.

## 2. Summary

Reviewed the MRQ-207 plan (org profile/default columns, scoped invite mint + short code,
Amendment-19 removal-cascade extension, `readTheme()` org fallback, person-record
remove-from-conference and portal-revocation routes, `/org` surface, UI-only token move,
Amendment-21 contract fold) against the task description, `sequence/org-settings-design.md`
(rulings O1–O8 + iterations 2–3), and the codebase. Every verifiable allocation claim is
accurate: migrations end at `0016` so `0017` is correctly claimed (MRQ-204 coordinated to
`0018`); EVALUATION's high-water AC is AC-293 so the AC-294–301 block is right;
USER_STORIES ends at US-87 so US-88–89 is right; SPEC's highest amendment is 19, consistent
with 20 going to MRQ-204 and 21 here; `mintOrganizerInvite`, `readTheme()`
(`src/ui/shell/theme.ts:138`), and the FK-count assertion (105 at
`scripts/schema-verify.mjs:309`) all exist as described. The key concern is that
authorization for the new and extended routes is unstated anywhere in the plan, on a
security-sensitive ticket whose neighboring governance ticket (MRQ-212, backlog) owns the
final authz policy.

## 3. Issues

**[MAJOR] Plan §§4–5 / §7 — Authorization for new routes is unstated**
The plan adds or extends several privileged routes — organizer removal with token
revocation, person-record remove-from-conference, portal-access revocation, org
profile/default writes — but never says who may call each one. The design's iteration-3
rulings ("Only the Owner removes anyone"; "Org settings visible to Owner + org-wide
Organizers only") are explicitly allocated to MRQ-212 per the plan's own scope boundaries,
and MRQ-212 is still in backlog. That split is legitimate, but it means this ticket ships
the *mechanisms* under some interim authz rule the plan never names. On a
security-sensitive ticket, "whatever the existing middleware happens to enforce" is not a
stated rule, and a reviewer of the eventual PR has no baseline to check against.
**Recommendation:** Add one short block to the plan naming the interim authorization for
each new/extended route (e.g., "removal + revocation: any `owner`/`program_lead` org-wide
member, tightened to Owner-only by MRQ-212; org settings writes: owner + org-wide
program_lead"), and state it in Amendment 21 so the tightening in MRQ-212 is a diff against
a written rule rather than against silence.

**[MINOR] Plan §1 — Inheritance wiring for the new default columns is out of scope but not said to be**
O7 gives every default column a consumer: default timezone "seeds the timezone field when
creating a new conference," comms defaults and branding are "inherited as the default by
every new conference." The plan wires exactly one consumer (`readTheme()` for the theme
default) and the settings round-trip; conference-creation inheritance is wired nowhere. The
ticket description's scope list (the design doc's "Build implications") indeed only says
"organizations gains profile/default columns," so this is defensible — but the plan should
say so, otherwise the implementer may either scope-creep into conference-creation code or a
later reviewer may flag dead columns.
**Recommendation:** Add one line to Scope boundaries: inheritance-at-conference-creation
(timezone seed, comms/branding inheritance) is deliberately deferred, and name where it
lands (a follow-up ticket or MRQ-209's org-Home/create-conference work).

**[MINOR] Plan §7 — The surface step is thin relative to the work it names, and tab naming skips the iteration-3 rename**
"`/org` with four tabs" is one line covering the largest UI chunk in the ticket: the
organizers list with role/scope chips, the two-step safety-biased removal dialog with the
token checklist, the invite modal with role + scope + short code, and the five-theme
gallery cards (iteration 2's opinionated picker). The binding prototype (pipeline v1.15)
defines all of it, so one-to-one reproduction is a real contract — but the plan doesn't
even name the four tabs, and iteration 3 renamed "Instance" → "Server" while the sibling
Activity ticket (in progress) will want a fifth tab slot in the same shell.
**Recommendation:** Name the tabs (Organization · Organizers · Server · API tokens — with
the O3/iteration-2 dialogs and iteration-2 theme gallery called out as prototype-bound),
and note that the tab shell should not preclude the Activity tab arriving from its own
ticket.

**[MINOR] Acceptance — Two shipped mechanisms have no acceptance line**
The short-code join path (mint → `WORD-WORD-NNNN` → `/join/:token` resolution → single-use
consumption) and the `readTheme()` org-default fallback (org default wins over hard-coded
`day`; per-user choice still wins; no flash via the mirrored pre-paint value) are both
built by this plan but absent from its Acceptance section, as is the `/settings/api`
redirect. Rate-limiting posture on the ~29-bit short-code resolver is also worth one
sentence — the design ruled guessability a non-issue via single-use + expiry, but the
resolver is an unauthenticated endpoint and Amendment 21 should say which existing
throttle covers it.
**Recommendation:** Add acceptance lines for short-code exchange, theme-fallback
precedence, and the redirect; state the throttle coverage in Amendment 21.

**[MINOR] Harness — Truncated project context in the review prompt**
The prompt's Project Context section cuts off mid-sentence ("Speed is"), dropping most of
the rules of the road. Not a plan defect, but worth fixing in the review-prompt generator
alongside the wrong-field plan embed noted above.
**Recommendation:** Fix the prompt generator to embed the plan file and the full context.

## 4. Positive Observations

- **The coordination block is exemplary.** Every contended resource — migration number,
  AC block, US numbers, amendment number — is explicitly allocated against the named
  sibling ticket (MRQ-204), with the rebase rule stated ("both import lines kept, numeric
  order"; "higher value wins" for `Next mint:`). Every one of those claims verified
  against the repo. This is exactly how parallel contract-first tickets avoid the merge
  wars this board has already seen.
- **Scope boundaries are drawn ticket-by-ticket.** Naming what is *not* mine (MRQ-209,
  -210, -212, -213) with the one forward-compatibility note that matters (the invite mint
  built general enough for MRQ-213's second door) prevents both scope creep and a second
  mint path later.
- **Security mechanics show real design taste**: seat read off the consumed row and never
  off the request; revocation arms returned as statements so all of them land in one
  `DB.batch()`; short codes hashed at rest; nullable defaults so unset stays
  distinguishable from chosen; pre-amendment invites defaulting to what they already
  meant.
- **Test-first on the part that must not regress**: per-arm revocation tests written
  failing first, plus the before/after count check that published sessions and org-level
  person records survive the cascade — precisely the O5a invariant.
- **The theme-registry move** (`src/lib/theme-registry.ts` so the Worker validates without
  a second copy) is the kind of small structural call that prevents drift instead of
  documenting it.
