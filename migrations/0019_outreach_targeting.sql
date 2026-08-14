-- MRQ-205: outreach cards stay organization-scoped and target a conference
-- without putting workflow state on people. Existing stage rows are legacy
-- cards, so both targeting and next-touch remain nullable.
ALTER TABLE person_events ADD COLUMN target_event_id TEXT REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE person_events ADD COLUMN next_touch_on TEXT;

-- Do-not-contact is a human consent property, not a pipeline stage. It belongs
-- on the organization-level person record and is checked again by compose.
ALTER TABLE people ADD COLUMN do_not_contact INTEGER NOT NULL DEFAULT 0 CHECK (do_not_contact IN (0, 1));
