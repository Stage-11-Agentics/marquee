# MRQ-72: Reset demo is broken end to end — dead button, minimal-fixture restore, cross-tenant wipe, R2 orphans

WALKTHROUGH-CRITICAL. MRQ-53's reset drill audit found four defects and, per audit discipline, fixed none of them. Read its findings first: they carry file:line and reproductions.

Two of them together are a walkthrough dead end. A judge who makes a mess and presses Reset demo gets NOTHING (the button is dead), and if they reach reset another way they get a HOLLOW demo (restore writes a minimal fixture, not the shipped seed). Reset is the judge's undo button; its failure only shows after someone has already invested twenty minutes, which is the cruellest possible time to discover it.

FOUR DEFECTS, in priority order:

1. DEAD 'Reset demo' BUTTON. src/ui/shell/Sidebar.tsx renders it via unavailable(...) — a placeholder that never calls the reset endpoint. Wire it to the real endpoint, with an honest confirm (this is destructive), a pending state, and an honest result. Elements never jump: reserve the space so the label change does not move the sidebar.

2. MINIMAL-FIXTURE RESTORE. Reset restores a minimal fixture rather than the shipped seed, so after reset the demo is hollow — no 1,000 submissions, no accepted core, no agenda. Restore must reproduce the seeded baseline a judge started from. Prove it by row COUNTS per table before and after, not by a 200.

3. CROSS-TENANT WIPE. Reset wipes rows it does not own. Single-tenant today makes it survivable, not correct. Scope the wipe to the demo event/org and assert an unrelated tenant's rows are untouched — counts before and after, with a positive control that the demo rows DID go.

4. R2 ORPHANS. Reset leaves uploaded objects behind. Either delete them under the demo prefix or document deliberately why not. An orphan store grows forever on a public deploy.

CONSTRAINTS. WIPE_ORDER stays FK-safe and MRQ-53's merged guard (tests/node/reset-wipe-order.test.mjs) asserts it covers every table every migration defines — do not weaken it; extend WIPE_ORDER if you add tables. Reset must leave demo login working; a reset that restores data but breaks the demo persona is still a dead end. Reset twice in a row must be as clean as once. Do not add a migration; 0001-0004 are merged and immutable and MRQ-66 owns 0005.
