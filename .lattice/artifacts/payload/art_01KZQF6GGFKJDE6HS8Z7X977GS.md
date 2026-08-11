# Plan Review — MRQ-22 (M-20 + M-21: public event site, permalinks, embeds)

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

Reviewed the MRQ-22 plan against the task description, `SPEC.md` §5.12 / §4.2 / §"embeds", `EVALUATION.md`'s AC evidence rows, `DESIGN.md`, and the live repository state at `750ee72` (routes, `wrangler.jsonc`, `migrations/0001_init.sql`, `tests/ac-claims/`, `scripts/checks/*`). The plan is unusually strong on the security-shaped half of the ticket — published-only resolution before private fields load, generic 404 bodies, `auth.kind = public`, no `mq_session` in embeds, no identity dimension in cache keys — and it independently spotted the `src/ui/app.tsx` hydration footgun that would have painted the admin shell over every SSR public page. It fails on three things that are cheaper to fix now than in code review: it never once references the **binding prototype** for a ticket that is 100% designed UI surfaces, it never says how **embed configuration is persisted** despite an `embeds` table already existing in the shipped migration, and its **AC claim manifest as described will hard-fail `pr-gate`** because two of the ACs in the union are already owned by other tickets.

## 3. Issues

**[CRITICAL] Step 4 (AC evidence) — the described `tests/ac-claims/MRQ-22.json` will fail `trace:ac`, and therefore `pr-gate`**

The plan says it will "Add `tests/ac-claims/MRQ-22.json` mapping the auto ACs to the new test files and their runtime/live evidence." Two problems, both verified against the shipped tooling:

1. That is not the schema. `scripts/checks/trace-ac-core.mjs` reads exactly two keys — `owns` and `exercises`, each an array of AC IDs (see `tests/ac-claims/MRQ-62.json`: `{"ticket", "owns", "exercises"}`). Test-file mapping is derived from `AC-N · …` test titles, not declared. Unknown IDs in either array raise `claim-unknown-criterion` / `exercise-unknown-criterion`.
2. The AC union in the task description includes **AC-240 and AC-252**, and both are already owned: `tests/ac-claims/MRQ-11.json` owns `AC-240`; `tests/ac-claims/MRQ-62.json` owns `AC-252`. A second `owns` entry emits `duplicate-owner`, which sets `status: "fail"` on `trace:ac`, which is check #7 in `pr-gate.mjs`. The ticket cannot open a PR.

**Recommendation:** State the manifest verbatim in the plan: `{"ticket": "MRQ-22", "owns": ["AC-83","AC-84","AC-85","AC-86","AC-87","AC-88","AC-89","AC-90"], "exercises": ["AC-240","AC-252","AC-253"]}`. Note that `owns` puts those eight ACs into merged-scope enforcement, so each needs at least one `AC-N · …`-titled test under `tests/` or `uncovered` fails the same gate. Follow `MRQ-9.json`'s precedent — it already `exercises` AC-240.

---

**[CRITICAL] Step 3 (Embeds) — the embed configuration/persistence model is unspecified, and an `embeds` table already exists**

`migrations/0001_init.sql:690` creates `embeds` with `uq_embeds_slug` (line 936) and `idx_embeds_event_kind` (937); SPEC §"embeds" defines it as `event_id`, `kind ∈ agenda|speakers`, `slug`, `config` JSON (tracks, statuses, colors), "served from `/embed/:slug`, cached in KV with a 30-second TTL." The plan describes cache keys, TTL, a purge helper, a config screen, and a `/embed/{slug}` route — but never says where `{slug}` comes from or where the track/status/color configuration lives. AC-88 (filters change the rendered set) and AC-90 (configured colors present in resolved styles) have no source of truth without this decision, and the shape of the config screen depends entirely on it (does "Copy embed code" write a row?).

Note this is not a free choice: the migration is M-02's single migration, so no new column or table is available here.

**Recommendation:** Name the model explicitly in the plan. Either (a) the config screen creates/updates an `embeds` row and the snippet references its `slug` — then specify slug minting, the write's auth policy (organizer-only, not `public`), and idempotency on re-copy; or (b) config travels in the URL/query and `embeds` rows are seeded/pre-existing — then say so, and say what happens to the table. Whichever is chosen, state how `/embed/:slug` resolves `config` and how `config.tracks/statuses/colors` reach the rendered markup.

---

**[MAJOR] Whole plan — the binding prototype is never referenced, and the surfaces it specifies differ from what the plan proposes**

`DESIGN.md:4` binds `prototypes/pipeline-v1.1/index.html` at v1.9: "The build reproduces it one-to-one; every designed control ships. Divergences are legal only where SPEC marks them `[beyond … prototype — acknowledged divergence]`." The plan's only design language is "inline Flight Deck treatment." The prototype has fully realized versions of exactly these screens:

- `publicAgendaView()` (line 2712): public shell header with `Get embed code` + `Organizer demo`; eyebrow `October 12–14 · <venue>`; `Agenda` H1 with sub-line; a `Subscribe to calendar` button; day segment / track select / `Search the agenda`; session rows as time+room gutter → linked title → linked speakers + company → track chips with `· Primary` on the first.
- `publicSessionView()` / `publicSpeakerView()` (2714–2721): including a designed 404 empty state (`404` mark, "This session is not published. No private title or speaker information is available.", `View the agenda` CTA) — the plan's "generic 404 responses" has a designed form it should reproduce.
- `showEmbedModal()` (line 2819): the embed surface is a **modal dialog opened from the public shell's `Get embed code` button**, with an `Agenda | Speaker gallery` segment, a readonly embed-code textarea, a `Live preview` panel, `Close`, and `Copy embed code`. SPEC §5.12 calls it the "**Embed dialog**."

The plan instead proposes a standalone `/embed/config` route as the configuration screen. That is both a divergence from the binding contract and a different navigation model — `Get embed code` has no destination in the plan.

**Recommendation:** Add a step that reads the prototype's `publicAgendaView`, `publicSessionView`, `publicSpeakerView`, and `showEmbedModal` and enumerates the controls to reproduce. Implement the config surface as the dialog reachable from `Get embed code` on the public shell (a `/embed/config` route may exist as a deep-link, but it is not the primary). Decide and state what `Subscribe to calendar` does here — M-24 owns ICS, so it ships disabled/deferred with a named divergence rather than being silently dropped.

---

**[MAJOR] Step 3 — the "prototype-compatible event/kind alias" is unroutable as planned**

The prototype's snippet emits `https://marquee.stage11.dev/aie-nyc-2026/{agenda|speakers}/embed` — i.e. `/{eventSlug}/{kind}/embed`. `wrangler.jsonc` sets `assets.not_found_handling: "single-page-application"` with an explicit `run_worker_first` allowlist: `/`, `/api/*`, `/health`, `/__validation/*`, `/f/*`, `/agenda*`, `/s/*`, `/p/*`, `/embed/*`, `/i/*`. A path outside that list never reaches the Worker — it is served `index.html` with **200**. So the alias would return the SPA shell, not an embed, and it would do so silently (no 404 to notice in testing).

**Recommendation:** Either emit snippet URLs under `/embed/*` only (and treat the prototype's URL string as prototype-mock text, naming the divergence), or add the alias pattern to `run_worker_first` in `wrangler.jsonc` — which is a shared infrastructure file and needs to be called out as such (see next issue). Add a test that asserts the copied snippet's URL actually resolves to embed markup, not to the SPA shell.

---

**[MAJOR] Step 1 — the plan edits shared files while the ticket declares "Shared files: none"**

The plan modifies `src/index.ts` (mount public page routes) and `src/ui/app.tsx` (don't overwrite SSR public markup); the alias fix above would add `wrangler.jsonc`. The ticket header says "Shared files: none — module-local under `src/routes/` and `src/ui/public/`, `src/ui/embeds/`." Both edits are correct and necessary — the `app.tsx` one especially, since today's guard is `if (window.location.pathname !== "/") render(<AppShell/>, root)`, which would clobber `/agenda`, `/s/*`, `/p/*`, and every embed. But other Wave 1 tickets mount routes in the same composition root, and `src/ui/app.tsx` is one of the four files `scripts/checks/verify-design-contract.mjs` reads.

**Recommendation:** List the shared-file edits explicitly in the plan with their conflict surface, keep each to the minimum diff (one `app.route(...)` line; a path-prefix predicate in `app.tsx` rather than a rewrite), and rebase before `pr_open`. Prefer a data-driven public-path list in `app.tsx` so a later public route doesn't require re-touching it.

---

**[MAJOR] Step 4 — AC-240 and AC-252 cannot go green from public-surface work, and the plan doesn't scope its slice**

`EVALUATION.md:579` (AC-240) requires "every scheduled fixture shows day/time/room on **list, record, portal, and board**; unpublished items show 'Not yet public' + **publish**; Scheduled/Published stage copy is exact" — and the plan's non-goals correctly exclude the admin agenda builder and the publish mutation. `EVALUATION.md:591` (AC-252) requires buildings CRUD in Event Settings, `check:seed` asserting the SPEC §6 building set, plus agenda room headers, room view, **public session pages**, and ICS `LOCATION`. BUILDPLAN line 339 confirms the split: "M-10/M-15/M-20/M-32 carry scheduled/public legibility (AC-240)."

**Recommendation:** Name the delivered slice in the plan — for AC-240, the public-side "scheduled-but-unpublished is not public" distinction and any public-shell copy; for AC-252, the "Room · Building" label on public session pages via `roomDisplayLabel` (`src/lib/venues.ts:35`). Pair this with the `exercises` fix in the claim manifest, and say in the completion comment that final green depends on MRQ-11/MRQ-62.

---

**[MAJOR] Step 4 — `e2e:`- and `speed:`-tagged evidence is not addressed, and adding e2e specs has a fleet-wide side effect**

EVALUATION's evidence rows for this ticket's owned ACs are mostly `e2e:` (AC-83, AC-84, AC-87, AC-88, AC-90), `e2e:mobile` + `speed:` (AC-85), and `speed:` (AC-89). The plan runs only the hermetic vitest suite plus manual Wrangler/curl probes. Two consequences:

- `tests/e2e/` does not exist today, so `scripts/checks/run-e2e.mjs` stubs out to MRQ-50. The moment **any** `*.spec.ts` lands in `tests/e2e/`, that runner stops stubbing and instead `throw`s `"e2e requires MARQUEE_E2E_URL; local dev is not a substitute"` for every agent in the fleet who runs `npm run e2e` without a deployed URL. `pr-gate` doesn't run e2e, so this would not surface in this ticket's own gate.
- `check:speed` requires `--input` with all 14 manifest records measured on deployed infrastructure; the plan's five local cold loads are not that, which the plan already acknowledges honestly.

**Recommendation:** State explicitly whether this ticket adds `tests/e2e/` specs. Default recommendation: it does **not** — cover the same behavior with hermetic in-process tests against `app.fetch` (status, markup, filter effects, resolved color tokens, 375px-shaped assertions where meaningful) and leave the Playwright loop to MRQ-50, noting in the completion comment which ACs await it. If e2e specs are added, coordinate with MRQ-50 first and say so.

## Minor

**[MINOR] Step 3 — `embed.route.tsx` deviates from the BUILDPLAN's named file, correctly, but silently.** The task description names `src/routes/embed.routes.tsx`; the plan writes `src/routes/embed.route.tsx`. The plan is right — `src/routes/_manifest.ts` globs `./**/*.routes.ts`, which a `.tsx` file cannot match, and the documented convention is plural `*.routes.ts` for JSON API modules, singular `*.route.tsx` for SSR pages. **Recommendation:** state the rename and its reason in the plan so review doesn't read it as drift.

**[MINOR] Step 1 — 404s must be produced by the page route, never fall through.** `src/index.ts` ends with `app.all("*", (c) => c.env.ASSETS.fetch(...))`, and asset SPA handling returns `index.html` with 200. A permalink miss that returns from the route is fine; one that calls `next()` or is left unmatched is a silent 200. **Recommendation:** assert `status === 404` (not just body content) for `/s/:slug` and `/p/:slug` misses in the AC-86 tests, including well-formed-but-unpublished and syntactically valid unknown slugs, for both HTML and API responses.

**[MINOR] Contract decisions — derived slugs are unstable and diverge from the prototype's ID-based session permalinks.** No `slug` column exists on `agenda_items` or `people` (only `organizations`, `events`, `forms`, `embeds` — `migrations/0001_init.sql`), so a derived slug is the only option without a migration. But the prototype links sessions as `#s/{id}` and speakers as `#p/{encodeURIComponent(name)}`, and a title edit under the plan's scheme silently breaks every previously shared session URL. **Recommendation:** either use the ID for `/s/:slug` (prototype-aligned, stable) or keep the title slug and accept ID as a permanent alias; state the tie-break rule for collisions concretely so it's testable.

**[MINOR] Step 3 — the purge seam has no enforcement.** The plan exports a purge helper and "document[s] its intended call from the publish mutation without changing the agenda ticket's files." Nothing then guarantees the agenda ticket wires it; AC-89 would still pass on the 30 s TTL alone, so the omission is invisible. **Recommendation:** say in the plan that the completion comment will name the exact call site the publish writer must add, and consider a test that fails loudly if the helper has no caller once the publish mutation lands (or file it as a follow-up note on the agenda ticket).

## 4. Positive Observations

- **The hydration footgun was caught unprompted.** Recognizing that `src/ui/app.tsx` would render `<AppShell/>` over SSR public markup on every path except `/` is the single highest-value catch in the plan; it would otherwise have presented as "the public agenda flashes then turns into the admin app."
- **The leakage model is right, and right for the right reason.** "Resolve a permalink by first selecting the published set; a private or scheduled-but-unpublished record is therefore indistinguishable from a missing record before any private fields are loaded" is a structural answer to AC-86 rather than a filtering afterthought, and the explicit list of fields that never enter the public view model (AV capabilities, room notes, access notes, coordinates, emails) matches AC-253's "absent from all public surfaces" exactly.
- **Guardrail A-5 is honored precisely** — no `mq_session` read, `Cache-Control: public`, and no identity dimension in the cache key, which is the actual failure mode SPEC §5.12 warns about (an authed fragment that works for the previewing organizer and silently degrades on the customer's site).
- **Reuse over reinvention:** `roomDisplayLabel(room, building)` for AC-252 instead of a second label formatter, and `*.routes.ts` placement so the generated manifest and OpenAPI document pick the API routes up by glob — including the explicit step to *inspect* the built manifest rather than assume it.
- **Evidence honesty.** "Keep claims truthful: a local speed probe is not a deployed cold-load result" is exactly the discipline `check:speed`'s `--input` requirement exists to enforce, and it is rare to see a plan pre-commit to it.
- **Non-goals are drawn tightly and correctly** — no publish mutation, no calendar feed, no seed or contract-document edits, which keeps this ticket from colliding with M-19a, M-24, and MRQ-62.
