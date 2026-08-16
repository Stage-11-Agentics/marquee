# MRQ-243 implementation plan

## Outcome

Give an agent, judge, organizer, or contributor one truthful machine-facing entry
point at a Marquee deployment. `/llms.txt` will explain the product and the
walkable conference loop; `/llms-full.txt` will carry the deliberately served
documentation; every advertised door will be checked against the in-process
Worker; and generated facts will fail closed when their sources drift.

The implementation is scoped to the requested front door: generated markdown,
the deliberate served-document allowlist, local latency evidence, the three
human-facing cross-links, route reachability, and the staleness gate. It does
not add data-model work, authentication, content negotiation, a Worker
`robots.txt` shadow, deployment, publication, or browser/live evidence.

## Contract and allocation boundary

The ticket contains exactly six unminted draft acceptance criteria. This plan
implements those six criteria in ticket order without assigning US/AC numbers,
folding the contract, or editing `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`,
`USER_STORIES.md`, or `DESIGN.md`:

- `/llms.txt` is a 200 `text/markdown` response containing the contract, ordered
  loop, machine index, environment-labelled speed, honest limits, and the
  landing/agents/API-doc doors; every URL it advertises resolves to 200 in the
  in-process link test.
- Fact inserts (operation count, CLI count, OpenAPI digest, latency figures, and
  links) are derived from their source artifacts; editing generated output by
  hand fails `check:docs` and prints its `--write` remedy.
- `check:docs` is itself exercised by a Node test discovered by `npm test`, so
  the fast-gate path reaches the new check.
- The manifest's README, getting-started guide, philosophy, design, and deploy
  documents are served byte-for-byte after their self-locating canonical header;
  manifest-to-served and served-to-manifest parity both fail on drift or orphans,
  while SPEC/EVALUATION remain repo-only.
- Every new Worker-first path is declared in `wrangler.jsonc` and asserted by a
  test, including the named assets-shadow failure mode.
- `measure-latency.mjs` accepts an arbitrary deployment URL, computes TTFB
  medians for the public surfaces, emits a truthful environment label, and
  supplies the committed local-Wrangler numbers consumed by the generator.

The low-stakes robots decision is closed in the considered default direction:
Cloudflare zone-managed `robots.txt` remains unchanged, with no Worker shadow
route. The decision is recorded in the front-door source/check documentation;
it is not treated as a deployment claim.

## Implementation phases

1. Commit this plan first from the requested worktree, push `mrq-243-front-door`,
   fetch the remote branch, and verify local `HEAD` equals
   `github/mrq-243-front-door`. Keep the authoritative copy at the absolute
   Lattice path and the committed branch copy byte-identical.
2. Add the source-of-truth front-door manifest and authored `/llms.txt` template.
   Use Vite `?raw` imports for the five deliberately allowed markdown documents
   and `SKILL.md`; prepend a canonical source comment only in the served wrapper
   so the source body remains the comparison baseline. Generate `/llms.txt` and
   `/llms-full.txt` with a banner naming the template, manifest, CLI registry,
   OpenAPI source, latency evidence, and generator. Keep link lists derived from
   the same manifest/constants used by the route map.
3. Add the Worker front-door route module and mount it before the asset fallback:
   `/llms.txt`, `/llms-full.txt`, and each manifest `.md` URL return stable
   `text/markdown; charset=utf-8`. Add all new paths to `run_worker_first` and
   keep the existing `not_found_handling: "none"` behavior. Do not add a
   `robots.txt` route.
4. Add the generated-docs/check pipeline. `check:docs` will regenerate in a
   temporary/in-memory comparison, byte-compare tracked generated outputs, and
   print `npm run check:docs -- --write` on missing or drifted output. Its report
   will prove generated source banners, manifest parity in both directions,
   canonical-header stripping, and the repo-only exclusion of SPEC/EVALUATION.
   Add a Node test that shells out to the package script and exercises a copied
   generated file/template mutation without mutating the checkout.
5. Add the in-process Worker link-resolution test following `check-api.mjs`:
   build/load `dist/marquee/index.js`, fetch every absolute/relative URL emitted
   by `/llms.txt`, and fail on any non-200 or incorrect markdown content type.
   Supply only hermetic bindings/fixtures needed for the public agents page;
   no external site, browser, or live deployment is used.
6. Add `scripts/measure-latency.mjs` with URL, run-count, path, timeout, and
   write/output options. Measure TTFB from headers/body completion using a
   monotonic clock, report status and medians per path, reject unusable URLs,
   and label measurements as `local-wrangler-dev` or caller-provided
   environment. Generate the checked-in local evidence through the script; the
   docs generator reads it and never embeds a hand-entered number. Do not run it
   against production in this ticket.
7. Add the doors: landing footer links to `/llms.txt`; the public
   `/agenda/agents` page points to `/llms.txt` and `/llms-full.txt`; the rendered
   `/api/docs` footer/header links back to the front door. Keep existing API
   digest/count facts generated from the live OpenAPI bundle and avoid widening
   `renderPublicDocument` for the explicitly deferred content negotiation.
8. Run targeted generator, parity, Node, TypeScript, and in-process Worker
   checks. Request a serialized full-gate slot from `merge-captain` before any
   full `pr-gate`/full suite; never claim a gate result without that slot. Do
   not spawn a reviewer: request the orchestrator's sole reviewer when the
   implementation is ready. Move the ticket only through `pr_open`; the
   Adoption Orchestrator owns review, merge, deploy, and publication.

## Verification and handoff

- Static evidence: generated-file/source parity, manifest two-way parity,
  `run_worker_first` coverage, robots decision, and generated fact provenance.
- Hermetic runtime evidence: in-process Worker responses for every advertised
  link and markdown response headers; local Worker/curl is allowed, but no
  browser, live-site write, external latency probe, deploy, or publication is
  claimed.
- Latency evidence: committed numbers carry the exact local environment label;
  post-deploy curl validation is a separate held item for the operator.
- At completion report to mailbox `adoption-orchestrator` at
  `workspace:10`, `surface:513`; raise a c11 flag only if operator action is
  required. Ask `merge-captain` for the serialized gate slot and ask the
  orchestrator for its sole review slot before entering `pr_open`.
