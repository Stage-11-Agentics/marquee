-- MRQ-207 — the organization becomes a record.
--
-- The organization is the thing that outlives every conference, so the defaults
-- a new conference inherits
-- (timezone, appearance, the voice mail speaks in, the mark it wears) belong on
-- `organizations` rather than being re-typed per event. Everything here is
-- nullable: an organization that has expressed no preference must be
-- distinguishable from one that chose the value a default would have supplied,
-- because only the first should follow the product when the product changes its
-- mind.
--
-- The invite half of this ticket lives in 0020, deliberately: 0018 REBUILDS
-- `magic_links`, and a column added here would be copied away by that rebuild
-- without a single error — the silent kind of loss. See the note there.

ALTER TABLE organizations ADD COLUMN default_timezone TEXT;
ALTER TABLE organizations ADD COLUMN default_theme TEXT;
ALTER TABLE organizations ADD COLUMN comms_from_name TEXT;
ALTER TABLE organizations ADD COLUMN comms_reply_to TEXT;
ALTER TABLE organizations ADD COLUMN logo_key TEXT;
ALTER TABLE organizations ADD COLUMN accent TEXT;
