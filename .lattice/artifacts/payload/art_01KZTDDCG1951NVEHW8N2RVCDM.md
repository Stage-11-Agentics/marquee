# Plan Review: MRQ-117 — Bulk ZIP export of deliverables

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The issues below are minor refinements the implementer should absorb; none requires returning to planning.

## 2. Summary

Reviewed the MRQ-117 plan (CNT-14 / spec T-F3: multi-select → export dialog → visible Preparing→Ready panel, streaming ZIP-STORE over the MEDIA R2 binding, latest-only via the parent ticket's `is_latest` derivation) against the spec section, the task description, and the live codebase. The plan is grounded and accurate: every factual claim I checked holds — the `/api/v1/events/{id}/...` route prefix matches existing conventions, `program:read` is a real scope (`src/lib/auth/scope-resolution.ts`), `attachments.size_bytes` exists in `migrations/0001_init.sql`, and the spec's own text (STORE not deflate, manifest.txt, "do NOT download the ZIP" scoring rule) is faithfully carried into the design. The key residual risks are small: folder-name derivation and its fallbacks are underspecified, and the pre-generation size display's data source is left ambiguous.

## 3. Issues

**[MINOR] Implementation step 2 — Folder-name derivation and its fallbacks are unspecified**
The task description and spec pin the human-usable folder scheme (`Thu-1400-Room_Speaker/`), but the plan's steps only say "sanitize archive paths" and "validate grouping" without stating how folder names are derived or what happens at the edges: a session with no scheduled slot or room (day/time/room components missing), two selected deliverables that collapse to the same sanitized folder name, or by-speaker grouping where one speaker spans sessions. Undefined here means invented under pressure during implementation, where a collision could silently overwrite one deck's entry name with another's inside the archive listing.
**Recommendation:** Add one sentence to step 2: name components (weekday-HHMM-room for by-session; speaker name for by-speaker), explicit fallbacks for unscheduled/roomless sessions (e.g., `Unscheduled_Speaker/`), and a collision suffix rule so archive paths are unique by construction.

**[MINOR] Implementation steps 2–3 — Source of the pre-generation total size is ambiguous**
The task requires "total size shown before generating," but step 2 places the `size_bytes` total inside the export route — which only runs when generation starts. Step 3 says the dialog "shows selected entries and their size" without saying where that number comes from. If the implementer reads step 2 as the only size source, the total appears after Generate is clicked, failing the requirement while every individual piece exists.
**Recommendation:** State that the dialog sums `size_bytes` client-side from the already-loaded library rows (T-F1 lists size as a column), and that the server-side total in the export route is the authoritative recomputation, not the display path.

**[MINOR] Implementation step 3 — Whole-ZIP Blob buffers the archive in browser memory**
Fetching the response into a Blob is the right mechanism for the visible Preparing→Ready state (and the spec explicitly blesses inline generation with the queued-to-R2 variant as a later swap), but it does buffer the entire archive in tab memory, partially undoing the server-side streaming design. Fine for the eval's seed data; a real conference's full-deck export could reach gigabytes and crash the tab. Since the dialog already knows the total size before generating, the guard is nearly free.
**Recommendation:** Note the memory bound in the plan or code, and consider a soft size-threshold warning in the dialog ("Large export — N MB") rather than any behavioral change. No architectural revision needed for this ticket.

**[MINOR] Parent/stacking contract — No escalation path if MRQ-115 never publishes**
The plan correctly polls for `github/mrq-115-files-library` (verified: the branch exists only as a local worktree; the remote has no such ref yet, only PR refs). But it doesn't say what happens if the parent doesn't appear within the ticket's window — the encoder and route (steps 1–2) are parent-independent and could proceed, while step 3 (the UI on MRQ-115's list) genuinely blocks.
**Recommendation:** Add one line: steps 1–2 proceed against `main` immediately; if MRQ-115 remains unpublished when they're done, comment on the board/raise a flag rather than idling or improvising a stand-in selection surface.

## 4. Positive Observations

- **The scoring trap is internalized, not just quoted.** The plan's single most important constraint — the visible state is the artifact, a bare anchor download scores `not_found` — shapes the actual design (fetch-to-Blob so Preparing/Ready are real states, reserved status-panel space, persistent Ready panel) rather than appearing only as a warning label.
- **Server-authoritative correctness in the right places.** Event scope, latest-only resolution, and row identity are all enforced server-side through the parent's shared helper; the plan explicitly refuses a second `is_latest` definition and refuses to trust client-supplied filenames — exactly the drift the spec warns about ("that's how AV stages the wrong deck").
- **Honesty as a design requirement.** Missing deliverables and lost R2 objects become `manifest.txt` entries instead of fabricated files or false failures; the dialog states latest-only inclusion; the plan even forbids claiming a queued-to-R2 mechanism it doesn't implement. This matches PHILOSOPHY.md's truthfulness rules and the T-H lesson about false UI copy.
- **Codebase-convention fidelity.** Separate `files-export.routes.ts` to keep the parent's handlers readable, conforming `*.routes.ts` shape, `program:read` scope, D1-independent encoder for direct unit coverage, and the UI never-jump rule — all verified real conventions, correctly applied.
- **Fleet-aware verification discipline.** Touched-file tests during iteration, `uptime` load check before the pr-gate, stacked-PR body text, stop at `pr_open` — the lifecycle section respects the multi-agent environment this ticket will actually run in.
- **Cycle-1 resolutions are substantive**: each PASS line names a concrete failure mode it closed (bare-download implementation, parallel version definition, CPU budget) rather than rubber-stamping.
