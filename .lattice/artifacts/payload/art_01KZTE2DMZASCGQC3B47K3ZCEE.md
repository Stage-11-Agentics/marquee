MRQ-122 exact-HEAD local runtime validation
Observed commit/build: 790cdce5afd8573b3a5b7ead5539ad7912a15ef0 / health build 790cdce5afd8
Environment: fresh local D1 seeded from this worktree, Wrangler dev on verified-free port 8795, local-only; not deployed evidence.

Observed pass: GET /health 200; GET /p/grace-isford?event=aie-ny-2026 rendered src=/headshots/grace-isford.svg; GET /p/aarush-selvan?event=aie-ny-2026 rendered initials AS with no /headshots URL; speaker embeds in cards and layout=list both rendered the static avatar; anonymous /api/v1/public/agenda exposed headshotUrl=/headshots/grace-isford.svg. Migrations and 9,976-row seed completed successfully.