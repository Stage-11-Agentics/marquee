# Marquee check harness

## The local PR gate

Run this after rebasing and immediately before pushing/opening a PR:

```sh
npm run pr-gate -- --ticket MRQ-N
```

Private Forgejo has no CI runner. This command is the merge evidence: Worker/client/test type checks, the production build, design-contract verification, `npm test`, and merged-scope AC tracing. The public GitHub workflow mirrors those fast checks but is not evidence for a private Forgejo PR.

## Public assembly

Build the publishable tree from an explicit ref. The assembler copies only the
allowlisted product roots, relocates the public seed fixture, scrubs private
deployment metadata, and can write a parentless commit into the local object
database without moving a branch:

```sh
PUBLIC_STAGE="$(mktemp -d)"
npm run assemble:public -- --repo "$PWD" --ref HEAD --output "$PUBLIC_STAGE" --commit
```

The JSON result contains the orphan commit and tree IDs. Review the tree, run
`npm run check:repo -- --repo "$PWD" --ref <commit>`, and update a ref only
after that review with the explicit `--update-ref` option. The exact denied
path inventory is exported by `scripts/checks/assemble-public.mjs`; the
history checker independently walks both the current tree and full commit
path history.

## Stable command surface

These thirteen package-script names are immutable: `test`, `e2e`, `check:speed`, `check:seed`, `check:api`, `check:repo`, `check:readme`, `trace:ac`, `check:mirror`, `reset:demo`, `smoke:mail`, `smoke:ics`, and `check:skill-agent`. Later owners replace the file behind a stub; they do not rename or re-register its package script.

Scaffold stubs write `status: "stub"` reports and exit zero for ordinary development. With `MARQUEE_GATE=1`, every stub exits non-zero so a terminal gate cannot confuse registration with proof. Stubs never contact a service or imply that a missing capability passed.

## Fast and slow suites

`npm test` is hermetic, parallel, and hard-stopped before 30 seconds. It uses small deterministic fixtures and local Workers bindings. Outbound `fetch` is denied. It never uses a deployed URL, real Resend/Airtable/R2, the 1,000-row seed, Playwright, a container/history scan, inbox/calendar clients, or an agent runner.

Those responsibilities stay in separately invoked commands: deployed journeys in `e2e`; performance in `check:speed`; scale in `check:seed`; external mirrors and oracles in their named checks. A slow default suite is a harness defect, not a reason to raise the ceiling.

## Test titles and AC claims

Product tests begin with one or more IDs, for example `AC-25 + AC-231 · rejects a crafted write`. Harness/design-contract tests with no product AC begin `CONTRACT · `. Dynamic titles and any other prefix fail `trace:ac`.

Each implementation ticket adds `tests/ac-claims/MRQ-N.json`:

```json
{
  "ticket": "MRQ-N",
  "owns": ["AC-25"],
  "exercises": ["AC-231"]
}
```

`owns` is unique across manifests. `exercises` records non-owning cross-coverage. `--scope=merged` enforces auto-tagged ACs named by present claim manifests; a missing current-ticket manifest is a loud warning until CP-2. `--scope=all` enforces every live auto criterion and rejects struck AC-239.

## Shared UI boundary

`src/styles/tokens.css` owns the global Flight Deck tokens. `src/styles/components.css` owns shell and shared primitive geometry. Feature tickets keep module-specific CSS with their modules and consume the shared variables; they do not add a parallel token layer.

`check:repo` intentionally requires explicit `--repo` and `--ref` publish targets and scans their full history. Do not point it at the known internal working history and weaken its failures; the publish-assembly ticket supplies the clean orphan target.
