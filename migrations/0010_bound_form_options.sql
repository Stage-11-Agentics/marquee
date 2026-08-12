-- MRQ-126 — bind the seeded format/track fields to Conference settings.
--
-- These two fields shipped with a hand-typed copy of the option list. The
-- submit path resolves an answer under `format` / `tracks` back to a row in
-- the formats / tracks tables BY NAME, so the copy and the tables drift apart
-- the moment an organizer renames a format in Conference settings: the
-- dropdown keeps offering the old name and the submit is refused by a list
-- that visibly contains the choice.
--
-- Binding is therefore not new behaviour for these keys — it makes the field
-- agree with the resolution the server already performs on them. `options` is
-- removed rather than kept alongside `source`, because a retained copy is
-- exactly the snapshot that outlives the next rename. Other config keys
-- (tracks' minItems) survive untouched.

UPDATE form_fields
SET config = json_set(json_remove(config, '$.options'), '$.source', 'formats'),
    updated_at = updated_at + 1
WHERE key = 'format'
  AND type = 'single_select'
  AND json_extract(config, '$.source') IS NULL;

UPDATE form_fields
SET config = json_set(json_remove(config, '$.options'), '$.source', 'tracks'),
    updated_at = updated_at + 1
WHERE key = 'tracks'
  AND type = 'multi_select'
  AND json_extract(config, '$.source') IS NULL;
