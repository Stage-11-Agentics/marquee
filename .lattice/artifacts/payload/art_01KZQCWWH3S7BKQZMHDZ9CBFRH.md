Verdict: PASS

Reviewed commit: 99bd014da6a491d5047231a86c7a16e2191b37d1
Base: forgejo/master @ 1e23eaaf72d000444b27ccac8827ad87e935a68d
Mode: inline self-review; headless code review suspended by ticket.

Scope reviewed:
- additive access_note migration and schema mirror
- deterministic Sheraton/Marriott/Online seed, AV/room notes, and live Transit check
- geometry helper, authenticated venue GET/PUT, and atomic shared writer
- /settings/venues map/editor, /settings link, route registration, and scheduler Room · Building display
- client-safe type boundary after the validation rework
- AC claims and AC-tagged tests

Findings: none.

Checks inspected: git diff --check PASS; no forbidden 2025 venue names in scripts/src/tests; route module uses *.routes.ts; prototype intentionally unchanged per operator ruling.