# MRQ-235 — People merge: identity aliases, movement receipts, and undo

## Plan status

- Lattice task: MRQ-235, task_01M03Q6F2VHG69FERNDK11BZDR.
- Actor: agent:delegator-mrq-235.
- Branch/worktree: mrq-235-people-merge at /Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-235-people-merge.
- Planning base verified against github/main: 52bb485f105e0392fe475332b87cbb48dbcee832.
- Binding prototype: prototypes/crm/index.html at 390d52dc, v1.17.
- Binding design language: DESIGN.md, Flight Deck / Day default.
- This is the plan-only head. Do not implement, run browser validation, write live data, deploy, merge, publish, or run the full gate until the Adoption Orchestrator returns a fresh non-author plan-review PASS and the required later approvals exist.
- Stable US and AC IDs remain unminted. Do not edit SPEC, EVALUATION, BUILDPLAN, USER_STORIES, or DESIGN in this work.
- Any implementation divergence from prototype v1.17 must carry an explicit SPEC marker during the ordered consolidation. Silent product judgment is not permitted.

## Binding product contract

The prototype is one-to-one for the shipped interaction and language.

1. The People directory retains the existing server-side query, filters, sort, pagination, and duplicate-name disambiguation. Duplicate names render ordinals such as Priya Raman (1) and Priya Raman (2), with a tooltip that points to Merge.
2. Exactly two selected rows expose the selection-bar action Merge…. The action is disabled for zero, one, or more than two selected rows. The drawer exposes Merge into another person… and opens a search picker for the other record.
3. The picker searches by name, email, or company, excludes the source record, and makes the organization scope explicit. Cross-organization and self-merge attempts are rejected with distinct, useful sentences. Agent-seat and human mixes receive an explicit policy sentence; they are never silently treated as ordinary human duplicates.
4. The merge dialog is the prototype shape: source and survivor cards, a default survivor with more conference connections, one-click override cards, an identity table, blank-field fills highlighted, tags unioned, movement counts, named collision statements before any write, a continuity sentence, and the statement that the operation can be undone. When names are identical, continuity is disambiguated by email, never by name.
5. The dialog and resulting receipt count the same material: participations, open tasks, messages, notes and tags, calendar invites, and named row collisions. The expandable movement preview names what is moving and what is kept, deduped, or dropped.
6. Retired sign-in links and portal access continue to land on the survivor. The email that leaves the people row becomes an org-scoped alias. A receipt id is printed for agents.
7. A successful action shows a toast with Undo and also creates a survivor activity-feed receipt with Undo while the receipt is clean. Undo is not toast-only.
8. The durable operation is atomic. A whole-row receipt records every moved, deduped, or dropped row and its snapshot. Undo is compare-and-set and explains skipped rows rather than overwriting later human edits.

## Scope and non-goals

In scope:

- One org-scoped merge domain for two human person records.
- Identity continuity through aliases, auth sessions, and person-bound magic links.
- Human-field backfill and the task-specified do-not-contact and JSON/tag policies.
- Every direct people foreign key, every named no-FK reference, every collision index, and the delete guard.
- Durable preview, execute, receipt, audit-feed entry, mirror outbox propagation, and CAS undo.
- The People directory, drawer, merge picker, compare dialog, toast, and activity receipt.
- Schema, migration housekeeping, import/delete guard coverage, API contracts, and integration/unit tests.

Out of scope:

- A second speaker or CRM table, event-scoped workflow state on people, or any adjacent CRM feature.
- Reworking existing search/filter/list architecture or adding client-side relationship state.
- Changes to unrelated imports, mirror settings, calendar workflows, sponsorship behavior, or portal UX except the precise person identity references required for this merge.
- Contract-document editing or stable ID minting in this delegator stage.
- Browser, live, deployment, merge, or publication work before the stated review boundary.

## Implementation order

### 0. Reconfirm moving boundaries before implementation

At implementation start, fetch github and verify the branch base. Inspect the live migration directory for the next free migration number; do not copy a historical number into the plan or implementation. Re-run that check after any rebase. Confirm that the branch still contains prototype commit 390d52dc and that the binding design files are unchanged.

Request a gate slot from mailbox merge-captain before any later full pr-gate run. No full pr-gate is part of this plan-only handoff.

### 1. Keep person-references.ts as the single inventory

Extend src/lib/person-references.ts, rather than creating a merge-only list. The inventory must be the source for both personReferences and noPersonReferencesPredicate, and a schema guard must fail when a future direct foreign key to people is absent from the inventory.

The current direct FK inventory is:

- memberships.person_id
- auth_sessions.person_id
- magic_links.person_id
- api_tokens.created_by and api_tokens.acts_as_person_id
- form_admins.person_id
- outbox.person_id
- submissions.submitter_person_id and submissions.decided_by_person_id
- submission_decisions.decided_by_person_id
- saved_views.person_id
- participations.person_id
- committee_members.person_id
- reviewer_track_scopes.person_id
- round_assignments.reviewer_person_id
- evaluations.reviewer_person_id and evaluations.override_person_id
- comparisons.reviewer_person_id
- round_promotions.promoted_by
- speaker_tasks.person_id
- calendar_invites.person_id
- audit_log.actor_person_id
- file_comments.author_person_id
- person_events.person_id and person_events.actor_person_id
- person_lists.created_by
- person_list_members.person_id
- event_attendances.person_id
- schedule_claims.person_id

The three live direct FKs missing from that current array must be added and tested:

- sponsorship_contacts.person_id
- speaker_tasks.completed_by_person_id
- mirror_credentials.set_by_person_id

This is an explicit 28-family reconciliation, not a new parallel inventory. The implementation check must compare the canonical list against the schema/migration truth and report table and column names when it fails. The merge service must update every listed column, including nullable actor, completion, override, token, and credential columns. The final retired-row delete remains behind the expanded noPersonReferencesPredicate.

One nearby field is deliberately not silently forgotten: calendar_cancellations.person_id is nullable and has no FK by design because cancellation jobs survive event cascades with a self-contained snapshot. It is not one of the five MRQ-235 movable no-FK references. Reconcile it explicitly in the guard/test decision and leave the durable cancellation job unchanged unless a later contract marker changes that decision.

### 2. Reconcile the five named no-FK references

The merge planner and receipt must account for exactly these five operational no-FK families:

1. forms.admin_notify_person_ids is a JSON array. Replace the retired id with the survivor, preserve stable order, and de-duplicate if both ids are present. Record the before and after row snapshots so undo only restores the array when the current value is still the merge projection.
2. The headshot pair is people.headshot_attachment_id plus the polymorphic attachment row where owner_type is person_headshot and owner_id is the person id. A blank survivor pointer is filled from the retired pair and the attachment owner is moved. If both have active headshots, retain the chosen survivor attachment, explicitly record the retired attachment as dropped with its complete row snapshot, and keep the R2 object untouched by this database merge. Undo may restore the dropped row only when the pointer and attachment state are still clean.
3. import_rows.target_id is rewritten only for rows in imports belonging to the same organization. Preserve the import row and its existing before/after manifest. imports.event_id is required and is never repurposed or nulled; the event relationship is not a permission to reuse an import receipt for a merge.
4. mirror_outbox.row_id is a polymorphic identity. Rewrite queued person-row references and emit the required unsuppressed survivor upsert and retired delete in committed order. Do not suppress these writes merely because the source row is being retired. Preserve queued payload snapshots and receipt rows so replay and undo remain inspectable.
5. audit_log entity rows with entity_type = person and entity_id equal to the retired id are re-pointed to the survivor so the survivor lens contains the complete history. Direct actor_person_id changes are handled by the canonical FK inventory, preserving the original actor meaning. Do not rewrite arbitrary entity ids for unrelated entity types.

No other polymorphic column may be guessed into scope. The implementation guard must name the five families above and the intentionally historical calendar cancellation decision.

### 3. Add schema for aliases and durable merge receipts

MRQ-235 mints schema only after the fresh migration-number check. Add an org-scoped person_aliases table whose unique key is org_id plus normalized email and whose target is the current survivor. Store the merge receipt association and timestamps. An alias must never point at a deleted retired row.

Add an org-scoped person_merges receipt table. It must retain:

- a loader-minted UUID idempotency key with a unique org-scoped replay boundary;
- the org, retired id, survivor id, lifecycle status, and timestamps;
- the complete retired person snapshot and the survivor-before snapshot;
- the exact post-merge survivor projection needed for CAS comparison;
- summary counters used by preview, execute response, and UI;
- the alias changes;
- per-row movement receipts with table, primary key, from, to, outcome (moved, deduped, or dropped), and complete row snapshot;
- undo outcome/skipped-reason data and the receipt activity identity.

Keep source/survivor historical ids available after the retired people row is deleted. The receipt is org-scoped and is not an event-delete child. Update WIPE_ORDER, DELETE_PLANS, schema registries, or copy manifests only where the existing housekeeping contract requires the new org-level tables. Do not make the merge receipt reusable as an event import receipt.

### 4. Identity and field merge rules

Resolve both records inside one organization before any write. Reject self-merge, cross-org access, missing records, an already retired source, and unsupported agent-seat/human combinations before constructing a batch.

The default survivor is the record with more conference connections, as in the prototype. The UI can override it explicitly. The selected survivor remains the people row. The retired email is an alias, not a second active people email. Insert aliases only after checking both directions against active people.email and existing aliases in the organization. A merge must reject an alias collision with a named email conflict rather than guessing.

findPersonForSignin must use the same org-scoped resolver for primary emails and aliases. Chained merges must flatten existing aliases to the new survivor: A to B followed by B to C makes old A and B sign-in emails land on C, with no alias pointing to a retired row. The resolver must be replay-safe and bounded against cycles.

Backfill only blank survivor human fields. Preserve the survivor's existing nonblank value when both records have a value and name the collision in preview. Keep the survivor email and add the retired email alias. OR do_not_contact. Union JSON/tag values conservatively and stably, without inventing arbitrary field semantics. Preserve every note and other historical event. All decisions appear in the preview before the action.

Re-point auth_sessions and every person-bound magic_links row to the survivor. Preserve purpose, event_id, expiry, used state, and token identity. The continuity sentence must say that old links and portal access continue to land on the survivor.

### 5. Collision matrix and whole-row policy

The primary person-keyed collision matrix is these 13 unique indexes:

1. uq_people_org_email — handled as the alias/active-email guard; never replace the survivor email.
2. uq_memberships_event — same org, event, and role keeps the survivor-owned row; a retired-only row moves.
3. uq_memberships_org — same org-level role follows the same rule.
4. uq_form_admins_form_person — retain the survivor-owned admin row and receipt the retired duplicate.
5. uq_saved_views_event_person_name — retain the survivor-owned named view; receipt the retired duplicate, including its config.
6. uq_participations_person_submission_role — retain the survivor-owned participation; a retired-only participation moves with all fields.
7. uq_committee_members_committee_person — retain the survivor-owned committee membership; receipt duplicates.
8. uq_reviewer_track_scopes_event_person_track — retain the survivor-owned scope; receipt duplicates.
9. uq_round_assignments_reviewer — retain the survivor-owned reviewer assignment; never confuse it with the committee assignment key.
10. uq_evaluations_round_submission_reviewer — retain the survivor-owned evaluation; receipt the retired duplicate as a whole row rather than merging score fields.
11. uq_calendar_invites_submission_person — retain the survivor-owned invite; a retired-only invite moves without changing uid, sequence, or cancellation state.
12. uq_sponsorship_contacts_sponsorship_person — retain the survivor-owned contact; a retired-only contact moves.
13. uq_event_attendances_person_event_source — retain the survivor-owned attendance; a retired-only attendance moves.

The secondary invariants must also be protected even though they are not counted in the 13 person-keyed indexes: uq_sponsorship_primary_contact, uq_calendar_invites_uid, and uq_mirror_credentials_org. If a retired sponsorship contact is primary and the survivor contact is retained, preserve exactly one primary flag on the retained row. A mirror_credentials row has one row per org, so changing set_by_person_id must be a direct update with no duplicate row. Calendar uid is never changed; any dedupe must leave exactly one row and its unique uid intact.

For each collision group, the preview identifies the kept row, the moved row, and the deduped/dropped row. The common rule is survivor-owned whole row wins; retired-only whole rows move. No field-level union is performed in a join row. Every dropped row has a complete snapshot and a deterministic reason. This is separate from person_events, whose latest-row-wins fold is handled below.

### 6. Preserve person_events state, not just rows

Move every person_events row from retired person_id to survivor person_id. If actor_person_id is retired, re-point it too. Preserve note history, tag history, stage history, target event, next-touch, timestamps, and ids in the movement receipts.

Before the move, fold both records using the production person_events rules: newest created_at then id per tag, newest current stage/card, and the existing note/stage history projections. After moving rows, append fresh survivor reassertions for the final tag set and current stage/card so a later historical retired row cannot hijack the survivor's latest-row-wins state. The reassertions are part of the same atomic receipt and are distinguishable from user edits. Do not delete historical rows or collapse notes.

The survivor activity feed receives one merge receipt entry addressed to entity_type person and the survivor id. The feed must show the receipt id and Undo while the merge is clean. The audit/event copy must produce one operational sentence for both the org lens and person lens.

### 7. Preview, execute, mirror, and undo service

Build one server-side merge planner used by preview and execution. It loads both rows, aliases, folded annotations, all reference counts, all five no-FK families, collision groups, and the exact field decisions. Preview counts and names the same rows execution will receipt; execution must revalidate the preview inputs inside the write boundary.

Execute all writes in one D1.batch, with the retired people delete last and guarded by the expanded noPersonReferencesPredicate. The batch includes the person_merges receipt, alias changes, survivor field changes, direct FK updates, JSON/polymorphic updates, row dedupes, event reassertions, audit activity, and unsuppressed mirror operations. A uniqueness or guard failure rolls back the complete operation.

The idempotency key is generated by the loader/request boundary and stored with the org and pair. Replaying the same key returns the original durable receipt without a second merge. A different key after the source is retired returns the truthful already-merged outcome and does not create a second alias chain.

Undo is a separate server operation against the durable receipt and is idempotent. It first refuses the operation if the survivor has itself been re-merged or the receipt is no longer the current merge boundary. Otherwise it compares every stored after value before restoring:

- Clean receipt: restore the survivor projection, reinsert the retired row and dropped rows, reverse moved references, remove only aliases still owned by this receipt, reverse synthetic event reassertions, write undo audit, and emit mirror upsert/delete corrections.
- Edited since merge: restore only rows and fields whose current values still equal the receipt's post-merge values; skip changed rows with table, primary key, and reason. Never overwrite a later organizer edit.
- Survivor re-merged: refuse the undo as a whole with a named reason and leave the later merge intact.
- Repeated undo: return the original undo result without additional writes.

The undo truth table and movement receipts are the source of truth for API, UI, and agent responses. They must include partial-undo counts and skip reasons.

### 8. API and UI implementation

Extend the existing org People routes and API types, preserving org access checks and server-side list behavior. Add a preview contract, an execute contract with idempotency key and explicit survivor, and an undo contract keyed by receipt id. Reuse the existing person feed and audit seams rather than introducing a second activity log.

Add the merge entry points to PeoplePage and PersonDrawer. Keep selection state local to the existing page flow. Add the picker and compare dialog in the existing People modal/style system, using the prototype's Flight Deck tokens and no new ornament. The dialog must expose the survivor choice, identity table, blank-fill highlights, tags and do-not-contact result, receipt-shaped counts, named collisions, email continuity, receipt id expectation, and Undo language.

After execute, keep the existing server-truth convention: clear/close only after the response lands, refresh the list and drawer from the survivor, show the toast Undo affordance, and render the receipt activity entry. If the receipt is no longer clean, the UI must show the server's skipped/refused result rather than claiming a full undo. Preserve keyboard focus and recovery on modal close and errors.

### 9. Tests and guardrails

Add focused unit and integration coverage without minting stable US or AC IDs in this branch.

- Canonical inventory tests cover all 28 direct FK families, the three currently missing families, the five no-FK families, the historical calendar cancellation decision, and the future-FK guard.
- Auth tests cover primary email, one alias, A to B to C flattening, replay, cross-org isolation, and old portal/draft/task magic links.
- Merge fixture tests seed every FK family and every no-FK family, verify the retired row is deleted only after all references move, and verify the whole-row receipt.
- Collision tests cover all 13 person-keyed unique indexes plus sponsorship primary, calendar uid, and mirror org invariants. Test survivor-owned and retired-only rows, duplicate snapshots, stable JSON order, and named preview conflicts.
- Field tests cover blank-only backfill, survivor conflicts, tag union, do-not-contact OR, headshot pair handling, and unchanged historical cancellation jobs.
- person_events tests prove notes and stage history remain, tags and current stage are unchanged after moving older/newer rows, and fresh reassertions win the production fold.
- Receipt tests prove preview/execute summary parity, one DB batch rollback, loader-key replay, same-pair repeat behavior, agent/human guard messages, and mirror upsert/delete propagation.
- Undo tests implement the clean, edit-since, survivor-remerged, and repeated-undo truth table, including row-level skip reasons and alias/session/magic-link CAS behavior.
- Route/API tests prove org scope, explicit survivor selection, receipt id exposure, activity-feed entry, pagination compatibility, and no write on rejected preview.
- UI tests reproduce the prototype's two entry points, exactly-two selection guard, ordinals/tooltips, picker search, survivor cards, identical-name email continuity, blank-fill highlights, movement counts, named collisions, toast Undo, and activity Undo. Browser validation is deferred until the stated review boundary.

### 10. Rebase and handoff gates

Before implementation begins, obtain the fresh non-author plan-review PASS from the Adoption Orchestrator. At implementation start and after rebase, re-check github/main, the next free migration number, person-references completeness, and prototype/design commits. Preserve this plan as the contract handoff; do not silently edit the contract documents.

Only after implementation has been reviewed and the relevant gate slot is granted may the full pr-gate run. This plan does not request that slot yet because no implementation exists. Keep Lattice in planning/planned with no auto review. The next handoff is the plan commit and byte-parity proof to the Adoption Orchestrator at surface:513, mailbox adoption-orchestrator.


## Reset 2026-08-16 by agent:delegator-mrq-235
