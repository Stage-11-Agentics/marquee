# Plan Review: MRQ-6 — Design system, admin shell, and the check harness

## 1. Verdict

**FAIL (plan-level)**

The revision needed is narrow — decisions to state, not a redesign. Two of the issues below settle **fleet-wide conventions** inside one ticket's plan (the `trace:ac` title rule and the AC-claim manifest), and one asserts a merge gate that has no runner in this build. Those are cheap to fix now and expensive to unwind across fifty downstream tickets.

## 2. Summary

I reviewed the plan against `BUILDPLAN.md` (M-05a/M-06, §7 shared files, §10 traps), `EVALUATION.md` §§1.1–1.6, `DESIGN.md`, `prototypes/skins/skin-c.html`, `prototypes/pipeline-v1.1/index.html`, `sequence/run-state.md`, and the actual `mrq-1-platform-skeleton` branch head (`package.json`, `tsconfig.json`, `vite.config.ts`, `wrangler.jsonc`, `index.html`, `src/index.ts`).

Plan quality is high and unusually *verifiable* — I checked its factual claims and they hold: 224 px sidebar / 52 px topbar / 68 px at ≤1000 px / 54 px bottom rail at ≤760 px are exactly the prototype's values; the sidebar order and copy match the markup token for token; the alias map (`--panel`→`--surface`, `--line`→`--rule-soft`, `--danger`→`--alarm`, …) is correct; the skin-c canonical block really does carry seven track colors against `DESIGN.md`'s "eight"; the ten §1.1 rows plus three §1.5 smokes really are thirteen; and the 7-acceptance / 7-objective speed split is the only reading that reconciles §1.3's table with its prose. The dependency stack is also sound — I confirmed `@cloudflare/vitest-pool-workers@0.20.3` peers `vitest ^4.1.0`, and `vitest@4.1.10` accepts `vite ^8`, so MRQ-1's Vite 8 pin is not a blocker.

The key concern is that the plan invents three cross-fleet contracts (test-title rule, `tests/ac-claims/*.json`, `src/styles/components.css`) and leans on a CI merge gate that will not execute on any PR in this build.

## 3. Issues

---

**[CRITICAL] §4 command 8 / §6 steps 4 and 6 — `trace:ac`'s "every test title must begin with `AC-n`" rule makes this ticket's own tests illegal, and bans non-AC tests fleet-wide**

The plan has `trace:ac` "require each test title to begin with one or more `AC-n` IDs" and lists "a non-prefixed title" as a fixture that must **fail** (§6.6). But MRQ-6 claims no AC, and §6.4 requires "Unit-test the speed classifier with an AC breach, an objective breach, the mixed AC-69 pair, and missing data," while §6.6 requires trace:ac's own fixture suite. Under the plan's own scanner those tests cannot exist. This is not a self-inflicted edge case: it permanently forbids every downstream ticket from writing a helper/unit test that doesn't claim an acceptance criterion — query builders, the D1 chunking helper (M-07/S-3), the ICS serializer, the outbox policy — all of which will want tests that back an AC only indirectly.

`EVALUATION.md` §1.1 does not require this. It says *"every test name begins with the AC IDs it covers"* and defines `trace:ac` as failing on struck/unknown/recycled IDs and on uncovered `auto` ACs. It never asserts that an un-prefixed test is a violation. The plan is stricter than the contract, and the extra strictness is what breaks.

**Recommendation:** Decide the escape hatch in the plan, explicitly, because everyone inherits it. Either (a) reserve a non-claiming prefix — `test('HARNESS · the speed classifier fails only on AC-sourced breaches', …)` — that `trace:ac` accepts and excludes from the coverage ledger, or (b) exclude a named directory (`tests/harness/**`) from the scan corpus. Keep the *positive* rule intact: a title that mentions an AC ID must lead with it, and unknown/struck/recycled IDs still fail. Then correct §6.6's fixture list so the "non-prefixed title" case asserts the chosen behaviour rather than a rejection.

---

**[CRITICAL] §5 — "the required PR job" has no runner; `.github/workflows/ci.yml` will not execute on any PR in this build**

`run-state.md` decision 4 (2026-08-08) and BUILDPLAN §8 item 12a/13 are explicit: development is **private on Forgejo**, and the public GitHub repo is *created* by M-56 as an orphan commit near submission (~Tuesday). Every PR in this build lands on `forgejo/master` (confirmed — `forgejo` is the only remote). GitHub Actions will therefore run for the first time after the build is over. The plan nonetheless describes a three-layer CI as the operative gate — "The required PR job … `npm test` with an independent elapsed-time assertion, and `npm run trace:ac -- --scope=merged`" and "`trace:ac --scope=merged` failing blocks merge." As written, nothing blocks anything.

Shipping `ci.yml` is still correct — BUILDPLAN names it as an M-06 deliverable and the public repo needs it. The defect is the plan treating an unexecuted artifact as an enforcement mechanism.

**Recommendation:** State the split in the plan: `ci.yml` is a **shipped artifact for the published repo**, and during the build the per-PR gate is a **named local command list** run by the delegator before push and re-run by the reviewer (`tsc --noEmit`, `vite build`, `verify-design-contract.mjs`, `npm test` with the wall assertion, `trace:ac --scope=merged`). Put that list somewhere the fleet reads it (§4's harness README, or the ticket's completion comment for the orchestrator to broadcast). If Forgejo Actions is available on `forgejo.stage11.ai` with a runner, say so and add the mirrored workflow instead — but do not leave the question open, because the entire `--scope=merged` design assumes something enforces it on every PR.

---

**[MAJOR] §2 / §4 / §6 — three fleet-wide conventions are minted here with no broadcast path**

The plan introduces, as load-bearing requirements on *other* tickets:

1. `tests/ac-claims/MRQ-N.json` — "Each implementation ticket adds a small owner manifest," plus a non-owning `exercises` relation for duplicate coverage.
2. `src/styles/components.css` as the shared component layer, with per-module CSS beside its module.
3. The test-title rule above.

None of these appear in BUILDPLAN §7's shared-file registry, in any other ticket's scope column, or in `EVALUATION.md`. A gate that fails a PR for a missing manifest file the delegator was never told to write will stall the fleet — and it will stall it on the *first* ticket that claims an AC (M-02, M-05b, M-08), not later.

**Recommendation:** Make the conventions a first-class deliverable of this ticket: a short `scripts/checks/README.md` (or `CONTRIBUTING.md`) covering the manifest schema, the title rule, and where module CSS lives; plus an explicit hand-off paragraph in the implementation completion comment for the orchestrator to broadcast. Additionally, make a *missing* manifest a loud warning rather than a hard failure under `--scope=merged` until CP-2, so a convention rollout gap degrades instead of blocking merges.

---

**[MAJOR] Outcome-and-boundaries / §3 — `index.html`, `tsconfig.json`, and `.gitignore` are edited but unowned**

BUILDPLAN §7 registers exactly four shared files: `wrangler.jsonc` (M-01), `package.json` (M-06), `src/styles/tokens.css` (M-05a), `.github/workflows/ci.yml` (M-06). The plan also edits `index.html` (root/module entry), `tsconfig.json` (JSX + `.tsx` include), and — implied by "Reports go to ignored `artifacts/checks/`" and the two contract-named root reports — `.gitignore`. All three are M-01 artifacts with no declared owner, and all three are wanted by later tickets: M-05b (`landing.route.tsx`), M-14 (public SSR), M-20/M-21 all need the JSX config, and every reporting command will want ignore entries.

Same gap for the *new* shared surfaces the plan creates: `src/styles/components.css`, `src/ui/app.tsx`, `scripts/checks/lib/*`, `tests/ac-claims/`.

**Recommendation:** Add an ownership paragraph to the plan claiming `index.html`, `tsconfig.json`(+ any split configs), `.gitignore`, `src/styles/components.css`, `src/ui/app.tsx`, and `scripts/checks/lib/*` as MRQ-6-owned-and-serialized, matching the language already used for `tokens.css`/`package.json`/`ci.yml`, and surface the list in the completion comment so §7 can be amended.

---

**[MAJOR] §3 — one `tsconfig.json` serving both the Worker runtime and the browser bundle**

MRQ-1 ships `lib: ["ES2024"]`, `types: ["@cloudflare/workers-types"]`, `include: ["src/**/*.ts"]`. The plan says only "Configure Preact automatic JSX in `tsconfig.json` and include `.tsx`."

I tested this: adding `"DOM", "DOM.Iterable"` to that config **type-checks clean today** (`skipLibCheck: true` suppresses the lib-level duplicate declarations), so this is not a build-breaker. It is a correctness erosion. Merging DOM and Workers globals makes `Request`, `Response`, `Headers`, `fetch`, and `WebSocket` ambiguous across two runtimes that do not share shapes — the Worker can typecheck against DOM `Request` and the client against the Workers one. That is precisely the class of error the `strict` + `verbatimModuleSyntax` setup exists to catch, and it gets worse as M-13 (R2 presign), M-14 (SSR), and M-19a/M-20 land.

**Recommendation:** Split now, while there are two files to move: `tsconfig.json` for the Worker (no DOM, workers-types) and `tsconfig.client.json` for `src/ui/**` (DOM, `jsx: "react-jsx"`, `jsxImportSource: "preact"`), joined by project references, with CI running both. Note that `preact-render-to-string` (BUILDPLAN line 22, for M-05b/M-14 public SSR) means the *Worker* config also needs the Preact JSX settings — so the split is on `lib`/`include`, not on `jsx`.

---

**[MAJOR] Whole plan — scope against a single implementation pass**

Counting the deliverables: full canonical token layer with a compatibility tier; ~20 component primitives (`Page`, `Stack`, `Grid`, `Divider`, `Card`×3, `Button`×5, `RouteTabs`, `SegmentedControl`, `Field`×3, `Chip`/`StatusChip`, `Metric`, `EmptyState`, table/toolbar/pagination shells, graph-paper instruments, `Switch`); a three-breakpoint shell with sidebar/topbar/overlay hosts and full focus management; a History-API router; a ~20-entry typed route table; thirteen command registrations; **two real implementations** (`check:repo` with pinned gitleaks + full-history walk, `trace:ac` with a TypeScript AST scanner, ID/tag parser, and JSON report schema); a bespoke `verify-design-contract.mjs`; a three-layer CI; and a §6 verification battery whose steps 4–7 are themselves four test suites. Against a 6 h estimate (2 + 4).

The risk is not that it's impossible — it's that under pressure the *last* items get thinned silently, and the last items here are the ones the fleet depends on (`trace:ac`, the manifest convention, the CI contract).

**Recommendation:** Add an explicit descope order to the plan naming what is non-negotiable (all thirteen script names registered exactly once; `MARQUEE_GATE=1` stub-fails; the ≤30 s hermetic `npm test`; the token layer; the shell geometry and sidebar) versus what may land thinner with a named follow-up (the graph-paper instrument primitives, `verify-design-contract.mjs`'s geometry manifest, `check:repo`'s full denylist beyond gitleaks). Ordering it in the plan is what stops it being decided by fatigue.

---

**[MINOR] §3 — the shell's non-route affordances can still dead-click**

The plan handles `SearchDialogHost` exactly right: "until the search ticket installs a provider, the host renders an honest unavailable/empty state rather than a dead click or a counterfeit search result." Four sibling affordances in the same shell get no such treatment: the footer `Reset demo` button (owner lands much later), `API & CLI`, the event switcher, and the current-user instrument. AC-4's BFS crawler and the "zero dead ends" rubric apply to the shell as shipped.

**Recommendation:** Extend the same unavailable-state protocol to every shell affordance without a landed owner, and say so in §3 as a rule rather than a per-control decision.

---

**[MINOR] §4 command 3 — `check:speed` is the one command whose budget the plan omits**

Every other command carries its budget (seed 30 s, api 2 min, repo 30 s, readme 10 min, mirror 3 min, reset 20 s, test 30 s, e2e 6 min). `EVALUATION.md` §1.1 sets `check:speed` at **≤4 min**.

**Recommendation:** State it, and add the workflow-level timeout for it alongside the others in §5.

---

**[MINOR] §4 — name the vitest/wrangler wiring the pool needs**

The stack checks out (pool-workers 0.20.3 ↔ vitest ^4.1.0 ↔ vite ^8 — verified), but two wiring facts deserve to be in the plan because getting either wrong costs an hour: (a) `vitest.config.ts` must **not** load `@cloudflare/vite-plugin` — a separate root config is the right call and the reason should be stated so nobody "helpfully" merges it into `vite.config.ts`; (b) `poolOptions.workers.wrangler.configPath` points at MRQ-1's `wrangler.jsonc`, which currently carries `REPLACE_ME-DB` / `REPLACE_ME-CACHE` / `replace-me-*` queue names and four queue consumers. Miniflare simulates these locally regardless of ID, but that needs to be proven, not assumed.

**Recommendation:** Name the config path in §4, and fold "`npm test` passes with `wrangler.jsonc`'s TODO-OPERATOR placeholders unresolved" into §6 step 5.

---

**[MINOR] §3 — the prototype hides `.sidebar-foot` below 1000 px**

At ≤1000 px the prototype's media query hides `.sidebar-foot`, so `API & CLI` and `Reset demo` are unreachable on both the compact and the mobile breakpoint — including Playwright's contractual `mobile` (375×812) project. Reproducing one-to-one is correct; the risk is a later e2e author reading it as a bug, or a gate step needing reset-from-mobile.

**Recommendation:** Record it as a known, faithful reproduction in the completion comment, and flag it to the client as a possible design amendment rather than silently diverging.

---

**[MINOR] Contract reconciliation §2 — flag the speed split the way the token count is flagged**

The plan records a deviate-with-flag for the seven-vs-eight track colors, which is the *smaller* interpretive call. The 7-acceptance / 7-objective resolution of §1.3 — splitting the AC-69 row into a build-failing completion record and a warning-only Long Tasks record — is a bigger one, and it determines whether a build fails. (For what it's worth, I checked the arithmetic and the plan's reading is the only one that reconciles the six literally-*Proposed* rows with §1.1 and §1.3's "seven client-signed objective budgets.")

**Recommendation:** Record both reconciliations in the completion comment, and add a `source` field assertion to `speed-report.json` so the classification of every record is auditable rather than implicit in the classifier.

---

**[MINOR] §4 command 6 — `check:repo`'s 30 s budget against a full-history gitleaks walk**

The publish tree is an orphan commit (M-56), so the eventual corpus is small — but until then any run against the working repo walks a history containing `competition-brief-full.pdf`, PNGs, and the full `sequence/research/sources/` tree, all of which are themselves denylist hits. The plan is right that this history is never relabeled clean; what it doesn't say is that `check:repo` therefore must **not** be wired into the pre-push path for ordinary tickets, which `EVALUATION.md` §1.1 nominally asks for ("Pre-push; the gate").

**Recommendation:** State that `check:repo`'s default target is the explicit publish ref, that it fails closed on an unresolved target, and that it is deliberately absent from the per-PR gate until M-56 — so no delegator wires it in and then disables it when it fails.

## 4. Positive Observations

This is the strongest plan I've reviewed on this board, and the strength is specifically that it is **checkable**. Nearly every factual claim it makes about the binding artifacts is one I could verify against the file, and every one held: the geometry (224/52/68/54), the exact sidebar order and copy including the numbered pipeline stages, the alias map from the v1.6 prototype tokens to the canonical skin-c names, the placement of prototype-only `--canvas*`/`*-soft` values, and the thirteen-command inventory. A plan that can be audited this cheaply is worth more than one that merely sounds complete.

The **"Contract reconciliation before code"** section is the best idea in the document and should become a house pattern. Three genuine contradictions across `DESIGN.md`, `EVALUATION.md`, and the prototype were found, resolved with a stated rule (follow the explicitly canonical artifact; don't reinterpret), and marked for flagging — before a line of code committed to one of the readings. That is exactly the work plan review exists to provoke, and it was already done.

The **stub protocol** is genuinely well designed: named owning ticket, named missing precondition, `status:"stub"` in the report, exit 0 in scaffold mode and non-zero under `MARQUEE_GATE=1`. It makes "registered but not implemented" a first-class, self-describing state rather than a lie the gate might swallow — which is the exact failure mode a thirteen-command table registered up front invites.

Several other calls show real judgement: refusing to let `check:repo` relabel the contaminated working history as clean; the honest empty/unavailable state for `SearchDialogHost` instead of a counterfeit result; "do not claim visual fidelity from static tests alone" plus the requirement that browser scope be operator-approved and recorded before screenshots; the explicit `--passWithNoTests` sunset condition; the insistence that CI invoke `tsc`/`vite build` directly so the owned script table stays exactly the thirteen contractual names; and the refusal to raise the 30 s budget as an option. The risk awareness around dependency ordering — reconcile MRQ-1's actual merged head, adapt at its boot seam, flag rather than fork a second client entry — is precisely right given MRQ-1 is still an open branch.
