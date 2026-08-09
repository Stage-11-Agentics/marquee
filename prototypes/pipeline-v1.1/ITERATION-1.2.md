# Iteration v1.2 — complete the prototype (client-directed)

**Edit `prototypes/pipeline-v1.1/index.html` in place.** Keep the visual language, IA, and everything that works — this is completion, not redesign. `prototypes/PROTOTYPE-CONTRACT.md` remains binding (badge, vocabulary, data scale, elements-never-jump).

**Your per-screen brief is `SPEC.md` §5** — it specifies all 24 screens against AC IDs. `sequence/USER_STORIES.md` holds the AC text. Follow them exactly; where the spec and the current prototype disagree, the spec wins for the new screens and the prototype wins for the existing 12 (flag any real conflict to the orchestrator rather than silently choosing).

## The rule inverts

v1.1 allowed "Prototype — not wired" toasts. **v1.2 allows none.** After this pass every control does something real on the mock data. Client directive: no screen may exist only in the spec.

## Work list

1. **Build all 12 §5.13 screens** for real: global search results overlay (⌘K), admin submission record `/submissions/:id`, admin create `/submissions/new` (abstract/session + bypass toggle), the un-accept cascade dialog (enumerate affected tasks/emails/invites, cancel-or-retain each), comms center `/comms` (templates, triggers, outbox log with rendered previews), task templates `/settings/tasks`, Sessionize importer `/import` (upload → column-map preview → run → per-row outcomes → undo, mocked file), Settings→Airtable (both row counts, last sync, outbox depth, Sync now with live log), Settings→API tokens, API docs page, AI assist panel (off by default, absent from demo path), and honest empty-install states for every route (a toggle or `?empty=1` to preview them is fine).
2. **All five agenda views at full fidelity** — client asked specifically: **List as a real line-item view** (dense rows: time, title, speakers, track, room, format; sortable) and **Day/Week as real calendar grids** (time gutter, room or track columns per spec §5.11), equal in finish to the Track swimlane. Filters and scroll position survive every view switch.
3. **Event Settings affordances real** (§5.3 note): add/edit/reorder for formats, tracks (drag reorder, color), rooms (name + integer capacity); venue + timezone fields live, with the timezone note.
4. Breaks placeable in any room lane from the agenda (the space-reservation affordance).

## Verification gate

Playwright pass over **every** §5 route including the 12 new ones and the empty states; assert no toast remains anywhere (grep the DOM for the toast copy after clicking through); no JS errors; the 11-step loop still passes. Then print exactly: `PROTOTYPE READY v1.2: prototypes/pipeline-v1.1/index.html` + a 3-bullet summary.
