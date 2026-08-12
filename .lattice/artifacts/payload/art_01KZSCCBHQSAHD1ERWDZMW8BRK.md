VERIFIED FIXED ON MAIN — no code change made, none needed.

MRQ-76 (PR #17) unified pipeline-stage derivation onto BOARD_STAGE_SQL. The 'waved' arm now requires status='accepted' AND a pending wave, so a terminal-negative status cannot match it and falls to ELSE 'declined'. Confirmed against a running Worker on main@21e6cef, both halves of the original finding:

- rejected (sub_synthetic-pool-0830): status rejected -> stage 'declined' / 'Declined / not advancing'
- withdrawn (same record after a real acceptance reversal driven through the UI): status withdrawn -> stage 'declined'

Verified in the browser, not only at the API — the record page stage pill reads 'Declined / not advancing'.

SEPARATE OBSERVATION, NOT FIXED, needs an operator call: a WAITLISTED (Maybe) record now also derives 'declined', so its stage pill reads 'Declined / not advancing' while its status badge reads 'Maybe'. Pass B held that 'Waved' was the correct stage for a genuine Maybe record; MRQ-76 removed that mapping along with the buggy one. Maybe is not a decline - it is the holding state MRQ-83 exists to let organizers resolve - so the label is dishonest there. Fixing it means either a new 'waitlisted' board stage (new column, medium) or relabelling the declined stage (affects rejected/withdrawn too). Both are product decisions inside BOARD_STAGE_SQL, which the brief explicitly fenced off. Left for the operator. Screenshot evidence captured.