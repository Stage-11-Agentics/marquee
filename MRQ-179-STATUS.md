# MRQ-179 status

- Done: `readAgendaPublication` explicitly filters `submission.kind = 'session'`; the agenda fixture now distinguishes Sessions from abstracts; and `CONTRACT · MRQ-179 · accepted abstracts are not publication candidates` proves an accepted abstract is absent while the real session candidate count remains unchanged.
- Decision: keep the kind predicate in the publication query because the new submission-rooted LEFT JOIN no longer inherits the old agenda-item join's implicit Session-only filter.
- Browser verification: not performed. No running Worker/browser result was collected for this change.
