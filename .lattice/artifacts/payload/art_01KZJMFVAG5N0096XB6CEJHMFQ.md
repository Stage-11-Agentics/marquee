# Plan Review: MRQ-6 (cycle 2)

## 1. Verdict

**FAIL (plan-level)**

Three unresolved items, all of them decisions this ticket mints *for the whole fleet* and all of them cheap to settle in the plan and expensive to settle after sixteen tickets have keyed off them. The cycle-1 resolution block is otherwise accepted as sound — every one of its twelve resolutions was checked against the source artifacts and holds up. What follows is new.

## 2. Summary

Reviewed the MRQ-6 implementation plan (design system + admin shell + thirteen-command harness) against `BUILDPLAN.md` §3/§7, `EVALUATION.md` §1.1–§1.5, `SPEC.md` §5, `DESIGN.md`, the binding prototype at `prototypes/pipeline-v1.1/index.html`, the canonical token block in `prototypes/skins/skin-c.html`, and MRQ-1's actual head on `mrq-1-platform-skeleton` (`c22e1bd`, still unmerged). The plan is unusually strong — the contract-reconciliation section is correct on every claim I could check independently (seven canonical track tokens vs. `DESIGN.md`'s "eight"; seven AC-sourced speed rows and seven objectives; 224/52/68/54 px geometry and the 1000/760 px breakpoints all match the prototype byte-for-byte), and the stub/gate protocol is the right shape.

The key concern is the **admin route table**: MRQ-6 mints the URL vocabulary and the registration mechanism that every later admin ticket inherits, and the plan resolves neither the admin/public path collisions that `SPEC.md` and MRQ-1's `wrangler.jsonc` already contain, nor how a later ticket attaches a page without editing the central registry that `BUILDPLAN.md` §7 explicitly forbids.

## 3. Issues

**[CRITICAL] §3 (routing seam) — the admin route vocabulary collides with public SSR paths and with MRQ-1's `run_worker_first`, and the plan mints it anyway**

The plan says "Register the prototype's complete admin route vocabulary now" and, as its only reconciliation, "Public SSR URLs stay outside the admin router." That is a principle, not a resolution, because the collisions are inside the contract already:

- `SPEC.md` §5.11 puts the **agenda builder at `/agenda`** and §5.12 puts the **public event site at `/agenda`**. Same path, two surfaces.
- MRQ-1's merged-pending `wrangler.jsonc` sets `run_worker_first` for `/`, `/api/*`, `/f/*`, `/agenda*`, `/s/*`, `/p/*`, `/embed/*`, `/i/*`. Any admin route landing on one of those patterns works under client-side navigation and then serves the *public* page on reload, deep link, or Playwright's `page.goto` — which is exactly how `e2e` drives the 11-step loop.
- The binding prototype hides this because it is **hash-routed** (`#agenda`, `#publicAgenda`, `#s/${id}`, `#p/${name}`, `#portal`, `#landing`). Its route names cannot be mapped 1:1 onto real paths without a ruling. `#s/:id` is the *admin submission record* in the prototype while `/s/:slug` is the *public session permalink* in SPEC §5.12 — the plan's own list already silently re-homes that one to `submissions/detail` without flagging the divergence.
- `/portal` (SPEC §5.6) is absent from `run_worker_first`, so today it falls through to the assets SPA fallback and would boot the admin shell. Whoever builds it SSR needs a `wrangler.jsonc` edit — an M-01-owned file.

MRQ-6 is the only ticket that can settle this before parallel Wave 1/2 tickets hard-code paths, breadcrumbs, `check:api` route-manifest parity, and e2e URLs against it.

**Recommendation:** Add a "path map" subsection to §3 that enumerates, for every route ID, the real path, its surface (admin SPA / public SSR), and whether it needs a `run_worker_first` pattern. Rule the `/agenda` collision explicitly — recommended: keep the public event site at `/agenda` (it is the judge-facing, cold-load-budgeted, embed-linked surface) and give the builder a distinct admin path (`/agenda/builder` or an admin prefix) — then record it as a deviate-with-flag against SPEC §5.11 in the completion comment and ask the Orchestrator to broadcast it. Name the `wrangler.jsonc` additions the fleet will need as a serialized-surface request to M-01/the Orchestrator rather than discovering them per-ticket. If the client must rule instead, say so in the plan and stop at a named touchpoint — but do not ship a route table that leaves it ambiguous.

---

**[MAJOR] §3 (`route-table.ts`) — a hand-edited central route registry is precisely what `BUILDPLAN.md` §7 forbids, and the attachment mechanism is unspecified**

§7's stated rule: *"one file per route/module, and registration by glob, never by a hand-edited list … No agent ever edits a central registry to add a route."* The plan makes `route-table.ts` "the single typed registry for path pattern, route ID, label, sidebar grouping/icon/filter, breadcrumb, and **outlet loader**," then says "Later tickets attach actual page components to these IDs" without saying how. If attachment means editing the loader entry, then every admin-screen ticket in Waves 1–2 edits one file overnight — the exact merge-failure mode §7 exists to prevent, and serializing it (cycle-1 resolution 4 covers `src/ui/shell/*`) converts a merge problem into a throughput problem on the critical path.

**Recommendation:** Split the concerns. Keep `route-table.ts` to what genuinely must be central and is written once here — sidebar order, labels, grouping, breadcrumb, path pattern, route ID. Resolve *outlets* by glob: `import.meta.glob('/src/ui/*/*.route.tsx')` with each module exporting its own route ID, so a later ticket adds a file and touches nothing shared. Unknown-ID or duplicate-ID registration fails the design-contract check. Document the convention in `scripts/checks/README.md` (cycle-1 resolution 3) and broadcast it — this is the highest-traffic convention MRQ-6 mints.

---

**[MAJOR] §3 / resolution 7 — the honest "unavailable" states are crawler-reachable and can manufacture an AC-2/AC-4 failure**

Resolution 7 and the outcome section commit the shell to rendering an honest empty/unavailable state for every route and affordance whose owner has not landed, reached from the sidebar. `EVALUATION.md` §2 states AC-4 as a *BFS crawler from both demo entries* asserting "every route 2xx, every `href` resolves, no `lorem|TODO|placeholder|coming soon|Tab \d` copy, no zero-child list container," and AC-2 as "no empty-state component is reachable on either demo path." Both are Tier A, no-waiver. Since MRQ-6 registers the complete route vocabulary in the sidebar up front, every unowned route is in the crawl graph from the moment this merges, and the honest-state copy is one careless word ("Coming soon") from a Tier A red — with the failure landing on whoever runs the crawler, not on this ticket.

**Recommendation:** Make three things explicit in the plan: (a) unavailable-state copy is banned from the AC-4 denylist vocabulary and states what *is* true instead ("No agenda has been built for this event yet"), reviewed against the regex in a unit test; (b) unavailable states render no zero-child list container; (c) the completion comment hands the Orchestrator a CP-2 checklist item — "every route registered by MRQ-6 has a real owner or is removed from the sidebar before the AC-4 crawler runs" — so the debt is tracked where it is settled, not discovered at the gate.

---

**[MINOR] §3 / resolution 5 — `vite.config.ts` is MRQ-1-owned, unclaimed by MRQ-6, and is the fallback seam for Preact JSX**

MRQ-1's `vite.config.ts` is `defineConfig({ plugins: [cloudflare()] })` and its root `tsconfig.json` is Workers-only (`lib: ["ES2024"]`, `types: ["@cloudflare/workers-types","node"]`). Resolution 5 correctly puts the JSX settings in the root `tsconfig.json` so Vite's esbuild transform picks them up for the client files (esbuild resolves the nearest `tsconfig.json`, not `tsconfig.client.json`). That should work — but it is a load-bearing assumption about Vite's tsconfig resolution, and if it does not hold, the only fix is an `esbuild: { jsxImportSource: 'preact' }` or `@preact/preset-vite` entry in a file MRQ-6 has not claimed.

**Recommendation:** Name `vite.config.ts` as a *contingent* serialized surface in the resolution-4 list with the fallback stated, so the implementer escalates once rather than either stalling or silently editing an M-01-owned file.

---

**[MINOR] §1 — the token alias table is incomplete, leaving two sources of truth for state colors**

The plan maps `--danger` → `--alarm` but not `--warning` → `--warn`, `--success` → `--ok`, or `--danger-soft` → `--alarm-wash` (all four are literal-identical between the prototype and the canonical block: `#8a5c00`, `#0f7a4a`, `#fbe9e7`). It then says "prototype-only soft state/canvas values retain the binding v1.6 literals," which would re-declare canonical colors outside the canonical block — so a later token change updates one and not the other, and the design-contract check will not catch it because it only compares the canonical region.

**Recommendation:** Alias all four to `var(--…)` of the canonical name. Only `--warning-soft` (`#fdf1dd`), `--success-soft` (`#e5f3ec`), `--canvas`/`--canvas-line`/`--canvas-ink`, and `--display` are genuinely new; put exactly those in the marked derived block and have `verify-design-contract.mjs` assert that no derived entry re-declares a canonical *value*.

---

**[MINOR] §4 command 8 — `trace:ac` should self-verify its parse of `EVALUATION.md`**

`trace:ac` is the one command whose failure mode is silent greenness: a markdown table reformat that breaks the AC/tag parser turns `--scope=all` into a no-op that reports full coverage. `EVALUATION.md` publishes its own invariants — 197 live in-scope criteria, **187 `auto` · 1 `op-assist` · 5 `oracle` · 4 `felt`**, AC-239 struck, tier membership authoritative in `sequence/USER_STORIES.md` §"Scope at a glance" and never re-derived from ID arithmetic.

**Recommendation:** Have the scanner assert its parsed cardinalities against those published counts and exit non-zero on mismatch, with a `CONTRACT · ` test pinning it. Cheap, and it converts the fleet's coverage ledger from "trust the regex" to "the regex proves itself every run."

## 4. Positive Observations

- **The reconciliation section is doing real work, and it is correct.** I checked all three claims independently: the canonical skin-c block does supply seven track tokens against `DESIGN.md`'s prose "eight"; `EVALUATION.md` §1.3 does resolve to exactly seven AC-sourced measurements and seven objectives once the AC-69 / Long Tasks row is split, matching its own "seven *proposed* budgets" prose; and the prototype title/ticket do disagree with `DESIGN.md`'s v1.5 label. Catching a contradiction, resolving it by the stronger authority, and flagging it rather than silently picking one is exactly the behavior that keeps a sixteen-ticket fleet coherent.
- **Every geometry number in §3 matches the binding prototype** — 224 px shell column, 52 px topbar, the 68 px compact grid at ≤1000 px, the 54 px fixed bottom rail at ≤760 px, and the `.sidebar-foot` disappearance that resolution 10 refuses to paper over. Reproducing an inconvenient truth of the prototype and recording it as a possible client amendment is the right instinct.
- **The stub protocol is the strongest single idea in the plan.** `status:"stub"`, exit 0 in scaffold mode, non-zero under `MARQUEE_GATE=1`, and a printed statement of the owing ticket means a terminal gate cannot pass on scaffolding — which is the failure mode a thirteen-command table registered up front would otherwise invite.
- **Cycle-1 resolutions were absorbed properly, not deflected.** The `CONTRACT · ` prefix, the move of enforcement from a dormant GitHub workflow to a local `pr-gate.mjs`, and the Workers/browser tsconfig split are all correct against MRQ-1's actual configuration; `@cloudflare/vitest-pool-workers@0.20.3` peers cleanly on `vitest@^4.1.0`, so resolution 9's wiring is feasible as written.
- **The priority/stop rule (resolution 6) is honest about a six-hour estimate that is plainly under-sized**, and it protects the right things — hermetic ≤30 s `test`, the stub gate, `trace:ac`, the contracted `check:repo` core — while naming what may be traded away, to the Orchestrator, in advance rather than at completion.
