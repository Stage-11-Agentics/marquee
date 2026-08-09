# MRQ-49: Audit — public write surface and upload safety

BUILDPLAN: A-7 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): Public write surface — Turnstile gating set, upload extension/MIME/magic-byte/caps/serving origin.
Starts when (verbatim): After M-13/M-14.

**A-7 has ACs behind it: AC-231 and AC-232.** The gated set is draft creation, submit, and every presign; `PATCH …/drafts/:token` autosave requires no Turnstile token but is rejected without a valid resume token and is rate-limited per token. Uploads: disallowed extension and disallowed MIME each refused independently; magic-byte contradiction rejected **and the R2 object deleted** (HEAD 404); per-IP and per-submission caps each 429; served uploads carry `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` from a host that is **not** the app host.

ACs: **AC-231, AC-232** (audit evidence; the tests are M-13's and M-14's)
Hours: 2
Workflow: fast-track
Shared files: none — audit artifact only.
Deps: M-13, M-14
Plan: filled in by delegator's plan phase
