-- MRQ-123 — saved organizer embeds.
-- 0007 deliberately left this table writerless while public routes resolved
-- kind/config from slug/query. These defaults keep that history readable while
-- giving organizers a named, reversible switch for each saved public surface.
ALTER TABLE embeds ADD COLUMN name TEXT NOT NULL DEFAULT 'Untitled embed';
ALTER TABLE embeds ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));
