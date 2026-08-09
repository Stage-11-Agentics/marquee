# MRQ-54: Spike — Airtable inbound webhook loop

BUILDPLAN: S-1 — spike (§6). Time-boxed; **fails loudly rather than leaking into a feature build.**

Question it settles (verbatim): Does the ping→list-payloads→cursor→apply loop actually work against a real base, and does our echo suppression hold when our own outbound write bounces back? Webhooks are **not data-carrying**, the payload pull spends the same 5 req/s budget, and delivery is at-least-once with up to 13 retries over a day.

Box: 2 h. Blocks: **M-26**. When: early in the D+13 → D+36 band.
Deliverable: a written verdict (the loop's exact shape and the echo-suppression rule that held) recorded on this ticket before M-26 is planned. M-26 is written against the verdict, not the reverse.

ACs: — (de-risks AC-226, AC-227, AC-229)
Hours: 2
Workflow: fast-track
Shared files: none — throwaway spike code; nothing merges into `src/` from here.
Deps: none
Plan: filled in by delegator's plan phase
