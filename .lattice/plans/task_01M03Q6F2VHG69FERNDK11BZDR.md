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
3. import_rows.target_id is rewritten only for current person-targeting rows (`entity = 'person'` or the existing Sessionize `entity = 'speaker'`) in imports belonging to the same organization. Preserve the import row and its existing before/after manifest. imports.event_id is required and is never repurposed or nulled; the event relationship is not a permission to reuse an import receipt for a merge. No other entity is in scope.
4. mirror_outbox.row_id is a polymorphic identity. Rewrite queued person-row references and emit the required unsuppressed survivor upsert and retired delete in committed order. Do not suppress these writes merely because the source row is being retired. Preserve queued payload snapshots and receipt rows so replay and undo remain inspectable.
5. audit_log entity rows with entity_type = person and entity_id equal to the retired id are re-pointed to the survivor so the survivor lens contains the complete history. Direct actor_person_id changes are handled by the canonical FK inventory, preserving the original actor meaning. Do not rewrite arbitrary entity ids for unrelated entity types.

No other polymorphic column may be guessed into scope. The implementation guard must name the five families above and the intentionally historical calendar cancellation decision.

### 3. Add schema for aliases and durable merge receipts

MRQ-235 mints schema only after the fresh migration-number check. Add an org-scoped person_aliases table with an explicit generated ULID `id TEXT PRIMARY KEY`, whose unique key is org_id plus normalized email and whose target is the current survivor. Store the merge receipt association and timestamps. The explicit id is the durable alias tie-break and the `(table, primary_key)` movement-receipt key; SQLite rowid is never used. An alias must never point at a deleted retired row.

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

- Canonical inventory tests cover the final 29 direct FK families, the five no-FK families, the historical calendar cancellation decision, the historical receipt-id classification, and the future-FK guard.
- Auth tests cover primary email, one alias, A to B to C flattening, replay, cross-org isolation, and old portal/draft/task magic links.
- Merge fixture tests seed every FK family and every no-FK family, verify the retired row is deleted only after all references move, and verify the whole-row receipt.
- Collision tests cover all 13 person-keyed unique indexes plus the person_list_members (list_id, person_id) primary key, sponsorship primary, calendar uid, and mirror org invariants. Test survivor-owned and retired-only rows, duplicate snapshots, stable JSON order, and named preview conflicts.
- Field tests cover every live people column, per-key custom_fields and stable social_links unions, provenance/kind/is_demo policy, blank-only backfill, survivor conflicts, tag union, do-not-contact OR, headshot pair handling, and unchanged historical cancellation jobs.
- person_events tests prove notes and stage history remain, tags and current stage are unchanged after moving older/newer rows, and fresh reassertions win the production fold.
- Receipt tests prove preview/execute summary parity, one DB batch rollback, loader-key replay, same-pair repeat behavior, agent/human guard messages, and mirror upsert/delete propagation.
- Undo tests implement the clean, edit-since, survivor-remerged, and repeated-undo truth table, including row-level skip reasons and alias/session/magic-link CAS behavior.
- Route/API tests prove org scope, explicit survivor selection, receipt id exposure, activity-feed entry, pagination compatibility, and no write on rejected preview.
- UI tests reproduce the prototype's two entry points, exactly-two selection guard, ordinals/tooltips, picker search, survivor cards, identical-name email continuity, blank-fill highlights, movement counts, named collisions, toast Undo, and activity Undo. Browser validation is deferred until the stated review boundary.

### 10. Rebase and handoff gates

Before implementation begins, obtain the fresh non-author plan-review PASS from the Adoption Orchestrator. At implementation start and after rebase, re-check github/main, the next free migration number, person-references completeness, and prototype/design commits. Preserve this plan as the contract handoff; do not silently edit the contract documents.

Only after implementation has been reviewed and the relevant gate slot is granted may the full pr-gate run. This plan does not request that slot yet because no implementation exists. Keep Lattice in planning/planned with no auto review. The next handoff is the plan commit and byte-parity proof to the Adoption Orchestrator at surface:513, mailbox adoption-orchestrator.


## Amendment after exact-head P1 review

This amendment closes all six P1 findings in verdict artifact art_01M05866ZP78BX5YAYMQ9E2WDQ. It is part of the binding plan and supersedes any earlier wording that was only descriptive or left an implementation choice open. It does not change the signed UI, mirror, person_events latest-row-wins, whole-row receipt, or CAS contracts.

### A. Classify every new alias and receipt reference

The pre-MRQ-235 schema has 28 direct people-reference families after the three existing omissions are added. MRQ-235 adds exactly one new live direct people-reference family:

- person_aliases.person_id is a live target pointer to the current survivor and is declared REFERENCES people(id). Add the person_aliases predicate to PERSON_REFERENCE_CHECKS, personReferenceSelect, noPersonReferencesPredicate, schema-inventory parity, merge fixtures, and all deletion ordering. Re-point it during a chained merge, and receipt each target change as a live moved row.
- person_aliases.merge_id is a normal foreign key to person_merges, not a foreign key to people. It is not part of the people inventory. Its child-before-parent cleanup order is explicit: aliases are removed before receipts.
- person_merges.retired_person_id and person_merges.survivor_person_id are historical text identifiers, deliberately not REFERENCES people(id). They are retained receipt metadata, not live ownership and not a sixth movable no-FK reference. They must never be added to noPersonReferencesPredicate, and their presence must not block deletion of the retired people row.
- person_merges.org_id is the tenant scope. The receipt must also retain the event-scope vector for moved rows and its undo-blocked reason, so event deletion can preserve history without promising an impossible restore.

The final inventory count is therefore 29 direct people-reference families: the existing 25, the three live omissions already named, and person_aliases.person_id. The five movable no-FK families remain exactly forms.admin_notify_person_ids, the headshot attachment pair, import_rows.target_id when entity is person or the existing person-targeting speaker entity, mirror_outbox.row_id for person records, and audit_log person entity rows. The historical receipt identifiers are a separate retention classification, not a hidden sixth live family. The schema guard, delete-order guard, reset guard, and fixture census must assert these classifications before implementation.

The alias table's id, org_id, normalized email, person_id, merge_id, created_at, and updated_at are all included in the schema contract. UNIQUE(org_id, email) remains the identity boundary. An alias can only target a person in the same org, enforced by the merge transaction and tested as a cross-org refusal. A receipt keeps historical ids after source deletion; an alias never targets a deleted source.

### B. Add person_list_members to the collision matrix

person_list_members has a primary key on (list_id, person_id), in addition to its direct person_id foreign key. It is an additional live uniqueness constraint beyond the 13 named person-keyed unique indexes, making the complete merge collision set 13 indexes plus this primary key.

The rule is explicit:

- if only the retired row is in a list, update person_id to the survivor;
- if only the survivor row is in a list, leave it;
- if both rows are in the same list, retain the survivor-owned row, mark the retired row deduped, and store the complete dropped row snapshot;
- the preview names the list and counts the deduped membership;
- undo reinserts or restores the retired membership only when the key is free and the survivor membership still equals the post-merge projection; a later list edit produces a row-level skip reason.

The primary-key collision is included in the movement receipt, preview summary, collision tests, clean/edit-since/remerged/repeated undo tests, and the retired-delete proof. No direct UPDATE may run for this table without first grouping by list_id.

### C. Scope import_rows rewrites by entity and organization

import_rows.target_id is polymorphic. A merge may rewrite only rows satisfying all of:

- import_rows.target_id equals the retired person id;
- import_rows.entity IN ('person', 'speaker'), where `speaker` is the existing Sessionize speaker-person entity and is not a future entity;
- the owning imports row joins through its non-null event_id to an event whose org_id equals the merge org.

The merge must not touch entity = 'session' rows or any other entity, even when their target_id happens to equal the retired id. Preserve each import row's existing before_json and after_json manifest and receipt the exact row before and after the rewrite. For `entity = 'speaker'`, the movement receipt must retain import_id, row primary key, original target_id, survivor target_id, and the complete row snapshot. While that active movement receipt exists, `undoSessionizeImport` must detect it before snapshot lookup or any write and return a durable `person_merged`/merge-receipt blocked reason with the manifest retained: it must not restore the retired snapshot, delete the survivor via cleanupImportedPerson, or partially undo other rows. If the merge itself is cleanly CAS-undone, restore the speaker row target and reverse its movement receipt; only then may the pre-existing Sessionize undo path run. `entity = 'person'` keeps the existing import undo contract with the same entity/org join and CAS. An unrelated session row and a speaker row are regression fixtures. The five no-FK classification is specifically the current person-scoped slice of this polymorphic column, not the unrestricted target_id column.

### D. Define the deterministic survivor projection for every people column

The merge planner must calculate and receipt a complete projection for every PersonRow column: id, org_id, email, name, title, company, bio, company_id, custom_fields, do_not_contact, headshot_attachment_id, social_links, is_demo, kind, last_write_source, created_at, and updated_at. Preview lists the decision for every field as kept, filled, unioned, forced, aliased, or rejected; the receipt stores the exact survivor-before and survivor-after values. No field is left to an implementer's interpretation.

- id: the explicitly chosen survivor id remains; the retired id exists only in the retired snapshot and historical receipt.
- org_id: both records must be in the same org; the survivor org_id remains unchanged.
- email: the survivor email remains the active primary. The normalized retired email becomes the alias. Any active primary or alias collision is rejected before the batch.
- name: the survivor name remains. It is non-null by schema, so there is no name backfill. A different retired name is a named identity conflict.
- title, company, and bio: treat null or trimmed-empty as blank. A blank survivor field takes the retired value; when both are nonblank, the survivor wins and the retired value is named as kept-out conflict. The columns are evaluated independently.
- company_id: treat null as blank. A blank survivor link takes the retired link; two different non-null links keep the survivor link and name the conflict. Do not infer or silently synchronize the separate legacy company string from company_id.
- custom_fields: parse every valid JSON value, not only objects. For object/object values, merge per key; missing, `null`, trimmed-empty strings, empty arrays, and empty objects are blank, while `false`, zero, nonempty strings, and all other nonempty JSON values are nonblank. A retired nonblank value fills a blank survivor key; when both are nonblank, the survivor value wins, including on type conflict. Preserve survivor key order, then retired-only keys in lexical order, and preserve arbitrary JSON values stored at each key. If either whole value is not an object, use the total shape rule below rather than coercing it to `{}`. Receipt the per-key result, parsed shape, raw before value, and exact stored after JSON.
- social_links: parse every valid JSON value, not only arrays of strings. For array-of-strings/array-of-strings values, preserve survivor order and values, then append retired entries whose trimmed comparison value is absent; preserve the first stored spelling. For any other valid shape—including the current object written by instance claim, arrays containing nonstrings, scalars, and `null`—use the total shape rule below rather than treating it as empty. Receipt the shape decision and exact stored JSON; never silently drop a valid link value.
- JSON total-shape rule for both fields: the domain is `null`, boolean, number, string, array, or object. A whole value is blank only when it is `null`, a trimmed-empty string, an empty array, or an empty object; `false` and zero are nonblank. If both values have the field's mergeable shape, use the field-specific union above. Otherwise, if the survivor is blank and the retired value is nonblank, keep the retired value wholesale (`filled_shape`); in every other shape conflict keep the nonblank survivor (or the survivor raw value when both are blank), record the retired value as `shape_conflict_kept`, and retain it in the complete receipt. A malformed stored value rejects the merge before the batch with a named invalid-JSON reason; it is never converted to an empty fallback. Preview, post-projection receipt, unsuppressed mirror upsert, and CAS all use this same parsed decision and exact stored JSON, so the current readers' noncanonical-empty fallback cannot erase data.
- do_not_contact: logical OR; once either record is protected, the survivor remains protected.
- headshot_attachment_id: use the existing headshot-pair rule. A blank survivor pointer is filled from the retired pair; two active pointers keep the chosen survivor attachment and receipt the retired attachment as dropped with its full row snapshot. No R2 object is deleted by this merge.
- is_demo: preserve the survivor value. A real survivor does not become synthetic because a retired demo row was merged into it; two demo rows keep a demo survivor. The result is named in preview because reset cleanup depends on this flag.
- kind: the two rows must have the same kind. A human/agent mix is rejected with the signed policy sentence; a same-kind merge preserves the survivor kind.
- last_write_source: set to marquee for the committed merge because this is a Marquee-owned write, regardless of either prior source. Receipt both prior values and emit the unsuppressed survivor mirror upsert plus retired delete. This prevents provenance from falsely claiming that Airtable authored the merge.
- created_at: preserve the survivor's original creation timestamp. The retired timestamp remains in its snapshot.
- updated_at: set to the one merge timestamp used by the batch. Undo restores it only when it still equals that post-merge value.

The CAS undo compares this complete post-merge projection field by field. A later edit to social_links, custom_fields, company_id, provenance, or any other live field is skipped with the same table/field/reason detail as every other changed row; a full retired snapshot alone is never permission to overwrite later data.

### E. Bind no-event alias and primary tenant precedence

The auth contract remains non-enumerating and preserves the existing universal-door shortcut.

With event_id present, resolve the event first and restrict all primary and alias candidates to event.org_id. Within that tenant, an exact active people.email match ranks before a person_aliases.email match; the merge guard prevents a new same-org primary/alias collision, and legacy collision data deterministically chooses the primary. No candidate produces the existing generic acknowledgement and no org or person detail.

Without event_id, there is no tenant supplied by the caller, so preserve the existing global single-org shortcut rather than inventing a tenant chooser:

1. collect normalized-email candidates from active primary people rows and from person_aliases rows;
2. any primary candidate ranks before every alias candidate;
3. among primary candidates, oldest people.created_at then people.id wins, preserving the existing behavior;
4. when no primary exists, oldest person_aliases.created_at then person_aliases.id, with target person id as a final tie-break, wins;
5. a missing candidate, an alias candidate, and a primary candidate all return the same public acknowledgement shape; no candidate count, org, person, or reason is exposed.

This explicitly means an active primary in one org outranks an alias in another on the no-event door, while an event-scoped request always wins by narrowing to its event tenant. The alias resolver must not enumerate organizations or disclose cross-tenant collisions. Tests cover: one-org no-event alias continuity; primary-versus-alias collisions across orgs; multiple primaries; multiple aliases; event-scoped alias lookup; event-scoped out-of-tenant refusal; and identical public response bodies for found, alias-found, ambiguous, and missing addresses.

### F. Full reset, ordinary event deletion, and removeDemoPeople

The new tables have explicit lifecycle policies rather than a generic housekeeping note.

Full reset of the shipped demo organization:

- add person_aliases and person_merges to WIPE_ORDER and to the total DELETE_PLANS map;
- scope both delete statements to the demo organization, never globally;
- place person_aliases before person_merges because merge_id is a child foreign key, and place both before people;
- delete all demo-org aliases and merge receipts so the reseeded demo has no stale sign-in continuity, historical ids, or undo receipts;
- because mirror_credentials is preserved global control-plane state, the migration makes set_by_person_id nullable while retaining its people FK; before the people DELETE plan runs, set it to NULL for every demo-org credential whose actor is being removed. Do not create a synthetic person or delete the credential row. The existing encrypted credential, set_at, and audit-visible row survive with an explicit no-longer-retained-actor state;
- api_tokens are already deleted by the full-reset plan before people; explicitly include both created_by and acts_as_person_id in the lifecycle proof so no token FK survives the people delete;
- clear any corresponding suppressed mirror outbox material according to the existing reset mirror policy;
- preserve all other organizations and their aliases/receipts.

Ordinary event deletion where people survive:

- person_aliases and person_merges are org-level and are retained;
- aliases continue to resolve to the surviving person across conferences;
- every movement receipt records scope_event_id for event-owned rows;
- before deleting event-owned rows, mark receipts whose scope vector intersects the deleted event as undo-blocked with reason event_deleted, while retaining their summary, historical snapshots, alias continuity, and activity/audit history;
- receipts containing no deleted event-owned row remain eligible for CAS undo;
- event deletion never attempts to resurrect an event or its children through merge undo.

Event deletion with removeDemoPeople, including removeDemoData:

- before any removeDemoPeople DML, run the Cycle 3 surviving-event reference gate below; a non-clearable reference from a selected demo person to a surviving event refuses the whole operation, so no demo event, non-demo event row, person, company, attachment, alias, or receipt is partially changed;
- before deleting selected demo people, delete live aliases whose target is a selected demo person; retain historical alias snapshots inside any retained non-demo survivor receipt;
- retain a person_merges receipt when its survivor is non-demo: mark it undo-blocked with reason demo_person_removed and keep its complete history/dependency movement entries. Delete a receipt only when no non-demo survivor or retained dependency depends on it. This supersedes the earlier blanket delete of receipts involving a selected demo identity;
- before the people delete, set mirror_credentials.set_by_person_id = NULL for every preserved credential row whose actor is selected; this is the same legal nullable-FK policy as full reset, preserves the one-row-per-org credential, and never guesses a replacement actor;
- before the people delete, set api_tokens.acts_as_person_id = NULL for surviving tokens whose acting person is selected, then delete tokens whose created_by is selected. This order covers a non-demo creator acting as a selected demo person and leaves no live token FK;
- apply the dependency promotion/reattachment ordering below, then run all remaining allowed nullable-reference cleanup and the expanded noPersonReferencesPredicate before the people delete;
- preserve every non-demo event, every non-demo person, every surviving non-demo row, and every dependency referenced by one; delete unreferenced demo companies/attachments only after their children and selected demo people are gone;
- repeated removeDemoPeople and full reset runs are idempotent. A successful removeDemoPeople never creates a second cleanup movement, and a refusal leaves the merge receipt clean and CAS-eligible for retry.

Add integration coverage for all three lifecycle paths, including a shared organization with one non-demo person, an alias targeting that person from a demo merge, a receipt with event-owned movements, preserved mirror credentials set by a removed demo person, a surviving token created by a non-demo person but acting as a removed demo person, a full reset, ordinary event deletion, removeDemoPeople, and a second cleanup run. Assert the credential row survives with a NULL actor, the surviving token's acts_as_person_id is NULL, no cross-tenant deletion, no stale live alias, no accidental loss of retained non-demo history, and the explicit refusal/promotion/reattachment fixtures in the Cycle 3 amendment.

### G. Required P1 regression coverage and unchanged signed contracts

The canonical inventory census is updated from 28 to 29 direct people-reference families. Collision coverage is updated from 13 indexes to 13 indexes plus the person_list_members primary key. The test list must explicitly include entity-scoped `person` and current `speaker` import rows, speaker undo blocking and clean merge undo, every live people column projection over all valid JSON shapes, explicit alias-id ordering, no-event primary/alias precedence, mirror_credentials nullable-FK cleanup, api_tokens.acts_as_person_id cleanup, surviving-event reference refusal/clear behavior, inherited demo company promotion, inherited demo headshot reattachment, and full-reset/event-delete/removeDemoPeople lifecycle cleanup.

The signed prototype contract remains unchanged: both entry points, exactly-two Merge…, ordinals and tooltip, default survivor by conference count with one-click override, blank-fill highlights, identical-name email continuity, named collisions, receipt id, toast Undo, and survivor activity-feed Undo. Mirror propagation remains unsuppressed with survivor upsert and retired delete. person_events still moves history and appends fresh survivor tag/stage reassertions for the production latest-row-wins fold. Undo remains whole-operation CAS with clean, edited-since, survivor-remerged refusal, and idempotent replay states.

No stable US/AC IDs or contract documents are minted or edited in this amendment.

## Amendment after Cycle 2 plan review

This amendment closes all four P1 findings in verdict artifact art_01M059J9GPDZKJA46WTFFPGZ9C. It is binding plan text, supersedes any earlier Cycle 1 wording that conflicts with it, and does not advance Lattice or authorize implementation. The signed prototype/UI, unsuppressed mirror survivor-upsert plus retired-delete contract, latest-row-wins person_events reassertions, whole-row movement receipts, and operation-wide CAS undo remain unchanged.

The lifecycle rule is deliberately explicit: `mirror_credentials.set_by_person_id` remains a canonical direct people FK but becomes nullable in the MRQ-235 migration because the preserved org credential may outlive every person. Both full reset and removeDemoPeople clear that pointer to NULL before deleting the selected people; neither path deletes the credential row or invents a system person. Full reset deletes all org api_tokens before people; removeDemoPeople first NULLs `api_tokens.acts_as_person_id` on surviving tokens and then deletes tokens by `created_by`. Tests must execute both paths with the exact FK combinations from the blocker and prove idempotent reruns.

The current Sessionize `entity = 'speaker'` import row is a person reference, so it is in the allowlist alongside `entity = 'person'`, with the same org/event scope and whole-row receipt. Its target is rewritten to the survivor while `before_json`/`after_json` remain the import manifest. An active merge movement receipt makes `undoSessionizeImport` stop before snapshot lookup or writes and return a durable `person_merged` blocked reason; it must never restore a deleted retired snapshot or clean up the survivor. A clean CAS merge undo reverses the target movement and dependency, after which normal speaker undo is allowed. `entity = 'session'` and all other entities remain untouched.

Alias-only no-event resolution orders by `person_aliases.created_at`, then the explicit generated ULID `person_aliases.id`, then `person_aliases.person_id`; the schema, receipt key, preview, and CAS all use that id, never SQLite rowid.

The JSON projection is total over every value accepted by the live `json_valid` checks. Objects and canonical string arrays retain their field-specific per-key/ordered-union behavior; all other valid shapes use the explicit blank/shape-conflict rule above, preserving raw values in preview, receipt, mirror payload, and CAS. `false` and zero are nonblank; malformed JSON rejects before writes. Tests cover the object currently stored in `social_links`, non-string custom-field values, every JSON shape, shape conflicts, mirror output, and edited-since undo.

## Amendment after Cycle 3 plan review

This amendment closes the remaining P1 in verdict artifact art_01M05B3YBPWD3YPX0XGWKZ8GXD. It supersedes only the earlier `removeDemoPeople` lifecycle wording where it conflicts with this section. All Cycle 1 and Cycle 2 contracts remain binding: the canonical 29-family inventory and five no-FK classification, list-membership primary-key collision rules, entity-scoped `person`/`speaker` import receipts, complete JSON-domain projection, alias tenant/precedence/id ordering, nullable mirror/token cleanup, unsuppressed mirror survivor-upsert plus retired-delete, latest-row-wins `person_events` reassertions, whole-row receipts, CAS undo, and signed v1.17 UI behavior. Full reset remains allowed to wipe the demo organization; this gate applies to `removeDemoPeople` and must preserve every non-demo row.

### A. Surviving-event reference gate

`removeDemoPeople` derives `selected_demo_people` exactly as the existing seam does: `is_demo = 1` in the organizations of the events being removed. It also derives `surviving_events` as same-organization events not in the deletion set. The canonical `person-references.ts` inventory is extended with the event-owner join and a removal policy for every one of the 29 direct FK families; it is not a second merge-only inventory. The preflight projection returns `family`, `column`, `row_id`, `event_id`, `person_id`, nullability, and policy for every selected demo reference whose owning event is in `surviving_events`. The join is explicit for direct event_id columns and follows the owning row for indirect scopes: submissions/participations/evaluations through submissions or rounds, committees through committees, sponsorship_contacts through sponsorships, imports/forms through their event, and every other inventory family through its declared owner. The same projection covers the five live no-FK families (`forms.admin_notify_person_ids`, the headshot pair, person/speaker `import_rows.target_id`, person `mirror_outbox` rows, and person `audit_log` rows) plus the intentionally historical `calendar_cancellations.person_id` decision.

The policy is deterministic for every returned reference:

- Retention is the default for a surviving non-demo event and its rows. No surviving event, sponsorship, submission, task, contact, roster, invite, audit/history row, or other non-demo row may be deleted to make demo-person removal succeed.
- No automatic reassignment is permitted. The operation never chooses the lowest-id person, event owner, organizer, or another guessed actor to replace a selected demo person. A caller must resolve a semantic assignment before retrying.
- Clear is allowed only for a nullable actor/control reference whose existing contract says that NULL means “not recorded,” not “another person”: `speaker_tasks.completed_by_person_id`, `submissions.decided_by_person_id`, `evaluations.override_person_id`, `audit_log.actor_person_id`, `person_events.actor_person_id`, `mirror_credentials.set_by_person_id`, `api_tokens.acts_as_person_id`, and `person_lists.created_by`. The row is retained, its whole before/after snapshot is recorded, and the clear is applied only after the surviving-event gate. A nullable subject/assignment or a non-null actor cannot be silently cleared.
- Refusal covers every non-clearable direct FK or live no-FK reference in a surviving event, including `speaker_tasks.person_id`, `sponsorship_contacts.person_id`, `calendar_invites.person_id`, `participations.person_id`, `form_admins.person_id`, `submissions.submitter_person_id`, `submission_decisions.decided_by_person_id`, `file_comments.author_person_id`, and the corresponding subject/assignment families from the canonical inventory. It also covers surviving-event `forms.admin_notify_person_ids`, `import_rows` with `entity IN ('person','speaker')`, and queued person `mirror_outbox` rows. The historical `calendar_cancellations.person_id` remains retained unchanged under its existing self-contained-snapshot contract; it is not a live ownership reference.

If the refusal projection is non-empty, return `remove_demo_refused` with reason `demo_person_referenced_by_surviving_event` and the stable sorted blocker vector before any delete/update statement. No event children, people, aliases, companies, attachments, mirror rows, or receipts are changed. No cleanup movement receipt is created, no merge receipt is marked blocked, and any related merge remains eligible for ordinary CAS undo. A successful preflight is revalidated at the write boundary; a newly appearing blocker rolls back the complete operation rather than deleting a surviving-event row.

For an allowed clear, the existing remove-demo operation is destructive and has no standalone user Undo. If the row is named by an active `person_merges` receipt, append its complete before/after row snapshot as an existing movement outcome `moved` with reason `remove_demo_clear`, mark that receipt `undo_blocked` with reason `demo_person_removed`, and make merge Undo return that skip reason without restoring the deleted demo person or overwriting a later edit. If no merge receipt owns the row, retain the row and write the existing cleanup audit before/after; no merge Undo is implied. A refused operation performs none of these transitions.

### B. Retain inherited demo companies and headshots

The merge projection may leave a retained non-demo survivor pointing at a demo-owned dependency. This is legal and must not be repaired by deleting the dependency:

- Company: before any people or company delete, compute every `companies.is_demo = 1` row referenced by a retained non-demo `people.company_id` or by a sponsorship in a surviving event. Promote that exact row in place with `is_demo = 0`, `last_write_source = 'marquee'`, and the cleanup timestamp; preserve its id and every other column. Do not clone a company, clear the survivor's `company_id`, or rewrite the legacy `people.company` string. A company with no retained non-demo reference remains eligible for the existing demo-company delete after selected people are gone. A missing, cross-org, or conflicting company dependency refuses before DML.
- Headshot: before deleting attachments or events, find every retained non-demo `people.headshot_attachment_id` whose attachment is `owner_type = 'person_headshot'` and whose `event_id` would be deleted or whose owner is a selected demo person. If exactly one retained person owns the dependency, update the same attachment row's `owner_id` to that survivor and its `event_id` to the earliest surviving non-demo event in the organization ordered by `created_at, id`; preserve the R2 object and all other attachment columns. If there is no surviving event, more than one retained owner, or an owner/type mismatch, refuse with a named `demo_headshot_dependency_unresolvable` reason rather than clear the non-demo survivor's pointer or delete the attachment.

For an inherited company or headshot arising from an active merge receipt, append the complete dependency row snapshot to that receipt using the existing movement outcome `moved` and reason `remove_demo_dependency_retained` (`companies.is_demo: 1 → 0`; `attachments.owner_id/event_id: retired/demo event → survivor/selected surviving event`). Mark the receipt `undo_blocked` with `demo_person_removed` before deleting the retired person. Merge Undo after this lifecycle transition is a truthful refusal with the receipt reason; it never reverts the promotion/reattachment, resurrects the retired person, deletes the retained dependency, or partially restores the operation. If no active merge receipt owns the dependency, record the same whole-row before/after in the existing cleanup audit and provide no merge Undo. If the preflight refuses, no dependency row or receipt changes. R2 deletion remains excluded from this database operation.

### C. Required SQL ordering and regression fixtures

The remove-demo write boundary is ordered as follows: (1) select and sort selected demo people, surviving events, all reference blockers, retained company dependencies, and retained headshot dependencies; (2) abort on any refusal or revalidate the zero-blocker/dependency plan immediately before DML; (3) record lifecycle-blocked merge receipts and perform company promotion and headshot owner/event reattachment before their parent rows can be deleted; (4) delete children of the events being removed using the existing cascade; (5) apply the allowed nullable clears, aliases, token/credential cleanup, and any remaining receipt updates; (6) delete selected people last with the expanded `noPersonReferencesPredicate`; (7) delete only unreferenced demo companies and attachments from deleted events, with reattached attachments excluded; (8) delete the demo events. Every step is one atomic D1 batch/write boundary, and any guard or uniqueness failure rolls back all steps. Full reset retains its separate org-wide wipe ordering.

Regression fixtures must include: a demo person in `speaker_tasks.person_id` for a surviving non-demo event and the equivalent `sponsorship_contacts.person_id` path, both proving refusal with zero deleted rows; a surviving-event nullable `speaker_tasks.completed_by_person_id` proving clear and retained task row; a non-demo survivor whose merge-filled `company_id` points to an `is_demo` company, proving in-place promotion and no company deletion; a non-demo survivor whose merge-filled headshot points to an attachment on a deleted demo event, proving owner/event reattachment and preserved R2/row; no surviving event proving named headshot refusal; CAS Undo before refusal, after successful cleanup, edited-since skip, repeated cleanup, and no partial batch; plus a control proving full reset may still wipe the demo organization without touching another organization.

## Amendment after Cycle 4 plan review

This amendment closes all three blockers in verdict artifact `art_01M05CJP65GYKS8Q324KTGQDQP`, reviewed at exact head `e48c4ce28c6f14f99d4d16638212fb71964d508f`. It supersedes the earlier no-event precedence and remove-demo transaction wording where it conflicts with this section. Cycle 1–3 inventory, collision, import-undo, JSON-domain, alias-chain, mirror, `person_events` latest-row-wins, whole-row receipt, dependency, and CAS contracts remain binding. The signed v1.17 UI remains unchanged.

The live seams were re-derived before this amendment: `src/routes/auth.routes.ts` currently resolves an eventless request with one global `people` primary and then mints against that row; `src/lib/events/delete-event.ts` recursively commits `EVENT_DELETE_CHUNK = 32` batches and enumerates R2 objects before its D1 batch; `src/lib/reset-demo/reseed-demo.ts` deletes attachments only through `event_id` and calls R2 cleanup before its reset batch; migration `0018_event_deletion.sql` makes `attachments.event_id` nullable for organization-level person headshots; and the import, mirror, audit, and canonical person-reference seams retain the five polymorphic/no-FK families already classified above. No contract document, stable ID, or migration number is minted by this amendment.

### A. No-event sign-in is tenant-safe and ambiguity-safe

Extend the magic-link request's optional context with `org_id` as an untrusted tenant narrowing value. It grants no access by itself and is never echoed. `event_id` remains the stronger context: resolve the event first, derive its `org_id`, and require a supplied `org_id` (when present) to match it. A missing event or an event/tenant mismatch takes the same generic acknowledgement path and performs no write; there is no fallback to a global lookup.

Resolve candidates in this order:

1. With `event_id`, restrict active primary emails and aliases to that event's organization. With `org_id` and no event, restrict them to that organization. A primary match may be used before an alias only when the candidate set resolves to one current person; a legacy primary/alias collision that resolves to different people is ambiguous and is refused, not ranked.
2. With neither event nor tenant context, collect both active-primary and alias candidates, flatten aliases to current non-retired targets, and group by organization and target person. The universal door may auto-resolve only when the complete candidate set contains exactly one organization and exactly one current person. A primary still has precedence over an alias within that one safe tenant when both identify that same person. Alias-only rows retain the cleared deterministic order `created_at`, explicit alias `id`, then target person id, but that tie-break may never choose between organizations or distinct people.
3. If candidates span organizations, if an active primary in one organization competes with a retired alias in another, if two current people remain possible, or if context names no valid tenant/event, return the same non-enumerating generic acknowledgement as a missing address. Do not mint a magic link, create an outbox row, set an on-screen link, or create a session for any candidate. Do not disclose candidate count, organization, person, or ambiguity reason.

The resolver and the route must share this result type so the request path cannot accidentally treat `ambiguous` as `not found` in one branch and as a chosen person in another. The fixed demo-seat address shortcut remains a separate, explicitly seeded demo-person path; it is not allowed to override the normal candidate ambiguity rule for an ordinary address. Tests prove: cross-org alias plus active-primary ambiguity creates no `magic_links`, `outbox`, or `auth_sessions` row and cannot mint access for either candidate; explicit `event_id` selects only that event tenant; explicit `org_id` selects only that tenant; event/tenant mismatch refuses without fallback; one-tenant alias continuity works; alias-only/id ordering is stable; multiple same-tenant targets refuse; and found, alias, ambiguous, and missing requests have identical public response bodies.

### B. removeDemoPeople uses one full-set guarded D1 operation

`person-references.ts` remains the one canonical inventory. Its typed census covers the 29 direct FK families, the five named no-FK families, and the historical `calendar_cancellations.person_id` classification. The same module supplies the event-owner join, removal policy, preflight projection, application guard, and final deletion predicate; there is no delete-event-only inventory. The five no-FK guards are explicit and complete: `forms.admin_notify_person_ids` JSON membership, the `person_headshot` pointer/owner attachment pair including `event_id IS NULL`, current `import_rows.target_id` for only `entity IN ('person','speaker')` through the owning import event and org, queued `mirror_outbox` person rows, and `audit_log` rows with `entity_type = 'person'`/`entity_id`. `calendar_cancellations.person_id` remains historical self-contained snapshot data and is retained or deleted only by its existing event lifecycle.

For `removeDemoPeople`, freeze one complete deletion plan before any DML: every selected event, organization, selected demo person, surviving event, direct-FK row, no-FK row, alias/merge receipt, company/headshot dependency, attachment row, and exact R2 key. The preflight is a full-set projection, not a permission to perform later unconstrained deletes. It classifies every reference as deleted with its owner, legally cleared, reattached/promoted, or refusal. A surviving non-demo event or row is retained; no later chunk may reclassify it as disposable.

The removal path executes exactly one outer guarded D1 transaction/batch for that complete set. It must not recursively call `deleteEventCascade` or await/commit one batch per 32-event slice. If statement parameter limits require 32-event binding groups for ordinary child statements, those groups are prepared as statements inside this one outer batch against the frozen full-set selector; they never commit independently, recompute `surviving_events`, or run R2 work between groups. The final person delete, company/attachment cleanup, and event delete all use the same complete set.

The batch begins with the full-set blocker/dependency guard and ends with a migration-owned database-level conditional `BEFORE DELETE ON people` guard using `RAISE(ABORT, ...)`, generated from the canonical five no-FK predicates as well as the direct FK predicate. At the actual people-delete point it checks, among other cases, JSON person ids in surviving forms, polymorphic attachment owners and pointers including detached headshots, surviving person/speaker import rows in the same org, `mirror_outbox` people rows, and surviving person audit entities. The guard is evaluated inside the outer write boundary after all allowed cleanup and event-owned child deletes. A concurrent no-FK insert/update therefore either is visible to the guard or causes the D1 write conflict/batch abort; it cannot land between a separate read and a later committed chunk. Any guard, count, FK, or uniqueness failure rolls back the complete batch, including event children, receipt changes, people, companies, and attachments.

The ordered operation is: (1) full-set preflight and stable blocker/dependency vector; (2) refuse before DML on any non-clearable surviving reference; (3) capture lifecycle-blocked merge receipts and perform only legal company/headshot reassignments; (4) delete children and no-FK rows owned by events in the deletion set; (5) apply the already-cleared nullable actor/control clears, alias/token/credential cleanup, and receipt/audit projections; (6) null direct attachment pointers and delete selected people last under both guards; (7) delete only unreferenced demo companies and attachments in the frozen set; and (8) delete the selected events. A refusal or concurrent guard failure leaves every non-demo row, every surviving-event reference, every merge receipt, and every R2 object unchanged. Full reset retains its separate org-wide wipe, while `removeDemoPeople` preserves every non-demo row.

### C. Detached headshots are a first-class reset/delete case and R2 is post-commit

Because migration 0018 permits `attachments.event_id` to be NULL for `owner_type = 'person_headshot'`, the lifecycle census must select headshots by both relations: the `people.headshot_attachment_id` pointer and the attachment's polymorphic `(owner_type, owner_id)`, never by event id alone. A detached headshot owned by a selected demo person is part of the remove/reset deletion set even when `event_id IS NULL`; its D1 row is deleted only after the pointer is severed and inside the guarded batch. A detached headshot owned by a retained non-demo person is retained. An inherited demo-owned headshot follows the Cycle 3 rule: reattach the same row to the sole retained survivor and the earliest surviving non-demo event in deterministic `(created_at, id)` order, or refuse when there is no surviving event, more than one owner, or an owner/type/org mismatch. Reattachment preserves the row, every column, and the R2 key.

Ordinary event deletion with `preserveOrgAttachments` detaches event-bound person headshots and preserves both the D1 row and R2 object; it does not later delete them merely because `event_id` became NULL. Full reset expands `WIPE_ORDER`/`DELETE_PLANS` to delete all demo-org person-headshot rows owned by people in the reset set, including detached rows, while leaving unrelated organizations untouched. `removeDemoPeople` deletes only the exact selected/deleted attachment rows and preserves reattached or retained rows.

No external R2 deletion is permitted before the guarded D1 commit. Preflight records the exact `r2_key` set for attachment rows the successful batch will delete. `deleteEventObjects`, `deleteDemoOrgObjects`, and `reseedDemo` must perform their D1 batch first; only after it succeeds may they delete those exact keys, rechecking that no newly inserted or reattached attachment still references a key. A refusal, rollback, or reattachment therefore leaves the D1 row and R2 object intact. A post-commit R2 failure is reported as recoverable orphan cleanup for the existing sweep/retry path; it never causes a second destructive D1 attempt or claims atomicity across D1 and R2.

Regression fixtures must include: a detached demo-person headshot (`event_id = NULL`) removed by `removeDemoPeople`, proving the D1 row and R2 object disappear only after commit; the same detached row through full reset, with another organization's row/object preserved; ordinary event deletion preserving a detached person headshot; refusal caused by a surviving-event reference proving zero D1 changes and zero media deletes; inherited demo headshot reattachment proving the same row/event/owner policy and preserved R2 object; all five no-FK families in both an early and a later-than-32-event part of one deletion set; a concurrent/no-FK guard-abort fixture proving no partial event/person/receipt/attachment deletion; and successful idempotent rerun. Preserve the existing Cycle 1–3 fixtures for speaker undo blocking, alias continuity, chained merges, latest-row-wins reassertion, company promotion, whole-row receipts, and CAS undo.

## Reset 2026-08-16 by agent:delegator-mrq-235
