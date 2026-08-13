# Plan Review: MRQ-138 — The organizer's Speaker files panel ships as an empty placeholder

## 1. Verdict

**FAIL (plan-level)** — The plan document is a verbatim copy of the task description with a title line added. It contains no implementation plan: no decision on the design fork the ticket explicitly poses, no approach, no file inventory, no acceptance criteria, no test plan. The task should return to `in_planning`.

**Process note for the orchestrator:** the repo already contains a branch `mrq-138-speaker-files-panel` and a commit on `github/main` — `2dfd378a "MRQ-138: build the organizer's speaker files panel (#125)"` — so an implementation for this ticket appears to have been built and merged while this plan review was pending. Reconcile the pipeline state before acting on this verdict; if PR #125 is the accepted resolution, this review gate is moot and the finding shifts to "plan artifact was never authored," which is worth a board note rather than a re-plan.

## 2. Summary

I reviewed the MRQ-138 plan against the task description and the live source at sha `75b871d94c6f` (the placeholder at `src/ui/speakers/SpeakerRecord.tsx:204-205` is confirmed present at that sha, and the two-file-system split the ticket describes is real — profile headshots live in the uploads/media system while /files reads only deliverables). The diagnosis embedded in the document is excellent, but it is the *ticket's* diagnosis, restated: nothing in the plan section commits to an approach, decides the ownership question the ticket explicitly asks the planner to decide, or defines what "done" looks like. As submitted, an implementer would be making every consequential decision at code time — exactly what plan review exists to prevent.

## 3. Issues

**[CRITICAL] Entire plan — No plan content; the document is the task description restated**
Lines 36–53 of the plan are byte-for-byte identical to the task description (surface, what breaks, root cause, board note, fix shape, urgency, size, provenance). There is no proposed approach, no sequence of steps, no decomposition. A plan that restates the problem provides zero de-risking: none of the checklist categories (completeness, feasibility, risk, AC coverage) can even be evaluated because there is nothing to evaluate against.
**Recommendation:** Author an actual plan: chosen approach with rationale, ordered implementation steps, files to be created/modified, API surface changes, test additions, and verification steps (including a live-surface check, since this defect was found by sbek driving the deployed site).

**[CRITICAL] Fix shape — The design fork the ticket poses is left undecided**
The task description explicitly instructs: "Decide which of the two file systems owns profile photos — today they are separate and only the deliverables one is surfaced." This is the load-bearing decision — it determines whether the work is (a) a read-only panel in `SpeakerRecord.tsx` joining uploads + deliverables for one speaker, or (b) a data-model change folding profile photos into deliverables so `/files` sees them (which touches counts like "Received 0 of 159", task semantics, and possibly migrations). The two options differ enormously in blast radius, and the plan chooses neither.
**Recommendation:** The plan must state the choice and its rationale. Option (a) — render both sources in the Speaker files section without merging the models — matches the ticket's "medium" size, avoids redefining what a "file task" means on /files, and is reversible; option (b) is a schema/semantics change that should be its own ticket if chosen. Whichever is picked, the plan should say what happens to the other surface (e.g., does /files stay deliverables-only by design, and is that documented?).

**[MAJOR] Missing — No file inventory or API design**
The plan names no files. At minimum this work plausibly touches: `src/ui/speakers/SpeakerRecord.tsx` (replace the self-closing section), a new or extended API route to list a speaker's files with filename/uploader/timestamp (the speaker-record data payload today has no such list), the serve/download path, CSS for the panel, and tests. The placeholder's own comment ("it owns the serve path and the render") says the serve path is part of the deliverable, so the API surface is not optional detail.
**Recommendation:** Enumerate created/modified files and the shape of the listing endpoint (fields: filename, uploader identity, uploaded-at, download URL; auth: organizer program-read scope).

**[MAJOR] Missing — Download semantics must respect the existing serve-path policy**
The uploads layer is deliberately restrictive: `src/routes/uploads.routes.ts` serves only ready raster images inline (`serveInlineImageObject`), routes arbitrary content through the separate media origin (`serveMediaObject`), and 404s everything else — with comments stating the media origin is "the only place arbitrary uploaded content is downloadable." The ticket asks for organizer *download* of speaker uploads (which can include PDFs etc.). A plan that doesn't address how download works inside this policy risks either a blocked implementation or a security regression that bypasses the media-origin boundary.
**Recommendation:** The plan should specify that downloads go through the existing media-origin path with organizer program-access checks, and explicitly rule out serving arbitrary content inline from the app origin.

**[MAJOR] Missing — No acceptance criteria or test plan**
The description implies concrete, testable outcomes: (1) the Speaker files region on /roster?person=… lists the portal-uploaded headshot with filename, uploader, timestamp, and a working download; (2) the region is no longer an empty labelled section announced to assistive technology; (3) a decision artifact exists for profile-photo ownership. None are stated as ACs, and no tests are planned. Given the 45s suite / 120s gate budgets, the plan should also say which tier the new tests land in.
**Recommendation:** Write the ACs into the plan, add Vitest coverage for the listing endpoint and auth scoping, and include a rendered-panel check (component test or Playwright) so the empty-placeholder regression can't recur silently.

**[MINOR] Missing — Empty-state behavior for the section**
For a speaker with no uploads, the plan should decide between an explicit empty state ("No files yet") and omitting the section. Shipping another childless `<section aria-label="Speaker files">` for empty speakers would recreate the original a11y defect for a subset of records; DESIGN.md's fixed-position rules also favor a reserved empty state over a disappearing region.
**Recommendation:** Specify an explicit empty state; never render a labelled region with no content.

**[MINOR] Board note — MRQ-112 linkage carried into the plan without a guard**
The plan repeats the note that MRQ-112 closed with the placeholder in the tree, but doesn't add the corresponding implementation guard: remove or update the "Reserved for MRQ-112" comment when the panel lands, so the tree stops pointing at a closed ticket as the future owner.
**Recommendation:** Include comment cleanup in the plan's file changes.

## 4. Positive Observations

- The diagnosis itself is exemplary: exact surface, exact file and line, root cause confirmed against the live sha rather than assumed from the repo, and honest board-accuracy accounting for MRQ-112. My spot-check confirms every claim — the self-closing section is present at `75b871d94c6f` exactly as quoted, and the profile-photo/deliverables split is real in `src/db/schema.ts` and `src/routes/uploads.routes.ts`.
- The urgency framing traces to a named PHILOSOPHY.md principle ("the system does the chase work") rather than vibes, and provenance is recorded down to the sbek run and defect index. That discipline is worth keeping.
- The ticket's fix-shape section correctly identifies the one decision that matters (which system owns profile photos) instead of prescribing a surface-level patch. The plan just needs to actually make that decision.
