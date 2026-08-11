# MRQ-15: Public CFP form

BUILDPLAN: M-14 — Wave 1 (§4), walkthrough step 5 · the judge's own path

Scope (verbatim): SSR form in builder order with the complete participant/profile/file/conditional path; client-blur + server-authoritative validation; drafts + emailed resume link + restored values/files; **Turnstile server-side before every write/presign**; real open, closed, at-limit, resumed, submitted, and re-opened states; confirmation email; 375 px pass. **The vendor conditional renders through M-12's `isFieldApplicable()` helper — it is an ordinary schema-driven field, never a hardcoded alternate form (SPEC §5.4/§5.5).** M-14 exercises **AC-132/AC-133** on the public surface; M-12 owns those IDs for `trace:ac`.

AC-231's gated set is draft creation, submit, and every presign; `PATCH …/drafts/:token` autosave requires **no** Turnstile token (that literal reading would break AC-41) but is rejected without a valid resume token and is rate-limited per token.
Felt checkpoint C3 reads this surface aloud: force every validation failure and every submit failure (5xx, Turnstile challenge failure, 429, dropped connection); no sentence may contain a field name, a type name, an error code, or "invalid" without a remedy.

File surface: `src/routes/public-form.route.tsx`, `src/ui/public/form/*`

ACs: AC-25, AC-26, AC-29, AC-30 – AC-42, AC-155 – AC-157, **AC-231, AC-234**
Hours: 8
Workflow: sub-agent-full (≥7 h)
Shared files: none — module-local. Consumes `src/lib/form-conditions.ts` (M-12's); add to it, never rewrite it.
Deps: M-12, M-11, M-13
Speed: AC-36 is an AC-sourced budget — public CFP form cold load → interactive p95 ≤ 1000 ms.
## Plan

### 1. Public-form data contract and routes

- Add a module-local public-form data/service layer that loads a published form,
  builder-ordered fields, lifecycle state, draft/resume state, and attachment
  metadata without exposing private records.
- Add generated-manifest API routes for `GET /api/v1/public/forms/:slug`, draft
  create, draft autosave, and submission. Keep the wire prefix under
  `/api/v1/events/...` unchanged elsewhere; public UI copy uses “conference”.
- Add the SSR `/f/:slug` route and mount it without changing the generated API
  manifest by hand. Verify every new API operation appears in the OpenAPI
  document and passes `check:api`.

### 2. Persistence and lifecycle rules

- On draft creation and submission, verify Turnstile before any database write.
  On autosave, require and authenticate the resume token, apply a per-token KV
  rate limit, and deliberately do not require Turnstile.
- Route every answer write through exactly
  `projectApplicableAnswers(fields, rawAnswers).answers`; never persist the raw
  request body, a hand-written filter, or a second applicability evaluator.
  Preserve the evaluator’s fail-closed behavior for the vendor conditional.
- Persist participants, tracks, files, draft hashes, submission answers, and
  outbox rows transactionally enough that rejected requests leave no new row
  or answer. Reuse the inherited upload and mail/outbox contracts, including
  `demo_safe` resume mail and the sole typed-address `always_live` confirmation
  writer.
- Compute and expose open, closed, at-limit, resumed, submitted, and reopened
  states as real state data. Closed and at-limit reads remain successful page
  loads; writes are rejected before persistence. Resume restores values and
  files and does not bypass the current limit or lifecycle checks.

### 3. SSR/client surface

- Render the form server-side in builder order, including participant/profile,
  file, and conditional fields. Render the vendor field through the shared
  `isFieldApplicable()` path as an ordinary schema field; no alternate form
  branch or vendor-specific requiredness check.
- Add client blur validation and server-authoritative submit validation. Keep
  entered values/files on every failure, focus the first actionable problem,
  and give a remedy in every validation, 5xx, challenge, rate-limit, and
  connection-failure message. Use “conference” in visible organizer copy.
- Add draft creation/resume-link behavior, debounced autosave with its
  last-saved indicator, upload sign/put/complete flow, confirmation state, and
  a 375px responsive layout with no horizontal overflow.
- Keep secrets and internal paths out of rendered state, HTML, logs, and source.
  Use local Turnstile/miniflare proof only; identify any real-infrastructure
  proof deferred to MRQ-57 in the PR body rather than claiming it locally.

### 4. Evidence and claims

- Add integration tests under `tests/` for the real submission path, including
  the required hidden-field POST and database absence assertion, missing and
  failed Turnstile with status plus zero-row assertions, autosave token/rate
  limiting, lifecycle states, restored files, confirmation/outbox behavior,
  tracks/participants, and OpenAPI registration.
- Add a contract test for the responsive/accessible public surface and name
  tests with AC tags. Add `tests/ac-claims/MRQ-15.json` owning only public-form
  ACs; list AC-132/AC-133 and AC-231 as exercised where appropriate, never
  owned by this ticket.
- Run self-review inline at the exact final HEAD; headless reviews are
  suspended. Run type checks, build, design/API checks, the full test suite,
  trace, local wrangler/miniflare request probes, and the genuine 375px pass
  within the approved local browser scope. Run and paste
  `npm run pr-gate -- --ticket MRQ-15` before opening the PR.

### Non-goals and guardrails

- Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`,
  `PHILOSOPHY.md`, or sequence contract files.
- Do not mint AC IDs, claim AC-132/AC-133 or AC-231, add a third
  `always_live` writer, call the mail provider directly, or fabricate deployed
  Turnstile evidence.
- Do not alter unrelated worktree changes. Commit logical slices, push the
  first commit immediately, and push every meaningful commit thereafter.

## Verification matrix

| Area | Evidence |
| --- | --- |
| shared conditional evaluator | integration POST with hidden vendor value; persisted answer absent and no hidden-required issue |
| write gates | missing/failed Turnstile status plus zero new rows for draft/submit; inherited presign coverage retained |
| autosave | valid resume-token authorization, per-token rate limit, no Turnstile requirement, no mutation on rejection |
| lifecycle | open/closed/at-limit/resumed/submitted/reopened API and SSR states |
| files and mail | restored attachment answer; draft resume is `demo_safe`; confirmation is only typed-address `always_live` |
| public UX | builder order, blur/server validation, failure remedies, focus recovery, 375px no-scroll check |
| delivery | `npm run pr-gate -- --ticket MRQ-15`, exact-head self-review, pushed branch, Forgejo PR against `master`, `pr_open` |

## Working notes flushed before implementation

- Current implementation base is `forgejo/master` at `f8e824d` after the
  required fetch/rebase. The original worktree cut was `394b632`; the newer
  base contains orchestration-only changes. The worktree and branch remain
  `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-15-public-form`
  and `mrq-15-public-form`.
- Intended product files are module-local: `src/routes/public-form.routes.ts`
  for generated API operations, `src/routes/public-form.route.tsx` for SSR,
  a public-form data/service module beside them, and
  `src/ui/public/form/*` for the Preact surface and responsive styles. Mount
  the SSR route from `src/index.ts`; do not hand-edit
  `src/routes/_manifest.ts`, which discovers `*.routes.ts`.
- API shapes decided: `GET /api/v1/public/forms/:slug` returns builder-ordered
  form/field/state/resume data; `POST /api/v1/public/forms/:slug/drafts`
  creates a draft and resume token; `PATCH
  /api/v1/public/forms/:slug/drafts/:token` autosaves without Turnstile but
  only with that token and a per-token KV limit; and `POST
  /api/v1/public/forms/:slug/submissions` submits the public response. Existing
  upload routes remain the presign/complete path.
- Every draft-create and submit handler will call
  `verifyTurnstile()` before the first database mutation. The presign gate is
  inherited from MRQ-14. Autosave is the sole no-Turnstile exception and must
  reject missing/wrong resume tokens and rate-limit before mutating. Tests will
  assert both rejection status and zero rows/zero mutation for missing or
  failed challenge tokens.
- The only answer persistence expression is
  `projectApplicableAnswers(fields, rawAnswers).answers` from
  `src/lib/form-conditions.ts`. The raw body, a manual hidden-field filter,
  and a second evaluator are ruled out. The vendor choice and vendor-product
  field are ordinary schema fields rendered using `isFieldApplicable()`; no
  hardcoded vendor form branch is allowed. The required integration test will
  POST a hidden vendor-product value while the condition is off, then query
  `submission_answers` and prove the value/key is absent and no required issue
  was returned.
- Lifecycle is data, not error copy: open accepts work; closed renders a 200
  read and rejects writes; at-limit renders the cap and rejects new work;
  resumed restores answer values and files; submitted renders confirmation
  and keeps its resume/confirmation state; reopened makes the same slug usable
  again without discarding existing drafts/submissions. Limit and close checks
  happen before writes.
- Draft resume mail uses the inherited demo-safe outbox path and a hashed
  resume token. Submission confirmation uses the existing public-form
  confirmation writer with `always_live` only for the address typed in that
  request. No direct provider call and no third `always_live` writer will be
  added. Attachments restored from draft answers will be re-owned on submit.
- The UI will preserve values and files across all failures, validate on blur
  and again on the server, focus the first actionable problem, and provide a
  remedy in copy for validation, 5xx, challenge failure, 429, and dropped
  connections. It will use “conference” visibly, retain exact wire API names,
  render server HTML in builder order, and keep the 375px path free of
  horizontal scrolling. Local wrangler/miniflare is the proof boundary; real
  deployed Turnstile proof belongs in an explicitly named MRQ-57 checklist.
- Evidence will include AC-tagged integration tests and
  `tests/ac-claims/MRQ-15.json`. This ticket exercises but does not own
  AC-132/AC-133, and does not own AC-231 (MRQ-14 owns that gate). Headless
  reviews are suspended; the final review artifact will name the exact HEAD.

## Rebased 2026-08-11 by agent:delegator-mrq-15

- The branch was rebased onto the current `forgejo/master` audit commit
  `ad1d047`; the original worktree cut was `394b632`.
