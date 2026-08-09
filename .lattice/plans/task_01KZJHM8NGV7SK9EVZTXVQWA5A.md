# MRQ-14: Uploads: presign, verify, and serve

BUILDPLAN: M-13 — Wave 1 (§4)

Scope (verbatim): `POST /uploads/sign` → presigned **PUT against `{account}.r2.cloudflarestorage.com`** (never a custom domain — trap 9), direct browser PUT with progress, `/complete` with HEAD verify + magic-byte sniff, Images variants for headshots, per-IP/per-submission caps in KV, nightly orphan sweep, separate-origin serving with `Content-Disposition: attachment`. **R2 canonical for media; Airtable only ever receives a public R2 URL (trap 10).** Turnstile is verified before a presign is issued; a magic-byte mismatch rejects **and deletes the object**.

Non-goal (EVALUATION §5): no malware scanning in this window — separate origin + `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`, documented as an extension point.

File surface: `src/routes/uploads.routes.ts`, `src/lib/r2/*`

ACs: AC-52, AC-146 – AC-148, **AC-231** (presign gate), **AC-232**
Hours: 5
Workflow: inline-full
Shared files: none — module-local.
Deps: M-01
Audit that keys off this ticket: A-7 (public write surface), after M-13/M-14
Plan: filled in by delegator's plan phase
