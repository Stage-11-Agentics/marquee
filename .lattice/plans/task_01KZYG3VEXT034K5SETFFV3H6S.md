# MRQ-166: Sessionize import: require a speaker email instead of inventing one

The Sessionize speaker import treats a speaker's email as optional and invents
one when it is missing. It should require it.

## The bug this closes

`src/lib/sessionize-import.ts:472`

```js
const email = normalizeEmail(row.email || `speaker+${hashPart(...)}@example.invalid`);
const byEmail = await personByEmail(db, org, email);
const current = byEmail ?? await personByName(db, org, name);   // name fallback
const next = { email, ... };                                     // written wholesale
```

A CSV row whose **name matches an existing person and whose email cell is blank**
writes the fabricated `@example.invalid` address over that person's real one.
Mail to them then silently goes nowhere, and the next import no longer matches
them by email — it falls to the name path again, so the corruption is sticky and
invisible. Batch undo does restore it (`restoreSnapshot` writes `email` back),
but only if somebody notices first.

Found by the code review of MRQ-164 (PR #182), which fixed the same failure class
for bio/title/company. Pre-existing, unchanged on `main` before that PR.

## The ruling (Atin, 2026-08-13)

**Require the email. Delete the placeholder.** The fallbacks exist to satisfy
`people.email NOT NULL` + `UNIQUE(org_id, email)`, not to serve an organizer, and
a speaker imported with a fabricated address **cannot participate in the product**
— no portal invite, no task assignment, no reminder, no onboarding chase, all of
which need a real address. The record looks imported and is inert, and the failure
surfaces weeks later as a bounced invite rather than at import time.

## Scope

1. **Refuse at the mapping step** when no column maps to `email`. There is no
   required-field enforcement there today (`normalizeMapping` merely merges
   defaults over auto-detected headers). The mapping step is already write-free
   and shows a preview, so a bad export is turned away before anything is
   written — far better than failing 200 rows one at a time mid-run.
2. **Fail the row** when the email cell is empty, with a reason the ROW DETAIL
   table shows. Precedent three lines away: `if (!name) throw new Error("speaker
   name is required")`. The per-row try/catch already exists, so one bad row does
   not stop the import.
3. **Delete the speaker placeholder.** Nothing depends on it — no test, fixture
   or seed. Leave the *unattributed reviewer* placeholder at line 607 alone: a
   score with no identity attached is a genuinely different case.
4. **Narrow the name match to unique matches only.** `personByName` is
   `lower(name) = ? ORDER BY id LIMIT 1`, so a name collision writes to an
   arbitrary human. Select two, and decline the match if two come back. Do **not**
   drop name matching: a speaker re-registering under a new address would then be
   created as a second person, splitting their history — the duplicate-person
   problem `src/lib/participants.ts` exists to prevent.
5. **A name-matched row never rewrites the email.** Identity by name is a guess;
   acting on it can redirect one real person's conference mail to another's
   address. Import the rest of the profile and say so in the row reason.

## Acceptance

- A mapping with no email column is refused at the mapping step, before any write,
  with a message naming the missing column.
- A speaker row with an empty email cell lands as `failed` with a readable reason;
  the other rows in the same import still succeed.
- A name-matched row keeps the stored email and says so in its row reason.
- A name that matches two people matches neither; the row does not silently write
  to one of them.
- Re-importing the same export twice is still idempotent (the placeholder's only
  legitimate job was keeping blank-email rows re-findable, so prove nothing else
  regressed).
- Each test verified failing before the fix.

## Before shipping

Check whether any live or demo `people` row already carries an
`@example.invalid` address from a previous import. The seed does not generate
them, so none are expected — but a stricter import should not be the thing that
discovers a stranded record.

## Non-goals

- The `uq_people_org_email` index is on the raw column while every lookup compares
  `lower(email)`, so `Ada@x.com` and `ada@x.com` can coexist and `personByEmail`
  picks one arbitrarily. Real, latent, needs a migration and a dedupe pass. **Its
  own ticket, not this one.**
- `/submissions/new` collecting only a submitter (noted on MRQ-164).
