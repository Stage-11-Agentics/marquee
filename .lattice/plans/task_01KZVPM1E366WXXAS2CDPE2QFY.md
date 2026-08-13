# MRQ-137: An unrecognised sort value hard-errors the whole submissions list instead of falling back

SURFACE: /submissions?sort=<unknown>

WHAT BREAKS: /submissions?sort=score_desc renders the page shell with an empty table and 'Submissions did not load - The system sent a request this conference could not accept... - ref a2a0da', and the sort dropdown renders with no option selected. A shareable/bookmarkable list view fails whole rather than degrading to a valid default.

ROOT CAUSE (confirmed at live sha 75b871d94c6f):
- src/api/list.ts:43 -> sort: z.enum(sortKeys).default(options.defaultSort ?? sortKeys[0])
- .default() supplies a value when the key is MISSING; it does not catch an INVALID one. An unknown value therefore throws a ZodError -> 400 -> the list surface shows its load-failure state.
- Valid values are newest | updated | title | score | score_asc (src/routes/views.routes.ts:25). 'score_desc' is a plausible guess that is not in the whitelist -- exactly what an agent or a hand-edited URL produces.

FIX SHAPE: .catch(default) alongside .default(default) on the sort field in src/api/list.ts. Roughly one line, and it fixes every list endpoint built on the shared list contract at once.

WHY URGENT: cheap, and it is the failure mode an agent driving the product by URL hits first -- which bears directly on the 'agent-native by design' claim.

SIZE: trivial. No dependency.

PROVENANCE: sbek run 2026-08-12T15-33-34, abstract-management judgement, defects[4]. Validated by reading live source.
