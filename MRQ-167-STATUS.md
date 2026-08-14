# MRQ-167 checkpoint

Pushed head: `52bc70c52ca3`.

Implemented both review fixes. Updated rows now record the effective imported
values, so undo restores a field only while it still equals that imported
value; a field changed to a third value is retained and reported as a human
correction. The reference audit covers every direct foreign key to `people`,
including `person_events` and `person_list_members`.

I chose per-row isolation inside the single D1 batch. A referenced created row
is skipped with its reason, while unreferenced siblings still undo; the receipt
and result report the partial outcome truthfully instead of allowing one FK
violation to abort the import.

Verification: the focused Vitest regression suite is 4/4 passing after the fix
(the two new regression cases failed before the fix), TypeScript, API/schema
checks, diff validation, and targeted AC tracing pass. A local Worker on port
8895 served build `fb2e46c287b5`; root `/health` matched that 12-character
build, organizer login and `/people` rendered in the c11 browser, and the
browser completed both runtime probes. For an updated person, import → browser
PATCH correction → Undo displayed `1 restored · 1 kept` and
`name kept — changed after the import`; a browser GET confirmed the correction
survived. For two created people, a browser-added note made one referenced;
Undo displayed `1 restored · 1 kept` and `still referenced by person_events`,
then the kept person returned 200 with its note while the unreferenced sibling
returned 404. The locked gate re-run passed at 108,581 ms against the 120,000
ms budget; its 1,111-test suite passed at 53,507 ms and was reported
`pass-over-budget`. No merge or deployment has been performed.
