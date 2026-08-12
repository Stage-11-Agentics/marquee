# MRQ-84: Sessionize importer silently drops unrecognized tracks and formats

The Sessionize importer drops track and format values it doesn't recognize and says nothing about it. The row reports success, the categorization is gone. Evidence: `sequence/UX-SWEEP-FINDINGS-PASSB.md` (Flow 5), verified end to end through the same authenticated API the wizard calls.

## What was seen

Imported `fixtures/sessionize/sessions.csv`, whose rows carry `Track: Platform` and `Format: Talk`. This event's configured taxonomy uses different names — tracks Agents / Security / Infra, formats Lightning / Workshop / Online. The sessions imported as `created` with `"tracks": []` and `"format": null`, and the row's own `reason` text mentioned only the fields that did map.

An operator importing a real Sessionize export whose taxonomy doesn't exactly match their Marquee configuration — which is the normal case, not the edge case — loses every track and format assignment with no signal that anything was incomplete.

## Root cause

`src/lib/sessionize-import.ts:638-639` resolves both by exact, case-insensitive name:

```
const track = row.track.trim() ? await db.prepare("SELECT id FROM tracks WHERE event_id = ? AND lower(name) = lower(?)")... : null;
const format = row.format.trim() ? await db.prepare("SELECT id FROM formats WHERE event_id = ? AND lower(name) = lower(?)")... : null;
```

A miss yields `null`, and lines 654-655 fall back to `current?.format_id ?? null` / `current?.primary_track_id ?? null`. Nothing anywhere records that a non-empty source value failed to resolve. The distinction that is lost is **"the CSV said nothing"** versus **"the CSV said `Platform` and we don't have a track by that name"** — the second is worth telling someone about, and the code cannot currently tell them apart downstream.

## Scope

Surface the miss in the row's own `reason`, the same way the malformed-row case already reports its failure clearly.

This is deliberately small and the seam already exists. `reason` is composed at `sessionize-import.ts:735` as a `.filter(Boolean).join("; ")` over an array — an unmatched-taxonomy note is one more entry in it:

```
const reason = [
  status.note,
  actualChanged ? "session, relationships, scores, or custom fields reconciled" : "same external_ref and values already present",
  evaluation ? "evaluation result imported" : null,
].filter(Boolean).join("; ");
```

Name the actual unmatched value — `track "Platform" not recognized, left unset` beats a generic warning, because the operator's next move is to either create that track or fix the export, and both need the name.

**No new UI is required.** `src/ui/import/SessionizeImportPage.tsx:149` already renders a **Reason** column in the Row detail table (`{row.reason ?? "—"}`), so anything added here surfaces immediately.

Consider whether the outcome chip should stay `created` when a row imported incompletely. `created` with a caveat in the reason is defensible and is the smaller change; a distinct partial state is not — do not invent a new outcome value for this.

Out of scope: fuzzy or alias matching of taxonomy names, and any mapping UI that would let an operator reconcile the two vocabularies during the wizard. Both are real product ideas and neither is this ticket — the defect here is silence, not the matching strategy. If the work suggests one, note it in the PR rather than growing this.

## Constraints

- DESIGN.md / Flight Deck tokens; `check:design` stays green. The reason text is organizer-facing copy — plain language, no field names or SQL, matching the voice of the existing reason strings.
- No new D1 table and no migration.
- Do not change the resolution behaviour itself. A row that today imports with an unset track must still import; this ticket adds the explanation, not a new failure mode. Turning a silent drop into a hard row failure would break the importer's duplicate-safety story, which Pass B verified holds (`created: 0, skipped: 6` on a genuine re-import).
- If you touch an API route, `npx vite build && node cli/generate-api-registry.mjs` — `check:api` asserts exact registry parity.
- Test titles must begin `AC-<n> · ` or `CONTRACT · ` or `trace:ac` fails.

## Verification

1. Unit or integration test over the import path: a row whose track/format names do not exist in the event's taxonomy imports successfully **and** carries the unmatched value in its `reason`. Assert the complementary case too — a row with genuinely empty track/format columns must NOT produce the warning, or the message becomes noise on every blank field.
2. Re-import the same export and confirm the reason still reads correctly on the `skipped` path, not only on `created`.
3. **Real-artifact smoke.** Own Worker on a free port, full seed, real browser. Run `fixtures/sessionize/sessions.csv` through `/import` end to end and read the Row detail table — the warning must be legible to someone who does not know the schema. Pass B verified this flow at API level only; the wizard's own UI (column-mapping screen, live preview, click-through) has **never been driven in a browser**, so do this one through the actual wizard and screenshot the results table.

## Delivery

Own git worktree, branch `mrq-84-import-unmatched-taxonomy`, cut off current `github/main`. PR via `gh pr create --repo Stage-11-Agentics/marquee --base main`.

## File ownership

OWNS: `src/lib/sessionize-import.ts`, `src/ui/import/*` if the reason needs presentation work, its own tests.
