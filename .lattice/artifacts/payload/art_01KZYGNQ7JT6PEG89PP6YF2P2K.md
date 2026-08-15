# MRQ-166 local import validation

Date: 2026-08-13
Branch: `mrq-166-require-speaker-email`
Build: `7141cb569c36`
Runtime: Wrangler dev / local D1 / `http://127.0.0.1:8792`

The README local recipe was exercised in this worktree: `npx vite build`, `.dev.vars` copied from the primary checkout and into `dist/marquee/.dev.vars`, local D1 migrations applied at `.wrangler/marquee-local-mrq166`, deterministic seed loaded, and Wrangler started with `INSECURE_LOCAL_COOKIES:1` and `LOCAL_UPLOAD_SHIM:1`.

Observed API proof with the seeded organizer session:

- `GET /health` returned `{"service":"marquee","status":"ok","build":"7141cb569c36",...}`.
- `POST /api/v1/auth/demo` with `{"role":"organizer"}` returned 200 for `evt_aie-ny-2026`.
- `GET /api/v1/events/evt_aie-ny-2026/submissions?per_page=1&page=1` returned 200 with `total: 1000`.
- Uploading a speakers CSV with headers `Name,Title` returned 201 and a preview naming `email` as missing. Posting its mapping returned 422 with:

  ```json
  {"code":"unprocessable","message":"speakers.email column is required before import","field":"speakers.email"}
  ```

- A mixed speakers CSV containing `Runtime Blank,,...` and `Runtime Speaker,runtime-speaker@mrq166.test,...` uploaded (201), mapped (200), and ran (200). The observed counts were `created: 1`, `failed: 1`, `speakers: 2`; the blank row was `failed` with reason `speaker email is required`, and the valid row was `created`.
- Re-running the same import returned `skipped: 1`, `failed: 1`, with no second created person.
- `GET /api/v1/org/people?q=Runtime&per_page=10` returned only `Runtime Speaker` with `runtime-speaker@mrq166.test`; no `speaker+...@example.invalid` speaker existed.

This validates the actual Worker route and D1 write path. It was API-driven; no deployment was performed.
