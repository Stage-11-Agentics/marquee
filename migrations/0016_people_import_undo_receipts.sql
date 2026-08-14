-- MRQ-167 — an updated-row undo must know both sides of the import.
--
-- before_json is the durable pre-import snapshot. after_json records the
-- effective values written by the import (including the old value for blank
-- CSV cells), so undo can restore only fields that still hold the import's
-- value and leave later human corrections alone.
ALTER TABLE import_rows ADD COLUMN after_json TEXT
  CHECK (after_json IS NULL OR json_valid(after_json));
