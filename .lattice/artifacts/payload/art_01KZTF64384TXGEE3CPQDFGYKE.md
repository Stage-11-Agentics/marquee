# MRQ-115 review — files library and version lists

**Reviewed commit:** `494e219` (branch HEAD, `mrq-115-files-library`)
**Reviewer:** delegator self-review (adversarial pass over the full diff).
**Fallback noted:** the auto-fired single headless reviewer (`lattice code-review`, pid 94299) **timed out after 600s** under fleet load (1-min load average 58, 5-min 134 at the time of the run). Per COMMON's timebox rule the review falls back to the delegator. This is a fallback, not a skipped gate — the pass below is a real read of the diff, and it is labelled as self-review so the Orchestrator can weigh it accordingly.

**Verdict: PASS**

---

## What was reviewed

`git diff github/main...HEAD` — 15 files, +1454/−9. New: `src/lib/files/versions.ts`, `src/routes/files.queries.ts`, `src/routes/files.routes.ts`, `src/ui/files/{FileVersions.tsx,FilesPage.tsx,files.css}`, two test files. Modified: `portal.routes.ts`, `PortalPage.tsx`, `portal.css`, `AppShell.tsx`, `route-table.ts`, `tests/unit/route-table.test.ts`.

## The adversarial question: what does this diff let a caller do that it should not?

**Read another speaker's files.** No. The library route is `program:read`-gated on the event (verified live: 401 unauthenticated, 403 as a speaker session). The portal path derives owner ids solely from `listTasks`'s person-scoped query, so a speaker can only ever ask for version lists of their own deliverables. Confirmed by test and by driving both sessions against a running Worker.

**Reach an object it should not.** The only URL minted is `publicMediaUrl`, which already existed and is already the sole outbound representation of a stored object. No new signing, no new bucket access, no widening of `uploads.routes.ts` (untouched, per file-ownership rule 3). The URLs are unauthenticated capability URLs — the diff does not hide that: `link_policy: "unauthenticated-capability-url"` on the API response, and `CAPABILITY_LINK_NOTE` rendered next to the control that produces one.

**See a version that is not really there.** No: `status = 'ready'` is a hard filter, so a presigned-but-abandoned upload is never counted. Verified live — two failed presigns from a botched first attempt sit in the local database against the same task, and both surfaces still report `version_count: 2`.

**Be told the wrong file is current.** This is the failure the module exists to prevent, and it is the one I attacked hardest. `is_latest` is computed per read from `speaker_tasks.attachment_id` (or `people.headshot_attachment_id`), never stored. The pointer wins even when it names an older upload — pinned by `MRQ-115 · is_latest follows the deliverable pointer even when the pointer names an older upload`, which fails if anyone ever swaps in a "newest wins" rule. Where no pointer column exists, the fallback is labelled `latest_source: "recency"` rather than silently passed off as authoritative, and that field is carried all the way to both UIs instead of being re-guessed there.

## Findings

1. **`src/routes/files.queries.ts:124` — unbounded row set (accepted, noted).** `listFiles` reads every file-kind task for the event and filters in JS. At the seeded scale (153 rows, 1000 submissions) the endpoint answers in 28–58 ms under a 1-min load average of 58 — measured, not assumed, and level with the existing `/onboarding` board (60 ms), which has the same shape. A conference an order of magnitude larger would want a SQL-side filter and pagination. Not a defect at this scale; recorded so the next person to touch it does not have to rediscover the ceiling.

2. **`src/routes/files.routes.ts:22` — empty `MEDIA_PUBLIC_ORIGIN` yields a malformed URL rather than an error.** `wrangler.jsonc:103` always supplies the binding and both the deployed Worker and local dev set it, so this is unreachable in practice. Flagged rather than defended-against because a guard here would have to either throw inside a read path or make `url` nullable across an interface three tickets are already consuming.

3. **`tests/unit/route-table.test.ts` — deliberate edit to a contract test.** The ordered sidebar assertion is the point of that test, so adding "Files" required changing it rather than working around it. Called out in the PR so the next ticket that adds a sidebar row expects the paired edit.

4. **No finding on the demo-seed disagreement — it is handled.** The seed marks some `Presentation Upload` tasks `status='done'` with `attachment_id NULL`. The library derives state from the file, not the flag, so those read as "Awaiting" while the chase board reads "done". Rather than paper over it, the row prints `marked complete, no file on record` (`FilesPage.tsx:72`). That is the exact state an AV lead must not discover on the day.

## Craft checks

- **Elements never jump:** fixed-width state chip (`min-width: 84px`), fixed-width copy control (`88px` — its label swaps between three strings), fixed-width expand control, tabular numerals on every changing number, em-dash placeholders instead of removed cells.
- **Tokens only:** no hardcoded colours; `check:design`'s scan is scoped to `components.css`, which this diff does not touch, but `files.css` holds to the same rule anyway.
- **Route naming:** `files.routes.ts` matches `_manifest.ts`'s glob, so the route enters the versioned public schema rather than arming a `check:api` parity failure later.
- **Honest empty states:** "No file has been requested yet" points at `/settings/tasks`; it never claims there are no files when the truth is that nobody has been asked for one.

## Tests

11 integration + 5 component + 1 route-table assertion, all green. They pin the rubric claims as behaviour (version count of 2, latest marked, prior version separately retrievable, portal names the filename) and the two rules most likely to be quietly broken later (pointer-derived latest, ready-only versions).
