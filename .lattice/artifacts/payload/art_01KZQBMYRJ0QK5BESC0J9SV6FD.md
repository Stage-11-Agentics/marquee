Verdict: PASS
Validated commit: cd25b18b206cf3d72c21330b296480ec5973a057
Method: started the production build through Wrangler local dev on localhost:8791 with a fresh, migrated and seeded local D1 persistence directory; authenticated as the demo Organizer; called GET /api/v1/events/evt_aie-ny-2026/dashboard.
Observed: HTTP 200 in 12ms. Seven pipeline gauges returned submitted=0, in_review=280, waved=60, accepted=60, onboarding=58, scheduled=0, published=24. Scheduled note was exactly 'placed on the working agenda'; Published note was exactly 'live on the public site'. The response also returned three waves (32/32, 28/28, 0/55) and four speaker task previews.
Runtime logs: POST /api/v1/auth/demo 200 and GET dashboard 200.