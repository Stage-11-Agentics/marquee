# MRQ-89: Replace the Marquee Worker's account-wide R2 key with a bucket-scoped credential

ACCEPTED DEBT, taken knowingly at deploy time (operator ruling, Atin, 2026-08-11: "we're fine to use that key for the time being and then we'll clean it up. Just be sure that it's clear"). This ticket IS the clarity.

WHAT SHIPPED. The deployed Marquee Worker holds R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY set from CLOUDFLARE_R2_ACCESS_KEY_ID / CLOUDFLARE_R2_SECRET_ACCESS_KEY in code/platform/.credentials/.env. That credential is the shared Stage 11 platform S3 key with **Account -> R2 -> Admin Read & Write**, i.e. account-wide.

WHY IT MATTERS. Marquee's whole job on that credential is accepting ANONYMOUS PUBLIC UPLOADS from a CFP form. The key it holds can read, overwrite and DELETE every other bucket in the Projects account — today that is acetate-releases (Acetate's production updater artifacts), c11-public-videos and stage11-expandedcinema. Blast radius crosses into two unrelated projects that have nothing to do with this conference.

IT ALSO CONTRADICTS AN EXISTING REQUIREMENT: MRQ-14's real-Cloudflare handoff explicitly asks to 'provision least-privilege S3 vars/secrets'. This is not new scope; it is an unpaid part of MRQ-14 carried by MRQ-57.

THE FIX (~10 minutes, needs the dashboard). R2 -> Manage API tokens -> Create token, Object Read & Write scoped to the marquee-media and marquee-media-preview buckets ONLY. Then: wrangler secret put R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY against the marquee Worker, redeploy, and re-run an upload end to end. No code change — the Worker reads both off env and does not care where they came from.

ALSO ROTATE-WORTHY WHILE HERE: MARQUEE_CLOUDFLARE_API_TOKEN (cfut_..., minted 2026-08-11, expires 2027-06-03) was pasted into a chat transcript at creation. Same house precedent as the keys.txt entries. Harmless for a demo; rotate before Marquee carries real conference data.

## Execution plan

1. Establish the live baseline from the main checkout without disturbing its existing dirty deploy-agent state. Refresh `github/main`, create the isolated sibling worktree `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-89-bucket-scoped-r2` on branch `mrq-89-bucket-scoped-r2`, and compare the deployed `/health` build identifier with the current `github/main` build.
2. Investigate the account-owned Cloudflare API-token route using the credentials supplied in `code/platform/.credentials/.env`. Query the R2 permission group and bucket resource syntax, create one account token allowing Object Read & Write only on `marquee-media` and `marquee-media-preview`, and retain only non-secret identifiers/evidence. Test the proposed derivation by signing a real S3-compatible request against an allowed bucket; a 200 is required before using the pair. If the API route or derivation fails, stop the credential path, raise a one-line c11 flag, and hand the operator the exact dashboard path and selections instead of guessing.
3. With the proven pair held only in process memory, set `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` on the existing `marquee` Worker using `wrangler secret put`, then redeploy from the clean branch cut at current `github/main`. Do not rotate `MARQUEE_CLOUDFLARE_API_TOKEN` without explicit operator approval; record its chat-transcript exposure as a follow-up.
4. Validate the deployed origin, not a local stub: health/build identity, public CFP form upload end to end, and the new S3 credential's access to both Marquee buckets. Attempt a read-only listing/head against `acetate-releases`, `c11-public-videos`, and `stage11-expandedcinema`; record denial and do not write, delete, or otherwise mutate any foreign bucket.
5. Run only the mandated local gates from the isolated worktree (three `tsc --noEmit` passes, `npx vite build`, `npm run check:design`, `npm run check:api`, `npm run trace:ac`, plus repository secret-policy checks as appropriate). Do not run the full suite. Commit only non-secret scoped deliverables, push the branch, open the GitHub PR against `main`, record exact-head/CI/deployed evidence on MRQ-89, and report the PR to `workspace:9` / `surface:261`.

## Acceptance evidence to record

- Token creation response proves exactly two allowed bucket resources and Object Read & Write; no account-wide R2 admin permission.
- Derived S3 pair signs a real 200 request to `marquee-media` (and preferably the preview bucket) without printing either secret.
- Deployed public CFP upload succeeds end to end after redeploy.
- Read-only attempts against all three unrelated buckets are denied, with no mutation and a positive control against an allowed bucket.
- Deployed Worker build identity is explicitly compared with `github/main` and any MRQ-81 freshness change is called out.
- `MARQUEE_CLOUDFLARE_API_TOKEN` rotation is reported as deferred pending Atin's instruction.
