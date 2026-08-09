# Running-system validation — MRQ-6

Commit: 2402156f225f46555279677cb3d9857e1d713a50
Verdict: PASS

- Started the Cloudflare Vite development server on loopback and observed `/health` return HTTP 200 with `{"service":"marquee","status":"ok"}`.
- Headless Google Chrome at 1440x900 rendered all 17 navigation links; measured the sidebar at 224px and topbar at 52px.
- Clicked Accepted and observed History API URL `?status=accepted` plus the Accepted page heading.
- Clicked Event switcher and invoked `/`; both produced accessible dialogs and closed with Escape.
- Resized to 375x812 and measured the fixed bottom navigation rail at 54px and bottom 0px.
- Browser console/page errors: 0.
- Final local gate: PASS in 9.871s. Hermetic default test: PASS in 3.579s, 12 tests, zero skips.

Observed proof is limited to the shared shell and harness surfaces owned by MRQ-6; feature modules remain honest empty states for their owning tickets.