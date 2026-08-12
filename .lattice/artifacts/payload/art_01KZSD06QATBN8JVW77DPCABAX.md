# Code Review — MRQ-57 (diff reviewed: `nav-remove-uninstalled-modules`, commit `bbc7b00`)

### 1. Verdict

**PASS** — for the diff as presented.

One scope caveat that the verdict does not cover, and that the operator should read before
treating this as "MRQ-57 reviewed": **the diff is not MRQ-57's work.** See Issue 1.

### 2. Summary

The reviewed diff removes two route-table rows for modules that were never built
(`/settings/airtable`, `/evaluation/ai`), drops the `href` on the delivery-health "Airtable
sync" capability row so it no longer promises a screen that does not exist, and adds two
contract tests that lock both facts down. The change is small, correct, self-consistent, and
lands on the right side of the project's own honesty rule — an installed route claims a module
exists, and these two claimed one with nothing behind it. Verified green locally:
`tsc --noEmit` (exit 0), `check:design` pass, `trace:ac` pass (0 uncovered, only AC-16 pending
operator), `vitest tests/unit/route-table.test.ts tests/unit/delivery-health.MRQ-74.test.ts`
39/39, `node --test tests/node/quick-search.AC-101-104.test.mjs` 4/4.

The key finding is not in the code: this diff answers a different ticket than the one the
review prompt describes, and MRQ-57's actual deliverables are sitting uncommitted in the
working tree, unreviewed.

### 3. Issues

**[MAJOR] (process, not code) — Reviewed diff does not implement the described task**
The prompt describes MRQ-57: real Cloudflare resources, secrets, custom domain, migrations,
deploy verification. The diff contains none of that — it is a navigation/copy change on branch
`nav-remove-uninstalled-modules`. Meanwhile MRQ-57's real work *is* on this machine, uncommitted:
`wrangler.jsonc` (every `REPLACE_ME-*` replaced with live D1/KV/R2/Queue identifiers,
`R2_ACCOUNT_ID` moved from `vars` to a Wrangler secret), `.dev.vars.example`
(`R2_ACCOUNT_ID=local-fake-account-id`), and `sequence/OPERATOR-PRECONDITIONS.md` (§1–§3
rewritten with 2026-08-11 evidence and the corrected credential path). None of it was in the
diff, so **none of it is reviewed here** — including the public-repo secret question, which is
exactly the part of MRQ-57 that most deserves a second pair of eyes.
**Fix:** re-run the review with the MRQ-57 diff as the target (`git diff -- wrangler.jsonc
.dev.vars.example sequence/OPERATOR-PRECONDITIONS.md`), and treat this PASS as scoped to the nav
change only. Worth confirming in that pass that the committed D1 `database_id` / KV namespace id
are acceptable in a repo destined to go public — they are account-scoped identifiers rather than
credentials, and the diff deliberately kept `R2_ACCOUNT_ID` out, but that judgment should be
recorded, not assumed.

**[MINOR] sequence/UX-SWEEP-PLAN.md:70,77 and sequence/UX-SWEEP-FINDINGS.md:32 — route
inventories still name the two removed routes**
The sweep plan enumerates `/evaluation/ai` → "AI assist" and `/settings/airtable` → "Airtable
mirror" as organizer routes to visit, and the findings file records all three stubs as "not a
bug, just so the operator knows." After this change those two URLs render "This route is not
installed" instead of the documented "ready for its module" empty state. The next sweep will
either flag a false regression or paper over a real one.
**Fix:** strike both rows from `UX-SWEEP-PLAN.md`, and amend the `UX-SWEEP-FINDINGS.md` Polish
row to name only `/settings/tasks` with a note that the other two were removed deliberately.

**[MINOR] src/ui/shell/route-table.ts:38 — `task-templates` survives the same rule that killed
the other two**
The new test comment argues `/settings/tasks` stays "because the onboarding tasks behind it are
real and shipped, so its empty state describes an unbuilt screen rather than an absent feature."
That is a real distinction, but the route is reachable only by typing the URL — nothing in the
sidebar, settings, or onboarding navigates to it (grep: the only in-app `navigate("/settings/…")`
is Venues, from `EventSettings.tsx:277`). So the route's practical effect is identical to the two
removed ones: a judge who guesses the URL sees "Task templates is ready for its module."
**Fix:** either give it an entry point (a link from onboarding or Event Settings) so the
distinction is visible to a user, or remove it on the same rule. Leaving it as-is is defensible
for the deadline; it just should be a decision rather than an omission.

**[MINOR] src/lib/delivery-health.ts:677 — redundant cast, inconsistent with the sibling row**
`href: null as string | null` needs the annotation only when a later branch overwrites `href`
with a string; nothing in `mirrorCapability` does. `storageCapability` (line 516), the other
permanently-linkless row, writes plain `href: null`.
**Fix:** `const base = { id: "mirror", label: "Airtable sync", href: null };` — matches the
existing precedent for a row that never links.

**[MINOR] src/lib/delivery-health.ts:681–688 — the alarm state now has neither a link nor an
instruction**
When the mirror is stuck the row goes red and says "Your Airtable base is behind. Anyone working
there is looking at old information" — true, and now with nowhere to go. That is the correct
consequence of removing a fake destination, but the organizer is left with an alarm and no next
action, which is the one thing the delivery-health surface exists to prevent.
**Fix (optional, copy-only):** have the alarm detail name where the action lives — e.g. "…
Nothing here to fix: the mirror is configured where this conference is hosted." Low priority;
the linkless row is still strictly better than a link that 404s.

### 4. Positive Observations

- **The right fix, not the convenient one.** The easy move was to build a stub screen at
  `/settings/airtable` so the link would resolve. Removing the claim instead is the choice
  `PHILOSOPHY.md` asks for, and the commit message ("Stop advertising two modules this product
  does not have") states it exactly.
- **No dead end introduced.** `AppShell.tsx` already degrades an unmatched route to
  `routeName = "Route not found"` plus an honest EmptyState with a "Back to Program home"
  action, so the removed URLs land somewhere recoverable rather than white-screening. Verified
  by reading the fallback branch, not assumed.
- **Both tests assert behavior through the public surface.** `matchRoute("/settings/airtable")`
  and `capability.href` are what callers actually consume; neither test reaches into the array
  literal or counts rows. The delivery-health test checks both the unconnected *and* the
  draining snapshot, which is the loop where a `...base` spread could have leaked an href back in.
- **Test titles carry their reasoning.** "the mirror row never offers a destination, because
  there is no mirror screen to reach" tells a future reader why the assertion exists — and both
  titles use the `CONTRACT · ` prefix `trace-ac-core.mjs` requires, so the AC trace stays clean.
- **No collateral references left behind.** Grepped `src`, `tests`, `scripts`, and `docs`:
  nothing else routes to, links to, or asserts on `/settings/airtable`, `/evaluation/ai`, or the
  `airtable`/`ai-assist` route ids. The `readme.AC-160-162` assertion on `/Airtable mirror/` is
  about README's extension-point table and is unaffected; `quick-search.AC-101-104`'s
  `routeRows.length >= 20` still holds at 26 rows; `check:design`'s required-label list never
  included either route. Both were checked by running the tests, not by reading them.
- **Consistent with the record.** AC-225–AC-229 (the Airtable mirror story, including the
  Settings → Airtable page in AC-228/229) are already carried as knowingly uncovered in
  `tests/ac-claims/MRQ-42.json`, so removing the route contradicts nothing the project claims to
  have built.
