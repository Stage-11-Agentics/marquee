# MRQ-65 validation

HEAD: 237553d7ba98f8e20cd96692aab7c53bbdecddca
Verdict: PASS

## Mandatory PR gate

Command: `npm run pr-gate -- --ticket MRQ-65`

Result:

```json
{
  "command": "pr-gate",
  "ticket": "MRQ-65",
  "status": "pass",
  "elapsedMs": 15239,
  "budgetMs": 45000
}
```

The gate passed worker, client, and test TypeScript checks; production build; design contract; the hermetic suite (32 Vitest files / 180 tests and 56 Node tests); and the merged AC trace with AC-263 claimed and no uncovered criteria.

The runtime integration tests exercise the one-pinned-building portal/public state and the two-pinned-building state. They assert the folded room labels and map disclosure while retaining address, entrance note, access minutes, and the public/private access-note boundary.
