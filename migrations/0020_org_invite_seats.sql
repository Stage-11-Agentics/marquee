-- MRQ-207 — an invite carries the seat it is for, and a door a human can speak.
--
-- **This is numbered after 0018 on purpose, and moving it earlier breaks it
-- silently.** `0018_event_deletion.sql` rebuilds `magic_links` — it creates a
-- replacement table with an explicit column list, copies the rows across, drops
-- the original and renames. A column added to `magic_links` in any migration
-- BEFORE 0018 is therefore copied away by that rebuild with no error and no
-- failing check: the column simply ceases to exist, and the first thing to
-- notice is a live invite that has forgotten which seat it was for. So these
-- four columns are added after the last migration that rebuilds this table, and
-- any future rebuild of it has to carry them forward by name.
--
-- What they are for. `memberships` has always modelled a role and a nullable
-- `event_id`; the token that mints a membership did not carry either, so every
-- invite exchanged as an organization-wide owner. A day-of volunteer needs `ops`
-- scoped to one conference (ruling O4), and a link that cannot say so can only
-- ever over-grant. The role and scope now ride the same row the token hash does,
-- decided at mint by the person with the authority to decide them — never by
-- the recipient, who supplies only their own name and email.
--
-- `invite_org_id` is the one that closes a real hole rather than adding a
-- feature: the exchange used to resolve "the first organization row", so an
-- invite minted by one organization could land its membership in another.
--
-- `short_code_hash` is the day-of door: the same single-use row, reachable by a
-- code speakable across a registration desk when the QR cannot be scanned. It
-- is a second credential rather than a re-encoding of the first — a
-- 40-character token has no speakable form — so it is stored hashed exactly as
-- the token is, and consumed by the same statement.

-- The CHECK holds the membership vocabulary rather than the invitable subset:
-- `owner` is a legal membership role and the cold-start claim mints one, so the
-- column must accept it. Which roles an invite may *offer* is an authority
-- question, answered at the route where the inviter's own role is known.
ALTER TABLE magic_links ADD COLUMN invite_role TEXT
  CHECK (
    invite_role IS NULL
    OR invite_role IN ('owner', 'program_lead', 'ops', 'reviewer', 'speaker')
  );

-- Distinct from 0018's `event_id`, which records the conference a link BELONGS
-- to so deleting that conference can take its credentials with it. This one is
-- the scope of the membership the link will MINT. They coincide on a
-- conference-scoped invite and diverge everywhere else, and collapsing them
-- would make a deleted conference silently rewrite what an unspent invite grants.
ALTER TABLE magic_links ADD COLUMN invite_event_id TEXT REFERENCES events(id);

-- The organization the invite was minted BY, so the exchange lands the seat
-- there rather than wherever "the first organization row" happens to be.
ALTER TABLE magic_links ADD COLUMN invite_org_id TEXT REFERENCES organizations(id);

ALTER TABLE magic_links ADD COLUMN short_code_hash TEXT;

-- Partial, so the rows that never carry a short code do not collide with each
-- other on NULL. Unique, because the short-code door resolves a row by this
-- hash alone and two live rows sharing one would make the door ambiguous at
-- exactly the moment a volunteer is standing at the desk.
CREATE UNIQUE INDEX uq_magic_links_short_code
  ON magic_links(short_code_hash) WHERE short_code_hash IS NOT NULL;
