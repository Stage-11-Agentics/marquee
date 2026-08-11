# MRQ-67: Task cancellation and the idempotent acceptance reconciliation

M-62. Owns AC-264 – AC-267. Depends on M-61 (migration) and touches M-33 (un-accept cascade), M-15 (portal), M-23 (chase board).

WHY THIS EXISTS: AC-123 already graded the un-accept dialog's cancel/retain choice and the v1.7 prototype already drew the control, while speaker_tasks.status shipped as open|done with no third value. Worse, AC-125 puts 'task overdue' in the minimum automated-trigger set — so an open task on a cancelled talk keeps mailing a real speaker about a talk that no longer exists.

TWO FUNCTIONS:
1. cancelTaskSet(submission, reason) — stamp cancelled_at on every OPEN task. Never touch completed_at. Never DELETE: the tombstone IS what 'retained for records' means.
2. reconcileTaskSet(submission) — ONE idempotent operation called by EVERY acceptance path (first accept, re-accept after reversal, accept after the template set changed). For each template in the assigned set: restore the existing row (clear cancelled_at, preserve due_at) if it exists, create it if it does not. Restoration must NOT be a separate branch, and calling it twice must change nothing. AC-266 is verified by call-site enumeration, not behaviour alone.

CONVERT EVERY READER to owes = neither done nor cancelled: portal active list + progress denominator, all four chase-board metric buttons, all four filter-chip counts, the task-type filter, severity ordering, overdue totals, the task-overdue trigger, and the comms recipient selector. A speaker holding a SECOND accepted session keeps their chase row — they still owe that session's work.

PORTAL (AC-265): cancelled tasks leave the active list and the count, rendered under a dashed divider as 'Cancelled · N' with the reason stated ONCE at submission level, not per row. A cancelled row carries no action button; one already completed says its work is kept.

DIALOG RELABEL (client ruling 2026-08-10): 'Cancel open tasks' / 'Keep tasks active' — NOT 'Retain for records', which described what cancelling already did. The two branches must produce observably different states (AC-267), and both plus any restoration write audit_log rows surfaced in record history.

Binding prototype: prototypes/pipeline-v1.1/index.html at v1.8 — drive it. 4 agent-hours.
