# MRQ-211 — Activity: one append-only log, three lenses

**One substrate, three projections.** `audit_log` is the substrate. Nothing here
creates a second event table, and nothing stores a feed: every lens is a query.

## The one schema change, and why it is unavoidable

`audit_log.event_id` is `NOT NULL REFERENCES events(id)`. Every action the org
admin lens exists to show — an invite minted, a token issued, an organizer
removed, ownership transferred — belongs to the **organization**, not to a
conference, and a freshly claimed instance has an organization with *zero*
conferences (`resolveOrganization` in `instance-claim.ts` creates the org; the
first conference comes later). There is no honest event id to write.

`migrations/0017_audit_log_org_scope.sql` rebuilds the table (the pattern 0007,
0008, 0009 and 0011 already use, since SQLite cannot relax a `NOT NULL`):

- `event_id` becomes nullable, still FK to `events(id)`
- `org_id TEXT REFERENCES organizations(id)` is added, nullable
- `CHECK (event_id IS NOT NULL OR org_id IS NOT NULL)` — every row is scoped to
  *something*; a row scoped to nothing is unreachable by every lens
- existing rows backfill `org_id` from their event's org, so history predating
  the column is not stranded outside the org lens
- indexes recreated + `idx_audit_org_created ON audit_log(org_id, created_at)`

`src/db/schema.ts` mirrors it; `src/lib/audit.ts` carries `orgId` in the entry
and the column list.

## The named seam (what MRQ-207 / MRQ-212 call)

`src/lib/org-activity.ts`:

- `recordOrgActivity(db, entry)` and `orgActivityStatement(db, entry)` — the
  second exists for the same reason `auditStatement` does: an admin action that
  audits in a different transaction from the change it describes is worse than
  one that does not audit at all.
- `ORG_ACTIVITY_ACTIONS` — the vocabulary, as constants, so a writer cannot
  invent a spelling the reader does not label.
- `describeOrgActivity(row)` — one action → one human sentence, shared by all
  three lenses. Unknown actions degrade to a humanised fallback rather than a
  blank row, which is what lets 207/212 add actions before this file knows them.
- `orgActivityPage(db, orgId, page)` — the reader.

Every seam write sets `org_id` (and `event_id` too when the action is scoped to
one conference, e.g. an event-scoped invite). **The org lens is therefore
`org_id = ?`, not a hardcoded action list** — an action MRQ-207 adds tomorrow
appears in the lens without anyone editing a filter.

**Person-subject convention:** an admin action whose subject is a person records
`entity_type='person', entity_id=<person_id>`, with the specifics in the
payload (which roles were removed, how many sessions were revoked). That keeps
the person lens one indexed lookup on `idx_audit_entity_created` instead of a
JSON scan of the whole log.

## Writers instrumented (what exists on `main`)

| Action | Writer |
|---|---|
| `org.invite_minted` / `org.invite_revoked` | `org-people.routes.ts` |
| `org.invite_claimed` | `instance-claim.ts` (`exchangeInstanceLink`, `org_invite`) |
| `org.member_removed` | `org-people.routes.ts`, **inside the existing batch**, carrying removed roles + revoked sessions |
| `org.token_created` / `org.token_revoked` | `tokens.routes.ts` |

Not on `main`, so left to the parallel tickets with the seam named in the PR and
in a comment on each: org default changes (MRQ-207), ownership transfer (207/212).

## The three lenses

1. **Org admin** — `GET /api/v1/org/activity` (page/per_page, the shared list
   envelope), and `/org/activity` in the SPA. It answers before the conference
   guard, like People and Lists, because an org with no conference still has
   invites and tokens. MRQ-207's shell is not on `main`, so this ships as a
   standalone route with no sidebar row; 207 mounts the same component as the
   Activity tab.
2. **Person** — the drawer's assembled feed keeps its shape (annotations +
   audit + outbox) but reads audit rows through `describeOrgActivity`, so
   `org.member_removed` stops rendering as a raw action string, and gains
   `GET /api/v1/org/people/{personId}/activity` for page 2 onward.
3. **Submission** — `submissionTimelineFor` in `src/lib/history.ts` extends
   `recordHistoryFor` with paging; the record's History card gets the labels and
   a Load more. Missing moments are instrumented rather than synthesised where
   the writer exists on `main`.

## Tests

One round trip per lens — writer runs → row lands → projection shows it — plus
the org-scope guard (a row with neither scope is refused) and the paging
contract. Worker-backed tests share one file per lens to respect the 45 s suite
budget.

## Reset 2026-08-14 by agent:codex-cli
