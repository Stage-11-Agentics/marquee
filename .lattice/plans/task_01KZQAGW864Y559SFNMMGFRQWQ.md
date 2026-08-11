# MRQ-63: Transit conflicts — geography as a scheduling constraint

BUILDPLAN M-58 · ACs AC-258, AC-259 · SPEC Amendment 14 · US-78.

Third conflict class in getConflicts beside room overlap and speaker double-booking: two sessions sharing a speaker, in different pinned buildings, whose gap is smaller than walk + destination access_minutes.

walk = haversine(a,b) * 1.3 / 80 metres-per-minute, floored at 1 minute. The 1.3 is a street-grid detour allowance; claim no more precision than that. Warns, never blocks — same contract as every other conflict.

Must flow into the existing dashboard count, conflicts drawer, and affected tiles through the ONE existing getConflicts call. A parallel path is a defect.

Message shape (from the prototype, verified): 'Transit — 12 min walk to AWS JFK27, plus 10 min building security. Ifeoma Adeyemi needs 22 min; has 10.'

NAMING IS BINDING: the class is Transit, never Travel. 'Travel and accommodation' is already a speaker task meaning flights and hotels, and both land on the same person. Rename across object kind, drawer, tile flag, dashboard label, API conflict type, and copy. AC-259 enforces it with a byte-scan.

Also: building band over the agenda room columns (one cell per contiguous run of rooms sharing a building — the grid encodes geography before any map does), and room headers drop the now-redundant building suffix.

Depends on M-57's re-seed. Without it there is nothing to detect and this ticket cannot demonstrate itself.
