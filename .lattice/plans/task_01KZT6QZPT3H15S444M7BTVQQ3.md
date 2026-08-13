# MRQ-102: Delivery health is two pages wearing one: split speaker follow-ups from system health, and make the owed count clickable

Delivery health is currently one page doing two unrelated jobs, and the number
that matters most on it is not clickable. Operator, live site, 2026-08-12.

## 1. Two jobs on one page

> *"Delivery health — no, this needs to be two separate pages. Because the
> action items for speakers that have not heard from you, that's very important.
> And then the health, the technical health of the system, that's a completely
> separate thing."*

He is right, and the code agrees with him: `summarize()`
(`src/lib/delivery-health.ts:844-871`) computes a single `level`/`headline` by
racing **owed speakers** against **capability alarms** and **send quota** in one
priority chain. So a failing storage capability can outrank speakers who never
heard back, and a page whose top line is about people can silently become a page
whose top line is about infrastructure.

**Required outcome — split the route into two, confirmed with the operator:**

| Page | Sidebar | Carries |
|---|---|---|
| **Speaker follow-ups** | `modules` group, near Communications | The owed ledger, the "N speakers have not heard from you" summary, the send-quota picture insofar as it explains *whether people will hear from you today* |
| **System health** | `utility` group, out of the main flow | The eight capability rows, infrastructure facts, storage/trigger/queue status |

Names chosen deliberately: they name the organizer's action, not the subsystem
(`PHILOSOPHY.md` — the organizer's language). The existing route is
`{ id: "delivery-health", path: "/delivery-health", label: "Delivery health",
group: "modules", sidebar: true, external: true }`
(`src/ui/shell/route-table.ts:34`) and it carries its own chrome, so it is
handed a real browser navigation rather than a client-side push — preserve that
behaviour for both pages.

Each page derives its **own** summary from its **own** inputs. Speaker
follow-ups must never be headlined by an infrastructure alarm, and System health
must never be headlined by owed speakers.

## 2. The most important number on the screen is not clickable

`src/lib/delivery-health.ts:855`:

    headline: `${count(urgent)} ${plural(urgent, "speaker has", "speakers have")} not heard from you.`

> *"When it says 364 speakers have not heard from you, that should be
> clickable."*

The detail line already tells the reader what to do — *"Start at the top of the
ledger — each row opens its record"* — which is an instruction standing in for a
link. Make the headline itself the affordance: it goes to the owed ledger
filtered to exactly the urgent set it counts. The count and its destination must
agree; a headline that says 364 and lands on a different number is worse than no
link.

Note `deriveDeliveryHealth` caps the ledger at `OWED_LEDGER_LIMIT` while the
counts deliberately speak for the whole set (its own comment says so). If the
destination shows a capped list, it must say what it is showing.

## 3. The send allowance must say where it comes from

> *"On today's send allowance, we should note that this is based on your email
> configuration. Because it's assumed that a conference would use a professional
> Resend key and you'd be good to go."*

`deriveQuota` (`src/lib/delivery-health.ts:415-455`) raises `Today's send
allowance is used up.` / `is nearly spent.` / `N speakers would not hear from
you today.` as **alarms**, with no indication that the limit is a property of
the *configured mail account* rather than a limit of Marquee. Read as-is, it
looks like the product caps your conference.

Add a plain sentence to the quota copy stating the allowance comes from the
connected email configuration, and that a conference on its own production
Resend key sets its own ceiling. Keep it short and keep it in the organizer's
language — no vendor jargon beyond naming Resend, no configuration instructions
on this screen.

## Constraints

- `DESIGN.md` Flight Deck tokens and voice; **elements never jump** — the
  capability list is a fixed shape precisely so the loading state has the same
  rows as the loaded one (`DeliveryHealthPage.tsx:21`). Keep that property on
  both pages.
- `scripts/checks/verify-design-contract.mjs:28` pins the sidebar label list and
  `tests/unit/route-table.test.ts:7` asserts it. **Both must be updated
  deliberately** — they exist to make an accidental sidebar change loud.
- No migration. Prefer no API change; if the split genuinely needs one, say why
  in the PR.
- Test titles must begin `AC-<n> · ` or `CONTRACT · ` or `trace:ac` fails.
- Suite budget 45s, gate budget 120s.

## Acceptance criteria

- AC-1 · Two routes exist, `Speaker follow-ups` and `System health`, each
  reachable from the sidebar in the groups above.
- AC-2 · Speaker follow-ups derives its summary only from owed/quota facts; an
  infrastructure alarm cannot become its headline.
- AC-3 · System health derives its summary only from capability/infrastructure
  facts; owed speakers cannot become its headline.
- AC-4 · The "N speakers have not heard from you" headline is a link, and its
  destination lists exactly the urgent rows it counted.
- AC-5 · Send-allowance copy states the limit comes from the connected email
  configuration.
- AC-6 · The sidebar label contract test and design-contract check both pass
  against the new labels.
- AC-7 · Both pages keep a fixed-shape loading state that does not reflow.

## Verification

Drive both pages in a browser locally and screenshot each. Click the owed
headline and screenshot where it lands, showing the count matches. Attach all
three.

## File ownership

OWNS: `src/ui/health/**`, `src/lib/delivery-health.ts`, the health entries in
`src/ui/shell/route-table.ts`, `scripts/checks/verify-design-contract.mjs` and
`tests/unit/route-table.test.ts` **for the health labels only**, and its own
tests.
MUST NOT TOUCH: `src/ui/submissions/**` (MRQ-101, open PRs #53/#54/#56),
`src/ui/shell/Topbar.tsx` (MRQ-101), `src/ui/shell/Sidebar.tsx` (open PR #53),
`scripts/seed/**` (MRQ-100), or any migration.

**Rebase onto `github/main` immediately before opening the PR** — open PR #53
touches `src/ui/health/DeliveryHealthShell.tsx` and is expected to merge first.

Related: MRQ-74 ("Delivery and system health surface") is the ticket that built
this surface and is still `in planning`. This ticket supersedes its single-page
shape; leave a comment on MRQ-74 rather than editing its plan.

---

## Divergent copy preserved on reconcile (2026-08-13)

The board and the PR branch each carried edits the other lacked. The PR-branch copy is above; the board copy follows verbatim so neither is lost.

# MRQ-102 execution plan

## Scope

Split the existing delivery-health surface into two real browser routes without
an API or schema change:

- `Speaker follow-ups` in the `modules` sidebar group, carrying owed speakers
  and quota facts that explain whether people can hear from the organizer.
- `System health` in the `utility` sidebar group, carrying only capability and
  infrastructure facts.

Preserve the current external/full-navigation behavior and fixed-shape loading
layout on both pages. Keep all edits inside the ticket's ownership list; do not
touch submissions, Topbar, Sidebar, seed scripts, or migrations.

## Implementation

1. Baseline `github/main` in an isolated `mrq-102-health-split` worktree and
   inspect the existing health derivation, shell, route, and tests.
2. Refactor `src/lib/delivery-health.ts` into explicit speaker-follow-up and
   system-health summaries. Keep quota copy tied to the connected email
   configuration and Resend ceiling. Add a stable urgent-ledger destination
   whose filter semantics and displayed/capped count agree with the headline.
3. Split the owned health UI into the two route shells/pages, preserving the
   fixed capability-row shape and using the new labels and route groups.
4. Update only the health entries in the route table, design-contract sidebar
   labels, and route-table contract tests. Add tests with `AC-<n> ·` or
   `CONTRACT ·` titles covering the seven acceptance criteria and adversarial
   summary separation.

## Verification and handoff

- Run `npm test` within 45 seconds and `npm run pr-gate -- --ticket=MRQ-102`
  within 120 seconds; record actual timings and any contention caveat.
- Start the local app, drive both routes in c11's embedded browser, and capture
  three screenshots: Speaker follow-ups, System health, and the owed-headline
  destination with matching count/cap notice. Attach them to the PR.
- Rebase onto the latest `github/main` immediately before opening the PR, run
  `npm ci`, then re-run the exact-head suite/gate. Push `mrq-102-health-split`
  to `github` and open a GitHub PR for human merge. No deployment or remote
  migration is authorized.
- Comment on MRQ-74 that MRQ-102 supersedes its single-page shape; do not edit
  MRQ-74's plan.
