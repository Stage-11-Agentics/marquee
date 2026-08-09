# MRQ-27: Airtable mirror — inbound

BUILDPLAN: M-26 — Tier B rank 8 (US-72), Wave 2 (§5) · the protected moat block

Scope (verbatim): signed webhook ping/payload pull, allowlist, echo suppression, keepalive/expiry; **an inbound status change sets status + `last_write_source='airtable'` and does *not* run the acceptance cascade** — the record surfaces "changed in Airtable · cascade not run" with a one-click "run onboarding cascade" for a program lead (SPEC §3.9).

Architecture (§1): a webhook ping triggers a cursor'd payload pull that applies an allowlisted field set back into D1, with `last_write_source` breaking echo loops and a daily keepalive cron beating the **7-day webhook expiry** (trap 7). Webhooks are **not data-carrying**; the payload pull spends the same 5 req/s budget; delivery is at-least-once with up to 13 retries over a day.

ACs: **AC-226, AC-227, AC-229**
Hours: 5
Workflow: sub-agent-full (named in the mint brief: mirror)
Shared files: none — module-local under `src/jobs/mirror/*`; same import-boundary rule as M-25 (A-4).
Deps: M-25, S-1 (the spike proves the ping → list-payloads → cursor → apply loop and that echo suppression holds when our own outbound write bounces back)
Note: AC-226 requires a publicly reachable webhook, so it runs against a deployed preview, never locally. AC-229's 7-day duration is proven by *refresh-advances-expiry*, not by waiting seven days.
Plan: filled in by delegator's plan phase
