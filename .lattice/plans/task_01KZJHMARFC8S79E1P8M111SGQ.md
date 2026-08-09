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
