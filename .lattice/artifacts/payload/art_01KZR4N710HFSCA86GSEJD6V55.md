# MRQ-65 self-review

HEAD: 8e4c708a0b8c4516d5903e6aa718e214b447c5ef
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

- `npm run pr-gate -- --ticket MRQ-65` — PASS in 16.226s.
- Gate suite — PASS: Vitest 32 files / 184 tests; Node 58 tests.
- Merged AC trace — PASS: AC-263 claimed, zero uncovered criteria.
