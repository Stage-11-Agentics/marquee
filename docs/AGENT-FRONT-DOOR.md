# Agent front door

MRQ-243 serves a small, deliberate machine-readable front door from the Worker:
`/llms.txt` is the generated orientation index and `/llms-full.txt` is the generated
bundle. The document routes are selected by `src/agent-front-door/manifest.json`;
the manifest intentionally excludes `SPEC.md` and `EVALUATION.md`, which remain
repository-only contract artifacts.

The generated files are facts, not a second source of truth. `check:docs` builds the
Worker and derives the OpenAPI operation count and digest from the in-process served
response. It derives CLI counts from `cli/registry.mjs`, and local latency evidence
comes only from `scripts/measure-latency.mjs`. Measurements are labeled with their
local environment and never presented as deployed performance.

The low-stakes robots decision is deliberate: `robots.txt` remains Cloudflare
zone-managed. Marquee does not add a Worker shadow route for it. Any future change to
that ownership decision belongs in an explicit operator-approved ticket.
