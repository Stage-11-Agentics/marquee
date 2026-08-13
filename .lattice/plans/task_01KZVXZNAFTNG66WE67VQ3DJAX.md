# MRQ-148: AIA-08: one-action assisted placement in the agenda builder

OPERATOR DECISION 2026-08-12: the declared non-goal is REVERSED. AI-assisted scheduling is now IN SCOPE and must ship tonight. Together with MRQ-149 this is the ENTIRE arithmetic distance from 98.7% to 100% on the eval.

RUBRIC ITEM: AIA-08, weight 1, type depth, testability auto. Currently `not_found` (zero credit).

CRITERION (verbatim): 'Some assisted or automatic scheduling capability exists that places unscheduled sessions into slots in one action ("AI" auto-scheduling judged generously as any auto-place assist).'

PASSES WHEN (verbatim): 'An auto-schedule/AI-assist control is present in the builder and, when triggered, places at least one previously unscheduled session into a slot/room. Judge generously -- any one-action assisted placement counts, and whether the result shows conflict flags is recorded but not gating. Fail if no such capability exists anywhere in the builder ... or if the control exists but performs no placement when triggered.'

READ THAT AGAIN, BECAUSE IT MAKES THIS TICKET SMALL: the rubric says 'judged generously' and 'any one-action assisted placement counts'. **You do not need an LLM. You do not need a model call. You do not need an optimiser.** A deterministic 'Auto-place' button that finds free time x room slots and assigns unscheduled sessions into them, in one action, EARNS THIS ITEM IN FULL. Do not build an AI scheduler tonight. Build an honest assisted placer.

MINIMUM BAR:
- A control in /agenda-builder (label it honestly -- 'Auto-place', 'Fill open slots', or similar).
- One click places at least one previously unscheduled session into a real slot and room.
- The placement persists across reload (it must go through the same path manual placement uses, not a client-side fake).
- Conflict flagging is recorded but NOT gating -- do not block the ship on perfect conflict avoidance. Prefer placing into non-conflicting slots where cheap, and let the existing conflict panel do its job otherwise.

BE HONEST IN THE COPY. PHILOSOPHY.md and this product's whole posture is that it does not overclaim. Do NOT label a deterministic placer as 'AI'. Call it what it is. The rubric explicitly accepts any assisted placement, so honesty costs nothing here -- and MRQ-146 exists precisely because the API was caught overclaiming. Do not create a second instance of that.

EVIDENCE THE JUDGE WANTS: screenshot of the control, plus before/after grid screenshots showing the previously unscheduled session now placed.

SIZE: small-to-medium, and it is worth more per hour than anything else left on the board.

PROVENANCE: sbek run 2026-08-12T15-33-34, ai-agenda, AIA-08. Re-baseline by Eval Closer (surface:48) established this and MRQ-149 as the only remaining distance to 100%.
