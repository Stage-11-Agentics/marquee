MRQ-122 exact-HEAD self-review
Reviewed commit: 790cdce5afd8573b3a5b7ead5539ad7912a15ef0
Verdict: PASS

Scope reviewed: synthetic local SVG assets, demo-only headshotUrl projection, initials fallback, /p/:slug, and both speaker embed layouts.
Adversarial checks: no R2/uploads/media files changed; no external image requests or stock/AI faces in assets; is_demo remains projection-internal; public published-only query path is unchanged; fixed avatar dimensions reserve layout space; three intentional fallback slugs are explicit.
Findings: none.
Evidence: node --test tests/node/public-headshots.MRQ-122.test.mjs (1 passed); targeted Vitest unit/integration (15 passed); npx tsc --noEmit (pass); npm run check:api (pass); npx vite build (pass).