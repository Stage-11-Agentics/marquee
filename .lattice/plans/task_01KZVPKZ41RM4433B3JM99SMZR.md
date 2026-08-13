# MRQ-135: The publication confirmation gate cannot be read: every field clips to one or two characters

SURFACE: /agenda-builder -> select sessions -> 'Review publication' step.

WHAT BREAKS: The review step says 'About to publish N Sessions. Review the exact public fields below. Nothing is visible until you confirm.' Every session row beneath renders clipped to 1-2 characters ('A...' / 'Mo...' / 'Ni...'). The organizer cannot read the title, time, room or speaker that the gate exists to let them verify. The gate still claims it is serving them.

ROOT CAUSE (confirmed by reading live source at 75b871d94c6f):
- src/ui/agenda/agenda.css:15 -> .agenda-publication-candidate { display: grid; grid-template-columns: 20px minmax(0, 1fr); }
- src/ui/agenda/AgendaPage.tsx:502 -> the checkbox is rendered only when NOT in review mode: {!review && <input type=checkbox .../>}
- Therefore in review mode the copy <div> becomes the FIRST grid child and lands in the 20px column.
- src/ui/agenda/agenda.css:18-19 -> that copy has overflow:hidden; text-overflow:ellipsis; white-space:nowrap, so it ellipsises at ~1-2 characters.

FIX SHAPE: in review mode either render a placeholder first cell, set grid-column: 1 / -1 on the copy, or switch grid-template-columns to a single minmax(0,1fr) column. One-line CSS/markup change.

WHY URGENT: This defeats a confirmation step on the publish path -- the product's own 'whole loop or nothing' promise -- and a judge publishing sessions walks straight through it. Cheapest high-value fix on the board.

SIZE: small. No dependency.

PROVENANCE: sbek run 2026-08-12T15-33-34, ai-agenda judgement, defects[2]. Validated against live build 75b871d94c6f.
