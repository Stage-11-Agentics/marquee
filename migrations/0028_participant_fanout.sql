-- Who a task template is for, and who a public submission says is presenting.
--
-- Two columns, one subject: the product understood that a submission carries
-- several people in several roles everywhere except the two places where that
-- knowledge does work — the task fan-out and the public form.
--
-- `applies_to_roles` is a JSON array of participation roles. "Upload your
-- slides" goes to everyone on stage; "Sign the speaker release" goes to whom
-- the organizer says. The default is the four on-stage roles, which is exactly
-- the population the fan-out already widened to, so an existing conference
-- keeps its current behaviour with no backfill and no organizer decision.
--
-- SQLite cannot add a CHECK to an existing table without rebuilding it, and a
-- rebuild of `task_templates` would relocate every speaker task's FK for a
-- constraint the writers already enforce. `readTaskAppliesToRoles` is the
-- narrowing read: an absent, malformed, or empty value reads as the default
-- rather than as "nobody", because a template that silently reaches no one is
-- the one failure an organizer cannot see.
ALTER TABLE task_templates
  ADD COLUMN applies_to_roles TEXT NOT NULL
  DEFAULT '["speaker","co_speaker","moderator","chairperson"]';

-- The participant roster a public submission was filled in with, including the
-- on-behalf-of disclosure, held on the submission so a resumed draft restores
-- the people the submitter had already named.
--
-- It is not `submission_answers`: those rows are keyed by `form_fields.id`, so
-- a repeatable list can only live there as a fixed pair of columns per slot —
-- which is precisely the `speaker_*` / `co_speaker_*` convention this replaces.
-- Participations remain the record; this is the intake material they are
-- reconciled from, and it stays readable afterwards so an organizer can see
-- what the submitter actually typed.
ALTER TABLE submissions ADD COLUMN participants_json TEXT;
