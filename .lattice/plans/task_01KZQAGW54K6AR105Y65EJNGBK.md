# MRQ-62: Venue geography — access_note, the Venues screen, and a seed that can conflict

BUILDPLAN M-57 · ACs AC-255 – AC-257 · SPEC Amendment 14 · US-77.

Binding prototype: prototypes/pipeline-v1.1/index.html at v1.7 (drive it — every surface here is built and working there). Design reasoning: sequence/venue-map-ux.md.

BLOCKING SEED DEFECT THIS TICKET OWNS. scripts/seed/event.ts lines 151-152 seed Sheraton and the Workshop Annex at IDENTICAL coordinates (40.7625188, -73.9814528) with access_minutes 0 on both. MRQ-58's migration is correct and the seed is faithful to SPEC section 6 as written — and the consequence is that the Transit conflict class can never fire and the site map stacks two pins on one point. The feature would pass its tests and be inert in the demo. SPEC Amendment 14 supersedes section 6's 'without inventing a second real venue' clause for exactly this reason. Re-seed so at least two buildings are genuinely apart in space with a non-zero access time on one. Confirm the second venue's identity with the operator before inventing one.

Scope:
- Third migration adding buildings.access_note TEXT. 0002 is merged and immutable; this is additive.
- Move buildings AND rooms authoring to /settings/venues, beneath the site map their coordinates drive. Strip venue editors from /settings; leave a linking count. One shared writer behind both Save paths.
- Move the photo-ID/security sentence off its room note onto the building's access_note. Entrance instructions belong to the building; rooms inherit.
- Site map as a TILE MOSAIC, not a map library: plain <img> OSM rasters on a centre-clipped fixed-width plane, pins and walking lines drawn over. Fixed-aspect reserved box so arriving tiles never shift layout. Attribution visible. Tile failure degrades to pins over the graph-paper grid, never a blank box. No Leaflet, no CDN, no API key — the repo goes public.

Watch for: a handler bound only to the settings route leaves '+ Add building' inert on /settings/venues. AC-256 exists to catch exactly that.
