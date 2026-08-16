-- Existing forms remain explicit (0) until an API or seed write opts them into
-- the event default. The raw per_submitter_limit column remains valid at 0 for
-- legacy unlimited forms; the new flag only controls inheritance.
ALTER TABLE forms ADD COLUMN submitter_limit_inherit INTEGER NOT NULL DEFAULT 0 CHECK (submitter_limit_inherit IN (0, 1));
