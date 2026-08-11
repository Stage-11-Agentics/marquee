# MRQ-36: The marquee CLI and the shipped SKILL.md

BUILDPLAN: M-38 (rank 19, US-69) + M-39 (rank 20, US-70) — Wave 2 (§5) · MERGED at mint (5 h + 4 h = 9 h; M-39 depends only on M-38, same `cli/` + `SKILL.md` surface, and **both back the same gate**)

🔒 **GATE-BACKING — NEVER IN THE CUT BAND.** Both halves back `EVALUATION.md` gate 12 (`check:skill-agent`). A gate is unconditional; this ticket is built ahead of the band, out of rank order, and may not appear in gate 19's cut list at any pressure.

**M-38 — `marquee` CLI** (5 h, ACs AC-138 – AC-141, AC-250 CLI half, dep M-29)
Scope (verbatim): six commands, clean JSON stdout, token/url targeting, complete help; `remind --filter (--template <key> | --subject <s> --body <b>)` against M-35's `POST /comms/send`.
Registry (SPEC §4.3): `event seed|show`, `submissions list|show`, `submissions accept|reject --filter`, `tasks list --overdue`, `remind --filter (…)`, `agenda export`. Every command takes `--json` (parseable stdout, **logs to stderr**, AC-139), `--url`, `--token` (AC-140). `--help` enumerates the registry exactly (AC-141).

**M-39 — `SKILL.md` + clean-agent oracle** (4 h, ACs AC-142 – AC-145, dep M-38)
Scope (verbatim): workflow headings, commands resolve, vocabulary, API-only operation.
AC-142 headings: seed, triage, chase, agenda, publish. AC-144: the seven product terms present; the banned-synonym list (proposal, talk submission, CFP entry, panel review) absent.

ACs (union): AC-138 – AC-145, **AC-250** (CLI half)
Hours: 9 (5 + 4)
Workflow: sub-agent-full (≥7 h combined)
Shared files: `cli/` and `SKILL.md` are this ticket's; both **derive from the one route registry** — no hand-maintained command list.
Deps: M-29+M-54 (the token/docs half is what this rides on — see that ticket's sequencing note)
Oracle: AC-145 is settled by `oracle: check:skill-agent` — a clean headless agent given **only** `SKILL.md`, a base URL, and an API token completes seed → triage → accept → schedule, asserted over the API. Requires a model credential in CI (§8 item 9).
Plan: filled in by delegator's plan phase

## Delegator plan — MRQ-36

### Contract and anchor

- Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-36-cli`
- Branch: `mrq-36-cli`
- Base observed after `git fetch forgejo` and rebase: `forgejo/master @ 65aa56d678dcf6cddfdfd2df7f9242d7df61750d` (MRQ-30 scoped-token seam merged before implementation)
- Actor: `agent:delegator-mrq-36`
- Scope: M-38 + M-39, AC-138–AC-145 and AC-250's CLI half. No contract-document edits and no new AC IDs.
- Dependency posture: the CLI targets the bearer-token API contract being delivered by M-29/MRQ-30. It will not add cookies, session exchange, a second credential format, or direct provider calls.

### Approach

1. Add a small, dependency-free Node CLI under `cli/` with one declarative command registry. The registry owns command names, one-line help, option parsing, operation IDs, request paths, and output modes. `marquee --help` and each nested help view render from that registry so the help surface cannot drift from the executable.
2. Implement a single HTTP client: normalize `--url`, require a scoped `--token` (with environment defaults only as a convenience), send `Authorization: Bearer <token>` and JSON, never send or accept a session cookie, keep stdout reserved for the selected result, and send diagnostics/API failures to stderr with a non-zero exit.
3. Implement the contract commands:
   - `event seed` calls the API's queue-backed demo-seed/reset operation and resolves the resulting seeded conference ID through the authenticated API response; `event show` reads the event settings resource.
   - `submissions list` and `submissions show` use the shared list/query and record routes; list filters are typed allowlisted query keys.
   - `submissions accept|reject --filter` sends the server-side filter selector to the one bulk-decision route; it never materializes a page of IDs in the client.
   - `tasks list --overdue` reads the event's onboarding/chase projection with the overdue filter.
   - `remind --filter` maps the same allowlisted submission selectors to `POST /comms/send`; enforce exactly one of `--template` or the pair `--subject`/`--body` before making a request, preserving explicit empty selections as a no-op selector.
   - `agenda export` reads the agenda snapshot and emits stable JSON under `--json` and a documented tabular export otherwise, without pretending that export is a second agenda source.
4. Keep the CLI/API/SKILL registry seam explicit. Generate the checked registry artifact from the canonical OpenAPI output used by `check:api`, and make the SKILL command examples derive from the same CLI command metadata. `check:api` must pass once `cli/` exists, including current operation signatures and document digest; no hand-maintained route list will be introduced.
5. Add the public root `SKILL.md` as a short, timeless operating guide with the required `seed`, `triage`, `chase`, `agenda`, and `publish` headings. It will name concrete CLI/API calls, use the product terms Abstract, Session, Evaluation plan, Committee, Portal, Task, and Agenda, and contain no internal orchestration context, secrets, session-cookie instructions, or banned vocabulary.

### Verification

- Add AC-tagged hermetic Node tests under `tests/node/` covering help registry/subcommand help (AC-141), clean JSON and stderr behavior (AC-139), URL/token targeting and bearer-only requests (AC-140), every workflow and filter/body mapping (AC-138), ad-hoc and templated reminder behavior (AC-250), and SKILL headings, vocabulary, command/API resolution, and public hygiene (AC-142–AC-144).
- Add `tests/ac-claims/MRQ-36.json` with unique ownership for AC-138–AC-144 and AC-250; document AC-145 as the clean-agent oracle exercised by the gate, not as a falsely claimed local auto test.
- Run baseline and changed `npm test`; run `npm run check:api` after the registry exists; run `npm run trace:ac -- --scope=merged --ticket=MRQ-36`; run `npm run pr-gate -- --ticket MRQ-36` before the PR.
- For running-system proof, build and launch an isolated local `wrangler dev` with the repository's local runtime harness, use a scoped bearer token fixture/route contract, exercise seed → list/triage → accept → task/chase → schedule/export, and attach the observed command/API evidence. If the current dependency branch is not yet merged, record that exact dependency limitation rather than claiming token runtime proof from a session.

### Non-goals and guardrails

- Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `PHILOSOPHY.md`, `DESIGN.md`, or `sequence/USER_STORIES.md`.
- Do not add a parallel `/messages/send`, direct `api.resend.com` fetch, cookie/session auth path, LLM feature, or ad hoc SQL/data access in the CLI.
- Do not alter the shared route-manifest convention, list contract, bulk writer, `recipientsFor` empty-selection semantics, or mail `always_live` call-site count.
- README ownership remains with MRQ-40. The PR body will state exactly: “The CLI is `node cli/marquee.mjs` (or the installed `marquee` bin), uses a scoped bearer token, accepts `--url` and `--token`, and supports the command registry shown by `marquee --help`; it works against a local `wrangler dev` and remote self-hosted Marquee instances.”

### Plan self-review — PASS

- Scope is limited to `cli/`, `SKILL.md`, CLI/SKILL tests, claims, and the minimum check/registry plumbing required to activate the existing parity gate.
- Authentication is explicitly bearer-only and dependency-compatible; no session cookie or secret is written to the public tree.
- Bulk decisions and reminders preserve server-side filtering and the existing empty-selection no-op rule.
- The plan distinguishes hermetic proof, live local proof, and the later clean-agent oracle; it does not claim that green unit tests equal gate 12.
