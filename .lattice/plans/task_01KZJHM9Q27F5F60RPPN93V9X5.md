# MRQ-25: Calendar invites and the un-accept cascade

BUILDPLAN: M-24 (Tier B rank 2, US-47) + M-33 (Tier B rank 14, US-36) — Wave 2 (§5) · MERGED at mint (5 h + 5 h = 10 h, at the cap; same ICS module — M-33's calendar cancellation is literally M-24's `METHOD:CANCEL` path, and splitting them puts one `UID`/`SEQUENCE` lifecycle across two PRs. M-33's second dependency, M-19a, is a Wave 1 ticket and is green before this band opens.)

**M-24 — Calendar invites** *(written against S-2's verdict, which returned at D+2)* (5 h, ACs AC-95 – AC-97, deps M-11/S-2)
Scope (verbatim): ICS builder (`METHOD:REQUEST`, `ATTENDEE;RSVP=TRUE`, stable `UID`, `SEQUENCE`, `DTSTAMP`, `VTIMEZONE`+`TZID`, CRLF folding), `multipart/alternative` calendar part, `METHOD:CANCEL`, Add-to-Google and Add-to-Outlook links, `/i/{uid}.ics`, single-send path at ≤10/s.
Trap 14: the Resend **batch endpoint carries no attachments** — anything with an ICS goes single-send at ≤10/s. Both paths exist from M-11's first commit.
Amendment 11 fold (SPEC.md): ICS `LOCATION` renders "Room · Building" (AC-252).

**M-33 — Un-accept cascade** (5 h, ACs AC-121 – AC-124, deps M-24/M-19a)
Scope (verbatim): attributed reversal; agenda/public removal; dependent tasks/mail/invites choices; calendar cancellation.
AC-123: the reversal dialog enumerates portal tasks, scheduled emails, and calendar invites, each with cancel/retain, and honours the choice.

ACs (union): AC-95 – AC-97, AC-121 – AC-124 · **AC-252** (ICS `LOCATION`)
Hours: 10 (5 + 5)
Workflow: sub-agent-full (≥7 h combined)
Shared files: none — module-local ICS/cascade modules.
Deps: M-11, S-2, M-19a
Oracle: AC-95, AC-97, and AC-124 are settled by `oracle: smoke:ics` — Gmail (mandatory), Outlook, Apple Calendar must show Accept/Decline, a `SEQUENCE+1` must **replace** rather than duplicate, and a `CANCEL` must remove. Golden-file `test:` assertions run every build regardless.
Plan: filled in by delegator's plan phase
