-- MRQ-214 — the sponsors module's data layer, at the width the sponsor portal
-- needs and no wider. 0001 through 0022 are immutable; this migration is
-- additive.
--
-- The scoping split is `sequence/sponsors-design.md` ruling 1: a COMPANY is an
-- organization-level relationship that outlives every conference, and a
-- SPONSORSHIP is one conference's commerce over it. That is why `status` lives
-- on the sponsorship and never on the company or the person: the same company
-- is `committed` here and `courting` next year, and the same human is a
-- confirmed contact at one conference while nothing at another.
--
-- Contacts are `people` rows reached through a join table, never a parallel
-- contact table (speaker-CRM doctrine, `speaker-crm-scope.md` §2). Booth is
-- columns on the sponsorship rather than a second record type (ruling 5), which
-- is what lets a boothless sponsorship be null columns instead of a branch.

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  website TEXT,
  domain TEXT,
  blurb TEXT,
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  last_write_source TEXT NOT NULL DEFAULT 'marquee'
    CHECK (last_write_source IN ('marquee', 'airtable')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sponsor_tiers (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (id, event_id),
  CHECK (position >= 0)
);

-- Booth data is a set of nullable columns on the deal, deliberately. `hall` and
-- `load_in` are free text because a venue describes them in its own words, and
-- the building is a real foreign key so the portal's map is the same pinned
-- building the agenda uses rather than a second copy of an address.
CREATE TABLE sponsorships (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  tier_id TEXT,
  status TEXT NOT NULL DEFAULT 'courting'
    CHECK (status IN ('courting', 'committed', 'fulfilled')),
  passes INTEGER NOT NULL DEFAULT 0 CHECK (passes >= 0),
  booth_number TEXT,
  booth_size TEXT,
  booth_hall TEXT,
  booth_building_id TEXT,
  booth_load_in TEXT,
  booth_access_note TEXT,
  booth_leave_note TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (booth_building_id, event_id) REFERENCES buildings(id, event_id),
  -- Composite, like the building above it. A single-column FK to
  -- `sponsor_tiers(id)` would let a sponsorship in one conference point at
  -- another conference's tier, and the failure would be SILENT: the portal joins
  -- on `tier.event_id = sponsorship.event_id`, so a mis-scoped tier renders as no
  -- tier at all rather than as an error.
  FOREIGN KEY (tier_id, event_id) REFERENCES sponsor_tiers(id, event_id)
);

CREATE TABLE sponsorship_contacts (
  id TEXT PRIMARY KEY,
  sponsorship_id TEXT NOT NULL REFERENCES sponsorships(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- People link to companies; the legacy `people.company` string stays beside it
-- for now (ruling 1's agent default). The reconcile migration is a later band,
-- and nothing in this ticket reads the string as if it were the link.
ALTER TABLE people ADD COLUMN company_id TEXT REFERENCES companies(id);

-- The deliverables join. Sponsor deliverables are person-assigned tasks on the
-- existing machinery (ruling 2 — no company-owned task type); this column is
-- only how they are GROUPED by the deal they belong to, which is what makes
-- "the whole sponsorship, anyone completes" expressible as a query.
ALTER TABLE speaker_tasks ADD COLUMN sponsorship_id TEXT REFERENCES sponsorships(id);

-- WHO completed the work, beside `completed_at`'s WHEN (SPEC Amendment 23).
-- Nullable because history has no answer for it: back-filling `person_id` would
-- assert that the assignee finished every task ever completed, which is exactly
-- the claim this column exists to stop making. Null means "not recorded", never
-- "the assignee".
ALTER TABLE speaker_tasks ADD COLUMN completed_by_person_id TEXT REFERENCES people(id);

-- A sponsorship's guaranteed Session(s). `submissions.kind = 'session'` with
-- `bypass_evaluation` already models the sponsor Session (R9); this is the
-- honest link back to the deal that bought it.
ALTER TABLE submissions ADD COLUMN sponsorship_id TEXT REFERENCES sponsorships(id);

CREATE INDEX idx_companies_org_name ON companies(org_id, name);
CREATE INDEX idx_sponsor_tiers_event_position ON sponsor_tiers(event_id, position);
CREATE INDEX idx_sponsorships_event_status ON sponsorships(event_id, status);
CREATE INDEX idx_sponsorships_company ON sponsorships(company_id);
-- One deal per company per conference. A second one is a data-entry mistake
-- whose consequence is a portal that shows half a sponsorship.
CREATE UNIQUE INDEX uq_sponsorships_event_company ON sponsorships(event_id, company_id);
CREATE UNIQUE INDEX uq_sponsorship_contacts_sponsorship_person
  ON sponsorship_contacts(sponsorship_id, person_id);
-- Exactly one primary contact per sponsorship, enforced here rather than by a
-- read-then-write check that two concurrent writers would both pass.
CREATE UNIQUE INDEX uq_sponsorship_primary_contact
  ON sponsorship_contacts(sponsorship_id) WHERE is_primary = 1;
CREATE INDEX idx_sponsorship_contacts_person ON sponsorship_contacts(person_id);
CREATE INDEX idx_speaker_tasks_sponsorship_status
  ON speaker_tasks(sponsorship_id, status, due_at);
CREATE INDEX idx_submissions_sponsorship ON submissions(sponsorship_id);
