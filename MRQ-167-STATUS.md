# MRQ-167 checkpoint

Implemented both review fixes. Updated rows now record the effective imported
values, so undo restores a field only while it still equals that imported
value; a field changed to a third value is retained and reported as a human
correction. The reference audit covers every direct foreign key to `people`,
including `person_events` and `person_list_members`.

I chose per-row isolation inside the single D1 batch. A referenced created row
is skipped with its reason, while unreferenced siblings still undo; the receipt
and result report the partial outcome truthfully instead of allowing one FK
violation to abort the import.

Verification so far: the focused Vitest regression suite is 4/4 passing after
the fix (the two new regression cases failed before the fix), TypeScript,
API/schema checks, diff validation, and targeted AC tracing pass. A local
Worker on port 8895 served the current build, `/health` matched the 12-character
HEAD, organizer login and `/people` rendered in the c11 browser, and the
browser imported an existing-person CSV and applied a manual correction. The
undo request returned HTTP 200, but Wrangler then lost its proxy connection
before the browser could read the follow-up response; that first end-to-end
undo observation is therefore incomplete and is being re-run. No merge or
deployment has been performed.
