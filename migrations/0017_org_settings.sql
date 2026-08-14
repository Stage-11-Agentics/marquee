-- MRQ-207 — the organization becomes a record, and an invite carries the seat
-- it is for.
--
-- Two unrelated-looking additions, one design: the organization is the thing
-- that outlives every conference, so the defaults a new conference inherits
-- (timezone, appearance, the voice mail speaks in, the mark it wears) belong on
-- `organizations` rather than being re-typed per event. Everything here is
-- nullable: an organization that has expressed no preference must be
-- distinguishable from one that chose the value a default would have supplied,
-- because only the first should follow the product when the product changes its
-- mind.
--
-- The invite columns close the gap between the cold-start invite (one shape:
-- org-wide owner) and the steady-state one (a role, and a scope that may be one
-- conference). `memberships` already models both; the token that mints a
-- membership did not carry them, so every invite exchanged as an owner. The
-- role and scope now ride the same row the token hash does, decided at mint by
-- the person who has the authority to decide them — never by the recipient.
--
-- `short_code_hash` is the day-of door (ruling O4): the same single-use row,
-- reachable by a code speakable across a registration desk when the QR cannot
-- be scanned. It is a second credential, not a re-encoding of the first — a
-- 40-character token has no speakable form — so it is stored hashed exactly as
-- the token is, and consumed by the same statement.

ALTER TABLE organizations ADD COLUMN default_timezone TEXT;
ALTER TABLE organizations ADD COLUMN default_theme TEXT;
ALTER TABLE organizations ADD COLUMN comms_from_name TEXT;
ALTER TABLE organizations ADD COLUMN comms_reply_to TEXT;
ALTER TABLE organizations ADD COLUMN logo_key TEXT;
ALTER TABLE organizations ADD COLUMN accent TEXT;

-- The CHECK holds the membership vocabulary rather than the invitable subset:
-- `owner` is a legal membership role and the cold-start claim mints one, so the
-- column must accept it. Which roles an invite may *offer* is an authority
-- question, answered at the route where the inviter's own role is known.
ALTER TABLE magic_links ADD COLUMN invite_role TEXT
  CHECK (
    invite_role IS NULL
    OR invite_role IN ('owner', 'program_lead', 'ops', 'reviewer', 'speaker')
  );
ALTER TABLE magic_links ADD COLUMN invite_event_id TEXT REFERENCES events(id);
-- The organization the invite was minted BY, so the exchange lands the seat
-- there rather than wherever "the first organization row" happens to be. An
-- instance normally holds one, and the cold start's resolve-the-only-one
-- behaviour was fine while every invite meant the same thing; an invite that
-- now carries a role and a scope must also carry whose they are.
ALTER TABLE magic_links ADD COLUMN invite_org_id TEXT REFERENCES organizations(id);
ALTER TABLE magic_links ADD COLUMN short_code_hash TEXT;

-- Partial, so the millions of rows that never carry a short code do not collide
-- with each other on NULL. Unique, because the short-code door resolves a row
-- by this hash alone and two live rows sharing one would make the door
-- ambiguous at exactly the moment a volunteer is standing at the desk.
CREATE UNIQUE INDEX uq_magic_links_short_code
  ON magic_links(short_code_hash) WHERE short_code_hash IS NOT NULL;
