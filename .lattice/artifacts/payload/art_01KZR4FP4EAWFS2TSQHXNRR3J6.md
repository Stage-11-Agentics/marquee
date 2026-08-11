# MRQ-65 self-review

HEAD: e0157a114d534c3a05ac5ff849c4640a9e9278e5
Verdict: PASS

## Findings

None.

## Adversarial checks

- The comparison threshold is event-level and counts distinct buildings with complete latitude/longitude pins. One pinned building folds room-label suffixes, walking/Transit presentation, the agenda building band, and map disclosure; two pinned buildings retain them.
- The canonical `getConflicts` path and `getTransitConflicts` geometry helper remain unchanged. Filtering is presentation-only and does not feed doctored geometry into conflict computation.
- Arrival instructions remain available at one and two buildings: portal room/building/address/entrance note/access minutes, leave-by behavior, place merge fields, and existing ICS `LOCATION`/`GEO` generation are preserved. Public tests continue to assert `access_note` is absent from the public agenda.
- The venue editor retains access minutes, entrance note, AV capabilities, and room notes. The one-building map uses a native disclosure with a reserved 360px folded-state slot; the portal map column retains its reserved min-height, so surrounding content does not jump.
- The public agenda, session, speaker, and embed headers name the single pinned building once, while two-building public labels keep the building suffix. The submissions header follows the same one-building rule.
- The generated OpenAPI document hash in `cli/api-registry.json` matches the served document; no contract documents, secrets, internal hosts, or ticket identifiers were added to shipped source.

## Verification

- `npm test` — PASS: Vitest 32 files / 180 tests; Node 56 tests.
- `npx tsc -p tsconfig.json --noEmit` — PASS.
- `npx tsc -p tsconfig.client.json --noEmit` — PASS.
- `npx tsc -p tsconfig.test.json --noEmit` — PASS.
- `npm run check:design` — PASS.
- `npm run check:api` — PASS.
- `npm run check:seed` — PASS.
