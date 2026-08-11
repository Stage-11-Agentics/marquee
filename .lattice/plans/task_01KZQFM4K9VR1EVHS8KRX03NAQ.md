# MRQ-68: Decided · not notified — the built-in view and the attention row

M-63. Owns AC-268 and AC-269. Depends on M-52 (decision rows) and M-11.

ZERO SCHEMA — fully derived from submission_decisions left-joined to outbox.

THE GAP: PHILOSOPHY 2 makes the status change BE the notification, which beats the incumbent. The honest corollary is that the automatic send has exactly THREE designed-in ways not to arrive, and all three are correct: (a) the Airtable mirror deliberately does not run the cascade (AC-226), (b) an outbox row sits queued/suppressed/failed, (c) the record carries no usable address so nothing could be queued. None had a screen.

BUILD:
1. Immutable built-in view 'Decided · not notified' over the submissions list. The Notified column must state WHICH reason applies per record — 'Changed in Airtable' / 'Not delivered' / 'No valid address'. 'Not notified' with no reason is just a second thing to worry about.
2. Fourth attention-strip row on /dashboard carrying the count, linking into the view. At zero it STATES that every decision has reached its speaker — it must not disappear. A row that vanishes when healthy cannot be trusted when it appears.
3. 'Notify N speakers' head action: writes a NEW outbox row against the EXISTING decision row and never rewrites the decision (assert decision, decided_at, decided_by_person_id and feedback_md byte-identical afterwards). No-address records are excluded from BOTH the action and its count, and the sentence says how many need an address first.

Binding prototype: prototypes/pipeline-v1.1/index.html at v1.8. 2 agent-hours.
