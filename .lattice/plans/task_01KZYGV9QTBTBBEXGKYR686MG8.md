# MRQ-167: CSV import overwrites hand-entered speaker data with no preview and no undo

## What happens

`POST /api/v1/org/imports/people` (`src/routes/org-imports.routes.ts:79-106`) matches on
email and, for every match, runs:

```sql
UPDATE people SET name = ?, title = COALESCE(?, title), company = COALESCE(?, company),
       bio = COALESCE(?, bio), updated_at = ? WHERE id = ?
```

A blank cell is already handled correctly — `COALESCE` means "this export does not carry
the field", not "delete what the speaker wrote". The defect is the case the CSV *does*
carry a value: a populated column silently replaces whatever the organizer hand-entered,
with

- **no preview.** The organizer uploads and the write has already happened. The response
  reports `created` / `updated` counts only; nothing says *which fields on which people
  changed, from what, to what*.
- **no undo.** `import_rows` records `outcome: "updated"` and `target_id`. It does not
  record the prior values, so there is no restore path even manually.
- **`name` overwritten unconditionally.** It is the one field with no `COALESCE`. A row
  always has a name (`planPersonImport` skips rows without one), so a stale export
  reverts a corrected spelling with no trace.

This is real data loss on the organizer's most expensive asset — the bio, title and
company they cleaned up by hand — triggered by the most ordinary act in the product:
re-importing a fresher export.

## Why it is worth building anyway

No rubric item punishes this; it surfaced in round 5 browsing. It is on the list because
PHILOSOPHY.md's "respect the operator" makes an unpreviewed, unrecoverable overwrite a
defect on its own merits, not because a judge counts it.

## Shape of a fix

The import already computes a plan before it writes (`planPersonImport`). Diff that plan
against the existing rows and make the change visible and reversible:

1. **Dry-run first.** Return the per-person, per-field diff (old → new) and apply only on
   confirm — or apply-and-show, if that keeps the flow to one step, provided step 2 exists.
2. **Record the prior value** in `import_rows` (or a sibling) so an import is revertible
   as a unit. An import receipt that cannot restore what it replaced is not a receipt.
3. Treat `name` like the others.

Do not add a column-mapping wizard — `people-import.ts` argues against one deliberately
and that reasoning stands. This is about what the write does, not about the mapping.

## Acceptance

- Re-importing an export with a stale bio/title/company/name over hand-entered values
  either requires a confirmation that shows the field-level diff, or is reversible from
  the import receipt afterwards. One or the other, proven by a test.
- The receipt carries the prior values.
- A blank cell still means "not carried" and still leaves the stored value alone.
