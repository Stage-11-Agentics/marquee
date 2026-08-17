# Agent front door

MRQ-243 serves a small, deliberate machine-readable front door from the Worker:
`/llms.txt` is the generated orientation index and `/llms-full.txt` is the generated
bundle. The document routes are selected by `src/agent-front-door/manifest.json`;
the manifest intentionally excludes `SPEC.md` and `EVALUATION.md`, which remain
repository-only contract artifacts.

The generated files are facts, not a second source of truth. `npm run build` creates
the ignored front-door inputs, then builds the final Worker. `check:docs` derives the
OpenAPI operation count and digest from the in-process served response and compares
the resulting bytes. It derives CLI counts from `cli/registry.mjs`, and local latency
evidence comes only from `scripts/measure-latency.mjs`. Measurements are labeled with
their local environment and never presented as deployed performance.

The low-stakes robots decision is deliberate: `robots.txt` remains Cloudflare
zone-managed, including its `ai-train=no` and crawler `Disallow` directives. Marquee
does not add a Worker shadow route for it. Any future change to that ownership decision
belongs in an explicit operator-approved ticket.

Content negotiation (`Accept: text/markdown`) and `rel="alternate"` links on public HTML
remain deferred. The stable markdown doors are sufficient for the current agent path;
changing the public HTML renderer is a separate, explicitly approved seam.
