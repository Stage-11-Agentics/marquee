# Plan Review: MRQ-40 — README, self-host path, and extension points

## 1. Verdict

**FAIL (plan-level)**

The plan is close — well-scoped, honest about the unavailable Cloudflare account, and grounded in real code seams — but it commits to documenting against fixtures that do not exist anywhere in the repo, and it is silent on how the AC-161 claim manifest entry can be honest given that AC-161's oracle (`e2e:empty`) is owned by a different ticket. Both are exactly the kind of ambiguity that turns into an implementer's guess. One revision cycle resolves them.

## 2. Summary

Reviewed the MRQ-40 plan (BUILDPLAN M-45: README + self-host + clean-checkout deploy sequence, empty states, extension points; ACs AC-160–AC-162; gate-backing for `check:readme`) against the task description, `EVALUATION.md` §4/AC register, `BUILDPLAN.md` §5/§7, `scripts/checks/README.md`, and the live source tree. The plan's scope, framing rules (Amendment 4 Cloudflare/API-bonus lead, Amendment 2 legibility), non-goals, and verification sequence are strong and were verified against real files. The key concerns: the plan documents the import section "against `fixtures/sessionize/*`" but that path exists nowhere in the repo (MRQ-31 is backlog), and the AC-161 claim strategy is undefined while manifest `owns` must be unique across tickets and MRQ-41 also targets AC-161.

## 3. Issues

**[CRITICAL] Scope / Build sequence — `fixtures/sessionize/*` does not exist**
The task description (and BUILDPLAN M-45 verbatim) says the import section "is written against `fixtures/sessionize/*`", and the plan's Scope repeats this: "Document Sessionize against `fixtures/sessionize/*` as the fixture-backed import shape." But no `fixtures/` directory or `sessionize`-named fixture exists anywhere in the repo (verified via `find` and repo-wide grep; the only Sessionize reference is a route-table label in `src/ui/shell/route-table.ts:39`). MRQ-31 (Sessionize import, M-30) is still `backlog`, so the fixtures won't appear from that side either. As written, the README would reference a path that a public-repo stranger cannot find, and the fixture-backed claim is untestable. The plan never acknowledges the absence or decides who creates the fixtures.
**Recommendation:** The plan must state one of: (a) MRQ-40 creates a minimal `fixtures/sessionize/` sample payload (named files, shape sourced from Sessionize's public export format) as part of this ticket, flagged in the README and in `docs/notes/` for MRQ-31 to reconcile; or (b) the README describes the import as a documented extension point without referencing a nonexistent path until MRQ-31 lands. Either is defensible; the choice belongs in the plan, not in the implementer's head mid-edit.

**[MAJOR] Scope step 4 / Verification — AC-161 claim strategy undefined and ownership collides with MRQ-41**
AC-161's oracle is "`e2e:empty` crawler over an empty install: every route renders an empty-state component containing a next-action link" (`EVALUATION.md:549`) — an automated e2e criterion. BUILDPLAN M-48 (MRQ-41, "Empty-state pass and craft sweep") explicitly lists AC-161 as its deliverable (`BUILDPLAN.md:141`). Yet this task assigns AC-160–AC-162 to MRQ-40, and the plan's step 4 adds `tests/ac-claims/MRQ-40.json` "for AC-160–AC-162" while simultaneously (and correctly) excluding e2e tests from scope. Per `scripts/checks/README.md`, `owns` is unique across manifests and `--scope=merged` enforces auto-tagged ACs named by present manifests. If MRQ-40's manifest `owns` AC-161 backed only by a plain-Node README text test, it either overclaims an e2e criterion or blocks MRQ-41 from owning it later.
**Recommendation:** The plan should state the exact manifest split: e.g., MRQ-40 `owns: ["AC-160", "AC-162"]` and `exercises: ["AC-161"]` (README documents empty-install expectations; the crawler and ownership go to MRQ-41), or the reverse with an explicit coordination note. Then say what each plain-Node test actually asserts per AC, so the titles' AC prefixes match honest coverage.

**[MAJOR] Build sequence step 1 — the `check:readme` extraction convention exists nowhere, and this README is its input format**
`check:readme` is today a stub (`package.json:14`, deferring to MRQ-57 "Real Cloudflare deploy," still backlog), and no file in the repo defines how the future harness will extract "commands from fenced blocks" — which blocks count as the numbered sequence, which are illustrative, what language tag marks executable steps. The plan says step 1 leaves "the command blocks executable by the README gate," but with no convention recorded, MRQ-57 will build a parser against a README written from a different mental model, and the mismatch surfaces at the D+66 public-push ritual — the worst possible time for an unconditional gate to fail.
**Recommendation:** Have the plan define the convention explicitly (e.g., "the deploy sequence is exactly the `sh`-tagged fenced blocks under the numbered 'Self-host' section, in order; all other blocks use a different tag or an explicit skip marker") and record it in two places: a short maintainer note in the README itself (public-appropriate, self-documenting) and a `docs/notes/` or task-comment handoff addressed to MRQ-57.

**[MINOR] Scope — demo-mode "off" command must match the actual per-event mechanism**
The plan promises "an explicit command to turn demo mode off." In the code, demo mode is not an env var or config flag — it is the `events.demo_mode` column (`src/routes/auth.routes.ts:288`), and demo login returns `demo_disabled` when no demo-mode event exists (`auth.routes.ts:76`). The plan's "403/no-cookie" description checks out, but the documented off-switch needs to be a real executable command against that column (e.g., a `wrangler d1 execute` UPDATE, or seeding without a demo event), not an implied environment toggle.
**Recommendation:** Name the actual command in the plan (or at least the mechanism) so the README doesn't invent a configuration surface that doesn't exist.

**[MINOR] Scope — MRQ-31/M-30 naming should carry both IDs**
The task text uses BUILDPLAN ID M-30; the plan uses Lattice ID MRQ-31. Both refer to the Sessionize import ticket (verified), but the reconciliation marker left in the README/notes should carry both IDs so the folding step is findable from either register.
**Recommendation:** Use "MRQ-31 (BUILDPLAN M-30)" at the reconciliation marker.

## 4. Positive Observations

- **Every named code seam is real.** `src/lib/form-conditions.ts`, `src/jobs/cascade/decisions.ts`, `src/jobs/mail/outbox.ts`, `src/routes/_manifest.ts`, and `src/lib/venue-geometry.ts` all exist, and the "exactly two `always_live` sites" claim is precisely correct (`outbox.ts:127` and `:132`). A plan that cites verifiable specifics like this is one that was written against the tree, not from memory.
- **Honest boundary on the unavailable Cloudflare account.** Distinguishing documented-hosted-commands from MRQ-57's real account work, refusing to claim a live deployment, and recording "observed vs. inferred" evidence separately is exactly the right posture for a gate that cannot fully run yet.
- **Non-goals are crisp and match the ownership map.** No contract-file edits, no AC minting, no touching M-06-owned package scripts or `wrangler.jsonc`, no secrets or Stage 11 internals in public text — all consistent with BUILDPLAN §7 and the public-repo rule.
- **Amendment 4 and Amendment 2 framing are carried into scope verbatim** (Cloudflare + API-bonus lead, Airtable as a deliberate mirror trade, CONTRIBUTING for a stranger implementing a change), so the review of the finished README has a checklist to trace against.
- **The verification plan closes the loop it can close**: fresh-worktree execution of the documented local sequence with a health check and seeded-count assertion is a genuine local rehearsal of AC-160's clean-checkout semantics, and the lifecycle sequencing matches the Lattice workflow.
