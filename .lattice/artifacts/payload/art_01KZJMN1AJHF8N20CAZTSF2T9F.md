# Plan Review: MRQ-14 — Uploads: presign, verify, and serve

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

Reviewed MRQ-14's planning-only plan against the ticket description, `SPEC.md` §3/§4/§5.4/§5.5, `EVALUATION.md` rows for AC-52/AC-146–148/AC-231/AC-232, `BUILDPLAN.md` §4/§7/§10, the ticket map, and the *actual* merged-candidate code in the MRQ-1 and MRQ-2 worktrees. The plan is unusually thorough on threat model, trap prevention, and the local-versus-real-bucket boundary — it is the best-argued upload plan I would expect from this fleet — but it was written against the contract prose rather than against the dependency code, and three of its load-bearing assumptions are contradicted by what MRQ-1 and MRQ-2 actually ship.

The key concern: the plan's step-3 "create one `pending` attachment row" cannot execute against `migrations/0001_init.sql` as written (`sha256 TEXT NOT NULL`, and an `owner_type` CHECK with no value for a submission/draft supporting file), and the plan resolves a Tier A guardrail question — whether Turnstile gates *authenticated* presigns — unilaterally and in the direction that breaks the speaker portal and the agent-native API. MRQ-1 and MRQ-2 are both still open, so every one of these is cheap to fold in now and expensive after they merge.

## 3. Issues

```
**[CRITICAL] "Request and object lifecycle" step 3 / "complete.ts" — `attachments.sha256 TEXT NOT NULL` makes the pending-row insert impossible and contradicts the bounded-read design**
The merged-candidate schema at `Marquee-worktrees/mrq-2-schema/migrations/0001_init.sql:106-122` declares `sha256 TEXT NOT NULL`. The plan inserts the `pending` row at presign time — before any bytes exist — so there is no checksum to write and the insert fails the constraint. Worse, the plan's completion path promises to "atomically mark the D1 row `ready` with verified MIME/size/checksum data" while simultaneously requiring "bounded ranged reads ... without buffering a large object in Worker memory." Those cannot both hold: a real SHA-256 over a 100 MB object means streaming the whole body through the Worker, which is exactly the CPU/memory cost the direct-to-R2 architecture (SPEC §1, seams §6.2) exists to avoid. A browser SigV4 PUT signs `UNSIGNED-PAYLOAD`, so R2 will not have a SHA-256 to hand back on HEAD either — only an MD5-shaped ETag for non-multipart puts. This is a first-INSERT blocker, not a late-integration nit.
**Recommendation:** Pick one and write it into the plan before implementation: (a) amend M-02 while MRQ-2 is still open to make `sha256` nullable (cheapest — MRQ-2 is mid-flight per run-state:31); (b) redefine the column's contents as R2's ETag with a documented rename/comment, and say so in `complete.ts`; or (c) stream-hash on completion and state the object-size ceiling at which that is affordable plus its CPU budget. Do not leave this to the implementer to discover on the first `INSERT`.
```

```
**[CRITICAL] "Request and object lifecycle" step 1 — no `owner_type` exists for a public/submission supporting file, so MRQ-15 and M-07's file lifecycle have nowhere to write**
The plan enumerates exactly the four SPEC values (`person_headshot`, `task_upload`, `event_logo`, `import_file`), and `0001_init.sql:109-111` hard-enforces them with a CHECK. But SPEC §5.4 puts an "optional supporting file" on the baseline CFP form, SPEC §5.5 requires a resumed draft to restore "all completed values **and files**", and M-07's own planned contract (`.lattice/plans/task_01KZJHM831WTD0XSD2Q84NVJC7.md:135`) freezes `GET/POST/PATCH/DELETE .../submissions/:submissionId/files`. None of those has a legal `owner_type`. MRQ-14 is the substrate for all three; if it ships with only the four enum values, MRQ-15 (Tier A, AC-30–AC-42) discovers the hole at implementation time and has to renegotiate a CHECK constraint inside a merged migration.
**Recommendation:** Name the mapping explicitly in the plan. Either add a `submission_file` (and, if drafts predate the submission row, `draft_file`) value via a `migrations/0002_mrq-14.sql` — which §7's shared-file rule permits, "every later change is its own `000N_<ticket>.sql`" — or amend M-02 now while it is open, or state in writing which existing value covers a draft field file and why. Also confirm what `owner_id` points at for a draft that has no submission row yet.
```

```
**[MAJOR] "Request and object lifecycle" step 1 — applying Turnstile to speaker/admin/API presigns over-reads AC-231 and breaks two other surfaces**
The plan says: "because the ticket says every presign, the handler also applies the merged Turnstile presign policy rather than inventing an exemption." The contract does not say that. SPEC:42 scopes the gate to "every public write **that a stranger can originate**"; SPEC:445 spells the gated set as draft creation, submit, and every presign *in that public context*; SPEC:362-364 attaches Turnstile only to `/api/v1/public/...`, while SPEC:369 lists `POST /me/uploads/sign|complete` under authenticated speaker scope with no challenge. M-07's plan:237 states the same division — "public form presign/complete adds Turnstile and public keying; `/me/uploads/sign|complete` adds speaker ownership." A Turnstile requirement on the authenticated paths breaks AC-52's portal headshot upload (a logged-in speaker would face a challenge per upload) and makes scoped bearer tokens (AC-105–AC-108, AC-242, M-29) unable to presign at all, since a headless API client cannot solve a challenge. Note that AC-231's own EVALUATION row (line 216) explicitly warns against "the literal per-write reading, which would break AC-41" — the same reasoning applies here, and this plan takes the literal reading anyway. AC-231 is in the Tier A no-waiver set, so this is not a call for the delegator to make alone.
**Recommendation:** State the rule as: Turnstile gates presigns on the public/unauthenticated surface; session- and bearer-authenticated presigns are gated by principal + scope + KV caps instead. Cite SPEC:42/362-369 and M-07 plan:237 as the basis, and route the ruling through the Orchestrator so A-7 (MRQ-49) audits against a decided contract rather than re-litigating it.
```

```
**[MAJOR] "Planning-only boundary" bullet 4 — the shared-file edits are treated as conditional; they are certain, and both owners are still open**
The plan says adding "extra runtime variable/secret names, or a cron/host dispatcher hook must be serialized ... if the merged M-01 scheduled handler still has no module hook, stop and coordinate." Checking MRQ-1 directly: `src/index.ts` exports `async scheduled(_controller, _env, _context): Promise<void> {}` — an empty body — while `wrangler.jsonc` already declares three crons including `"30 4 * * *"  // Nightly orphaned-upload sweep`. So there is no hook, guaranteed, and the handler will additionally need `controller.cron` dispatch to tell three schedules apart. Likewise the `Env` interface carries `MEDIA`, `CACHE`, `DB`, `TURNSTILE_*` and nothing else: `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_ORIGIN`, and the rate-limit HMAC secret all have to be added to `src/index.ts` and `wrangler.jsonc`, both M-01-owned. BUILDPLAN §7 promised "all bindings declared up front so no later ticket needs to touch it," and for R2's S3 API that promise was not kept. "Stop and coordinate" mid-implementation costs a round trip on a ticket estimated at 5 h; MRQ-1 is at `review` right now, which is the cheapest possible moment.
**Recommendation:** Convert bullet 4 from a contingency into a pre-RESUME action item: file the exact `Env` additions, the `wrangler.jsonc` secret/var names, and the `scheduled` dispatch seam with the Orchestrator now, ideally landing them inside MRQ-1 before it merges. List the names verbatim so MRQ-57's checklist and MRQ-1's edit agree on spelling.
```

```
**[MAJOR] "Architecture and owned files" / serve.ts — serving on a second hostname needs a wrangler route AND an `assets.run_worker_first` entry, which the plan never mentions**
MRQ-1's `wrangler.jsonc` binds exactly one custom domain (`marquee.stage11.dev`) and configures `assets` with `not_found_handling: "single-page-application"` plus an explicit `run_worker_first` path allowlist. A media route served by the same Worker on a different hostname needs (a) a second `routes` entry and (b) its path prefix added to `run_worker_first` — otherwise the static-asset layer answers first and, because of SPA fallback, returns `index.html` with a 200 for every media URL rather than the attachment-dispositioned object. That failure mode is silent locally if the test asserts only on the Worker handler and never through the asset pipeline, and AC-232's serving assertion is exactly what it would defeat.
**Recommendation:** Add both to the plan's serialized-edit list, and add a local assertion that the media path resolves through the Worker rather than the assets binding — i.e., an unknown media key returns a typed 404, not HTML.
```

```
**[MAJOR] "Acceptance and trace ownership" — AC-52 is an `e2e:` criterion split across two tickets, so no one writes the e2e**
The plan claims MRQ-14 "owns the ... focused `trace:ac` claims for AC-52" while "AC-52's eventual portal crop-preview browser observation is completed by MRQ-16." AC-52's EVALUATION row (line 258) is a single `e2e:` line covering upload, undersized rejection, *and* crop preview before save — one test, not two halves. MRQ-14 cannot write it (no portal UI exists at this ticket), so `trace:ac` would see AC-52 claimed by a ticket whose evidence is unit-level while the actual e2e sits unclaimed in MRQ-16. This is precisely the failure BUILDPLAN Amendment line 353 corrected for AC-146–148 and AC-155–157 by naming one owner each; AC-52 was left with two claimants (ticket-map:32 and :34) and this plan resolves it the wrong way.
**Recommendation:** Mirror the §353 pattern: MRQ-16 owns AC-52's test name; MRQ-14 records AC-52 as `exercises` in `tests/ac-claims/MRQ-14.json`, exactly as it already does for AC-146–148. Flag the swap to the Orchestrator so the ticket map is updated rather than the two plans disagreeing.
```

```
**[MAJOR] "MRQ-57 real-Cloudflare checklist" — AC-231's required real-Turnstile e2e is missing from the handoff**
AC-231's row (EVALUATION:216) requires "`e2e:` one pass against real Turnstile on the deployed preview, covering both the public write **and the upload-presign path**." MRQ-14 owns the presign half of AC-231 and cannot run that e2e locally (deploy is deferred to MRQ-57 per run-state:53), yet none of the seven checklist bullets mentions Turnstile — they cover R2 tokens, CORS, signing, HEAD, media host, Images, and the sweep. A Tier A no-waiver criterion would reach gate 18 with its e2e half owned by nobody. Note also that MRQ-1 already ships the always-pass Turnstile test pair, which makes it easy to believe this is covered when it is not.
**Recommendation:** Add an eighth checklist bullet: real Turnstile sitekey/secret configured on the deployed preview, one live presign challenged and passed, one missing/invalid token rejected 4xx with no presign issued. Name whether MRQ-14, MRQ-15, or MRQ-49 executes it once the preview exists.
```

```
**[MODERATE] "presign.ts" / lifecycle step 5 — `If-None-Match: *` is the sole mitigation for the overwrite race and cannot be proven before MRQ-57**
The plan leans on a signed `If-None-Match: *` for three separate guarantees: the HEAD/sniff-to-ready race, replay protection on a still-live bearer URL, and "a ready key cannot be replaced." The MRQ-57 checklist does ask for the 412 proof, which is the right instinct — but if R2's S3 endpoint rejects or silently ignores the conditional, or if bucket CORS cannot be configured to allow the header on a browser PUT, then every upload fails in production (header rejected) or the race reopens (header ignored), and both discoveries land after the code is merged, near the Wed 2026-08-12 deadline. Miniflare cannot distinguish these outcomes.
**Recommendation:** State the fallback in the plan, not after the probe: random unguessable keys plus 10-minute expiry plus "a `ready` row is never re-completed" (conditional D1 narrowing, which the plan already has) is a defensible second line if the conditional turns out unusable. Also add the browser-side CORS consequence explicitly — `If-None-Match` must appear in the bucket's allowed request headers or the preflight fails — and consider proving the R2 behaviour in a five-minute curl against the real bucket as MRQ-57's *first* upload item, so a failure is cheap.
```

```
**[MODERATE] "images.ts" — the Cloudflare Images mechanism is unnamed, and the two candidates have different enablement and URL contracts**
"Stable headshot derivative URLs/config for Cloudflare Images over the R2-backed media origin" does not say whether variants come from `/cdn-cgi/image/...` on a transformations-enabled zone or from a Worker subrequest with `fetch(url, {cf: {image: {...}}})`. They differ in zone enablement, billing, whether the media hostname must be proxied through the same zone, and what the URL looks like — and MRQ-16 has to build its crop preview against whichever URL contract this ticket freezes. The plan also sets a blanket rule in `serve.ts` that responses "force `Content-Disposition: attachment`"; variants must not inherit that if MRQ-16 renders them, and the plan's one-line carve-out ("raw originals retain attachment disposition") leaves the variant response headers unspecified.
**Recommendation:** Name the mechanism and the exact variant URL shape in the plan so MRQ-16 can code against it, and specify the variant response's `Content-Type`/`Content-Disposition`/`nosniff` triple separately from the raw-object rule. Add the chosen mechanism's enablement step to the MRQ-57 checklist bullet, which currently says only "enable/configure Cloudflare Images transformations."
```

```
**[MINOR] "upload-client.ts" — browser code colocated with signing code risks bundling secrets-adjacent modules into the client**
`src/lib/r2/` holds the SigV4 signer, the HMAC completion-token logic, and the KV policy alongside a `XMLHttpRequest` helper meant to run in the browser. A stray shared import (a policy constant, a type barrel, an `index.ts` re-export) pulls Worker-only code into the client bundle. The consequence is not just size — it is a signer and secret-reading module shipped to a public page in a repo that is itself public.
**Recommendation:** Put the client helper under the UI tree (e.g. `src/ui/upload/upload-client.ts`) or a clearly client-only file, forbid a barrel `index.ts` in `src/lib/r2/`, and add a build-time assertion that the client bundle contains no reference to the signer module or any `R2_*` variable name.
```

```
**[MINOR] "Architecture and owned files" / Hours: 5 — nine modules plus a seven-part verification matrix plus a `wrangler dev` transcript is not a 5-hour ticket**
The plan enumerates policy, keys, presign, upload-client, sniff, complete, rate-limit, serve, images, orphan-sweep, the routes file, and colocated tests across six test groups. The sniffer alone (PDF, PNG IHDR, JPEG bounded SOF scan, WebP RIFF, PPTX and KEY ZIP central-directory manifest checks, plus adversarial fixtures) is a meaningful chunk of the budget. The estimate is the ticket's, not the plan's fault, but an implementer who takes the 5 h literally will cut the sniffer or the sweep.
**Recommendation:** Note the estimate risk in the plan and name what gets staged if time runs short — the orphan sweep and the Images variants are the two most deferrable, and both have downstream owners (MRQ-57 proves the sweep; MRQ-16 needs the variants).
```

```
**[MINOR] "Local verification before review" — the fixture matrix must not cost the 30-second `npm test` budget**
EVALUATION pins `npm test` at ≤30 s and BUILDPLAN reiterates it from the first commit. A magic-byte suite is trivially fast if fixtures are byte-crafted headers, and quite slow if it commits real PDFs, PPTXs, and Keynote files and streams them through Miniflare's R2.
**Recommendation:** State in the plan that all sniffer fixtures are constructed in-test as minimal byte arrays (valid header + minimal ZIP central directory for the container cases), with no binary fixtures committed. This also keeps a public repo free of borrowed sample documents.
```

```
**[MINOR] "Request and object lifecycle" step 1 — `import_file` in the presign owner set may be scope creep**
`import_file` belongs to the CSV/import ticket, which is not a dependency of MRQ-14 and does not use a browser presign flow in the same way. Including it in the normalized owner set adds a policy branch and a test case for a consumer that does not exist yet.
**Recommendation:** Either drop `import_file` from this ticket's owner set and let the import ticket add its branch to the shared policy table, or state which ticket consumes it and why the shape is already known.
```

## 4. Positive Observations

- **The trap handling is exemplary and specific.** Trap 9 is not just acknowledged but made structurally impossible — "signing code has no custom-endpoint option," plus a static assertion parsing every returned URL's host, plus the rule that `MEDIA_PUBLIC_ORIGIN` appears only in read helpers. That is a defense a code reviewer can actually check, rather than a promise.
- **The local-versus-real-bucket boundary is the single best thing in this plan.** Given that the operator deferred all Cloudflare work to MRQ-57, the honest thing to do was exactly this: enumerate what fake SigV4 credentials and Miniflare *cannot* prove, and hand it over as a checklist with "none may be reported green from fake SigV4 values" stated in the open. The seven bullets are concrete enough to execute without re-deriving the design.
- **Ownership was reasoned about, not assumed.** The plan proactively cedes AC-146–148 to MRQ-24 with a clear rationale for why MRQ-14 still implements their upload half, and names the exact `trace:ac` test string for AC-231. Even where I disagree (AC-52, AC-232), the plan states its position explicitly enough to be argued with — which is the whole point of a plan review.
- **Fail-closed is the default throughout.** Turnstile and scope before any side effect; caps before the pending row; client MIME and extension treated as hints, never proof; deletion confirmed by `MEDIA.head(key) === null` rather than assumed from a successful delete call; unreadable or ambiguous containers rejected rather than passed. The zero-side-effect assertion list on the AC-231 test (zero rows, zero signer calls, zero R2 changes, zero KV consumption) is exactly the right shape for a Tier A guardrail.
- **The idempotency and retry story is thought through end to end** — 412-on-retry resolving through HEAD instead of re-uploading, repeated completion returning the same representation, replacement as a new key/version rather than a byte replace, and a sweeper that treats a missing R2 object as already deleted while refusing to drop the D1 row on a failed delete. These are the cases that normally surface as production bugs, and they were addressed before a line was written.
