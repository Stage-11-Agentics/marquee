-- MRQ-217: the D1-side after-write hook for the outbound mirror.
--
-- The application deliberately uses raw SQL and has many independent writers
-- (public forms, the portal, imports, task reconciliation, and admin routes).
-- A trigger is the one seam that cannot be forgotten when a new writer lands.
-- It only creates local outbox rows; the Airtable transport is job-only.
--
-- `__mirror_suppressed__` is a short-lived control row inserted inside the
-- reset:demo batch. It lets the atomic reseed write its thousands of rows
-- without creating thousands of mirror rows, while retaining the existing
-- mirror_state table and avoiding a new control table.

CREATE TRIGGER mirror_people_insert
AFTER INSERT ON people
WHEN EXISTS (
  SELECT 1 FROM mirror_state
   WHERE table_name = 'people'
     AND airtable_table_id IS NOT NULL
     AND length(trim(airtable_table_id)) > 0
)
AND NOT EXISTS (
  SELECT 1 FROM mirror_state WHERE table_name = '__mirror_suppressed__'
)
BEGIN
  INSERT INTO mirror_outbox
    (id, table_name, row_id, op, payload, status, attempts, last_error,
     drained_at, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), 'people', NEW.id, 'upsert',
     json_object('marquee_id', NEW.id, 'org_id', NEW.org_id,
                 'last_write_source', NEW.last_write_source),
     'queued', 0, NULL, NULL, NEW.created_at, NEW.updated_at);
END;

CREATE TRIGGER mirror_people_update
AFTER UPDATE ON people
WHEN NEW.last_write_source = 'marquee'
AND EXISTS (
  SELECT 1 FROM mirror_state
   WHERE table_name = 'people'
     AND airtable_table_id IS NOT NULL
     AND length(trim(airtable_table_id)) > 0
)
AND NOT EXISTS (
  SELECT 1 FROM mirror_state WHERE table_name = '__mirror_suppressed__'
)
BEGIN
  INSERT INTO mirror_outbox
    (id, table_name, row_id, op, payload, status, attempts, last_error,
     drained_at, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), 'people', NEW.id, 'upsert',
     json_object('marquee_id', NEW.id, 'org_id', NEW.org_id,
                 'last_write_source', NEW.last_write_source),
     'queued', 0, NULL, NULL, NEW.created_at, NEW.updated_at);
END;

CREATE TRIGGER mirror_people_delete
AFTER DELETE ON people
WHEN EXISTS (
  SELECT 1 FROM mirror_state
   WHERE table_name = 'people'
     AND airtable_table_id IS NOT NULL
     AND length(trim(airtable_table_id)) > 0
)
AND NOT EXISTS (
  SELECT 1 FROM mirror_state WHERE table_name = '__mirror_suppressed__'
)
BEGIN
  INSERT INTO mirror_outbox
    (id, table_name, row_id, op, payload, status, attempts, last_error,
     drained_at, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), 'people', OLD.id, 'delete',
     json_object('marquee_id', OLD.id, 'org_id', OLD.org_id,
                 'last_write_source', OLD.last_write_source),
     'queued', 0, NULL, NULL, OLD.created_at, OLD.updated_at);
END;

CREATE TRIGGER mirror_speaker_tasks_insert
AFTER INSERT ON speaker_tasks
WHEN EXISTS (
  SELECT 1 FROM mirror_state
   WHERE table_name = 'speaker_tasks'
     AND airtable_table_id IS NOT NULL
     AND length(trim(airtable_table_id)) > 0
)
AND NOT EXISTS (
  SELECT 1 FROM mirror_state WHERE table_name = '__mirror_suppressed__'
)
BEGIN
  INSERT INTO mirror_outbox
    (id, table_name, row_id, op, payload, status, attempts, last_error,
     drained_at, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), 'speaker_tasks', NEW.id, 'upsert',
     json_object('marquee_id', NEW.id, 'event_id', NEW.event_id,
                 'last_write_source', NEW.last_write_source),
     'queued', 0, NULL, NULL, NEW.created_at, NEW.updated_at);
END;

CREATE TRIGGER mirror_speaker_tasks_update
AFTER UPDATE ON speaker_tasks
WHEN NEW.last_write_source = 'marquee'
AND EXISTS (
  SELECT 1 FROM mirror_state
   WHERE table_name = 'speaker_tasks'
     AND airtable_table_id IS NOT NULL
     AND length(trim(airtable_table_id)) > 0
)
AND NOT EXISTS (
  SELECT 1 FROM mirror_state WHERE table_name = '__mirror_suppressed__'
)
BEGIN
  INSERT INTO mirror_outbox
    (id, table_name, row_id, op, payload, status, attempts, last_error,
     drained_at, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), 'speaker_tasks', NEW.id, 'upsert',
     json_object('marquee_id', NEW.id, 'event_id', NEW.event_id,
                 'last_write_source', NEW.last_write_source),
     'queued', 0, NULL, NULL, NEW.created_at, NEW.updated_at);
END;

CREATE TRIGGER mirror_speaker_tasks_delete
AFTER DELETE ON speaker_tasks
WHEN EXISTS (
  SELECT 1 FROM mirror_state
   WHERE table_name = 'speaker_tasks'
     AND airtable_table_id IS NOT NULL
     AND length(trim(airtable_table_id)) > 0
)
AND NOT EXISTS (
  SELECT 1 FROM mirror_state WHERE table_name = '__mirror_suppressed__'
)
BEGIN
  INSERT INTO mirror_outbox
    (id, table_name, row_id, op, payload, status, attempts, last_error,
     drained_at, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), 'speaker_tasks', OLD.id, 'delete',
     json_object('marquee_id', OLD.id, 'event_id', OLD.event_id,
                 'last_write_source', OLD.last_write_source),
     'queued', 0, NULL, NULL, OLD.created_at, OLD.updated_at);
END;

CREATE TRIGGER mirror_submissions_insert
AFTER INSERT ON submissions
WHEN EXISTS (
  SELECT 1 FROM mirror_state
   WHERE table_name = 'submissions'
     AND airtable_table_id IS NOT NULL
     AND length(trim(airtable_table_id)) > 0
)
AND NOT EXISTS (
  SELECT 1 FROM mirror_state WHERE table_name = '__mirror_suppressed__'
)
BEGIN
  INSERT INTO mirror_outbox
    (id, table_name, row_id, op, payload, status, attempts, last_error,
     drained_at, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), 'submissions', NEW.id, 'upsert',
     json_object('marquee_id', NEW.id, 'event_id', NEW.event_id,
                 'last_write_source', NEW.last_write_source),
     'queued', 0, NULL, NULL, NEW.created_at, NEW.updated_at);
END;

CREATE TRIGGER mirror_submissions_update
AFTER UPDATE ON submissions
WHEN NEW.last_write_source = 'marquee'
AND EXISTS (
  SELECT 1 FROM mirror_state
   WHERE table_name = 'submissions'
     AND airtable_table_id IS NOT NULL
     AND length(trim(airtable_table_id)) > 0
)
AND NOT EXISTS (
  SELECT 1 FROM mirror_state WHERE table_name = '__mirror_suppressed__'
)
BEGIN
  INSERT INTO mirror_outbox
    (id, table_name, row_id, op, payload, status, attempts, last_error,
     drained_at, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), 'submissions', NEW.id, 'upsert',
     json_object('marquee_id', NEW.id, 'event_id', NEW.event_id,
                 'last_write_source', NEW.last_write_source),
     'queued', 0, NULL, NULL, NEW.created_at, NEW.updated_at);
END;

CREATE TRIGGER mirror_submissions_delete
AFTER DELETE ON submissions
WHEN EXISTS (
  SELECT 1 FROM mirror_state
   WHERE table_name = 'submissions'
     AND airtable_table_id IS NOT NULL
     AND length(trim(airtable_table_id)) > 0
)
AND NOT EXISTS (
  SELECT 1 FROM mirror_state WHERE table_name = '__mirror_suppressed__'
)
BEGIN
  INSERT INTO mirror_outbox
    (id, table_name, row_id, op, payload, status, attempts, last_error,
     drained_at, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), 'submissions', OLD.id, 'delete',
     json_object('marquee_id', OLD.id, 'event_id', OLD.event_id,
                 'last_write_source', OLD.last_write_source),
     'queued', 0, NULL, NULL, OLD.created_at, OLD.updated_at);
END;
