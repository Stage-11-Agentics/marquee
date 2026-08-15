# Plan Review: MRQ-185

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The issues below are all minor sharpening, none require returning to planning.

## 2. Summary

Reviewed the five-step implementer plan for replacing the bare em dash speaker line with an honest "Speaker to be announced" empty state on the public agenda, session detail, and embeds, plus a publish-review flag for the organizer. The plan is correctly scoped — it preserves the public/program audience split exactly as the task demands, adds no migration, and leans on data the publish-review payload already carries. I verified every load-bearing claim against the codebase: the em-dash fallbacks exist where the plan expects them, the embed config preview and embed output share one renderer, and the publish candidate query already projects `role` per participant.

Verification notes, for the implementer's benefit:

- **Public agenda card:** `SpeakerLine` at `src/ui/public/agenda/PublicAgendaPage.tsx:537` renders `"—"` when `session.speakers` is empty. `.public-speakers` already has `min-height: 20px` (line 78), so the geometry constraint (task item 3) is already half-satisfied — a text label swaps in without any jump.
- **Public session detail:** the Speakers section at `PublicAgendaPage.tsx:931` renders `<span>—</span>` — the plan is right to include this surface.
- **Embed (all session kinds):** `speakerCredits` at `src/ui/embeds/EmbedPage.tsx:271` falls back to `"—"` and is the single function behind both the agenda embed list (line 380) and the sessions flat list (line 310). `/embed/config`'s live preview renders the same `EmbedPage`/`PublicEmbedData` as the served embed (`src/routes/embed.route.tsx:92,119,143`), so the task's "one renderer, not two" requirement is satisfied structurally by fixing `speakerCredits` once.
- **Publish review:** the candidate query (`src/routes/agenda.queries.ts:371-380`) builds `SPEAKERS_JSON` at audience `program` with `role: "participation.role"` in the projection, and `toPublishCandidate` passes it through — so plan step 3's "no data model change, no migration" claim is verified. The client-side check against `SPEAKING_PARTICIPATION_ROLES` (exported from `src/lib/participants.ts:23`) is a pure payload inspection, and UI files already import constants from `src/lib` (e.g. `PortalPage.tsx`, `TaskTemplatesPage.tsx`), so no boundary is crossed.
- **Test infrastructure:** existing integration suites (`tests/integration/public-embed-widgets.AC-217-218-273-274.test.ts`, `public-site.AC-*.test.ts`, `tests/integration/api/embeds.MRQ-123.test.ts`) give the plan's step 4 a clear template to follow.

## 3. Issues

**[MINOR] Step 3 — Organizer flag reuses attendee copy instead of organizer language**
The plan says it will "flag a candidate with no on-stage role as `Speaker to be announced`". The task frames the organizer half differently: a published session with no on-stage participant is *usually a mistake the organizer would want to know about*. Printing the attendee-facing placeholder in the publish review list reads as informational, not as a warning — the organizer scanning `PublicationCandidateRow` (currently `publicationSpeakerLine` at `src/ui/agenda/AgendaPage.tsx:204`, which prints the submitter's name with no hint they are off-stage) needs to learn that *this specific card will publish without a speaker on it*.
**Recommendation:** Use organizer language on the candidate row, e.g. "No on-stage speaker — publishes as 'Speaker to be announced'", and honor the task's "a line and a count" framing (a count of affected candidates in the review step is cheap since the roles are already in the payload). Also note explicitly on the ticket that the candidate list only enumerates *unpublished* sessions (`item.is_published = 0`), so the already-live defective session is fixed only on the attendee side — that matches the task's scope ("before attendees do"), but say it rather than leave it implicit.

**[MINOR] Steps 1–4 — No files or functions named**
The plan describes surfaces, not code. All four touch points are single, findable functions (listed in the Summary above), so this costs little here, but naming them would have made the "both embed layouts" phrasing precise: the cards/list layout toggle actually belongs to the *speakers* embed kind, while both session-bearing embed kinds route through the one `speakerCredits` function. The implementer should not go hunting for a second session renderer — there isn't one.
**Recommendation:** Anchor the implementation to `SpeakerLine` (`PublicAgendaPage.tsx:537`), the detail Speakers block (`PublicAgendaPage.tsx:931`), `speakerCredits` (`EmbedPage.tsx:271`), and `PublicationCandidateRow`/`publicationSpeakerLine` (`AgendaPage.tsx:204`).

**[MINOR] Step 5 — "Fails on main" verification mechanism not stated**
Acceptance requires the regression test to fail on `main` and pass on the branch, and the plan runs tests only on the branch. Since `git stash` is banned repo-wide, the cheap mechanism is to commit the test before the fix (test-first, run once red), or to check out the pre-fix source file into the worktree with `git checkout <main-sha> -- <paths>` for one red run.
**Recommendation:** Write the regression test first, record the red run on the ticket, then implement — that produces the fails-on-main evidence as a natural byproduct.

**[MINOR] Step 1 — Home for the shared label unstated**
"One shared public speaker-empty label" is the right call, but it will be imported by `PublicAgendaPage.tsx`, `EmbedPage.tsx`, and (per the recommendation above, in derived form) `AgendaPage.tsx`.
**Recommendation:** Export the constant from `src/lib/participants.ts` next to `SPEAKING_PARTICIPATION_ROLES` — it is the module that owns the audience concept whose empty case the label names, and UI files already import from `src/lib`.

## 4. Positive Observations

- **The plan holds the line the task drew.** The single most dangerous move here — "fixing" the defect by widening `SPEAKING_PARTICIPATION_ROLES` or leaking the `program` audience to the public — is explicitly renounced, and step 2 restates it as a preservation requirement. That directly satisfies the third acceptance criterion.
- **Step 3 is well-judged.** Using the role field already present in the publish-candidate payload keeps the organizer half to a pure rendering change — no schema, no API, no migration — exactly the "keep this small" instruction, and my verification confirms the payload really does carry it.
- **The session detail page is included** even though the judges only saw the agenda card and embed. It has the identical `—` defect, and fixing it in the same pass with the same label is the difference between closing the defect shape and closing two of its instances (round 4 already showed this shape recurs when fixed piecemeal).
- **Geometry awareness (step 2)** shows the plan read the project's "elements never jump" rule rather than just the ticket; the existing `min-height` on `.public-speakers` means this lands with near-zero risk.
- **Step 5 respects the fleet rules** — serialized gate, commands recorded on the ticket, one PR.
