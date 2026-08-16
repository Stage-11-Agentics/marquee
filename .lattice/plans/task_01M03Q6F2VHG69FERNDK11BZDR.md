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

The final inventory count is therefore 29 direct people-reference families: the existing 25, the three live omissions already named, and person_aliases.person_id. The five movable no-FK families remain exactly forms.admin_notify_person_ids, the headshot attachment pair, import_rows.target_id when entity is person, mirror_outbox.row_id for person records, and audit_log person entity rows. The historical receipt identifiers are a separate retention classification, not a hidden sixth live family. The schema guard, delete-order guard, reset guard, and fixture census must assert these classifications before implementation.

The alias table's org_id, normalized email, person_id, merge_id, created_at, and updated_at are all included in the schema contract. UNIQUE(org_id, email) remains the identity boundary. An alias can only target a person in the same org, enforced by the merge transaction and tested as a cross-org refusal. A receipt keeps historical ids after source deletion; an alias never targets a deleted source.

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
- import_rows.entity = 'person';
- the owning imports row joins through its non-null event_id to an event whose org_id equals the merge org.

The merge must not touch entity = 'session' rows or any other future entity, even when their target_id happens to equal the retired id. Preserve each import row's existing before_json and after_json manifest and receipt the exact row before and after the rewrite. Undo applies the same entity and org join and uses CAS; an unrelated session row is a regression fixture. The five no-FK classification is specifically the person-scoped slice of this polymorphic column, not the unrestricted target_id column.

### D. Define the deterministic survivor projection for every people column

The merge planner must calculate and receipt a complete projection for every PersonRow column: id, org_id, email, name, title, company, bio, company_id, custom_fields, do_not_contact, headshot_attachment_id, social_links, is_demo, kind, last_write_source, created_at, and updated_at. Preview lists the decision for every field as kept, filled, unioned, forced, aliased, or rejected; the receipt stores the exact survivor-before and survivor-after values. No field is left to an implementer's interpretation.

- id: the explicitly chosen survivor id remains; the retired id exists only in the retired snapshot and historical receipt.
- org_id: both records must be in the same org; the survivor org_id remains unchanged.
- email: the survivor email remains the active primary. The normalized retired email becomes the alias. Any active primary or alias collision is rejected before the batch.
- name: the survivor name remains. It is non-null by schema, so there is no name backfill. A different retired name is a named identity conflict.
- title, company, and bio: treat null or trimmed-empty as blank. A blank survivor field takes the retired value; when both are nonblank, the survivor wins and the retired value is named as kept-out conflict. The columns are evaluated independently.
- company_id: treat null as blank. A blank survivor link takes the retired link; two different non-null links keep the survivor link and name the conflict. Do not infer or silently synchronize the separate legacy company string from company_id.
- custom_fields: parse the valid JSON object. For each key, missing, null, trimmed-empty string, empty array, and empty object are blank; false, zero, and nonempty values are not blank. A retired nonblank value fills a blank survivor key; when both are nonblank, the survivor value wins, including on type conflict. Serialize survivor key order first, then retired-only keys in lexical order. Receipt the per-key result and exact JSON.
- social_links: parse the valid JSON array of strings. Preserve survivor order and values, then append retired entries whose trimmed comparison value is absent; preserve the first stored spelling and do not silently delete a link. This is a stable union, not a timestamp or last-writer choice.
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
4. when no primary exists, oldest person_aliases.created_at then alias id, with target person id as a final tie-break, wins;
5. a missing candidate, an alias candidate, and a primary candidate all return the same public acknowledgement shape; no candidate count, org, person, or reason is exposed.

This explicitly means an active primary in one org outranks an alias in another on the no-event door, while an event-scoped request always wins by narrowing to its event tenant. The alias resolver must not enumerate organizations or disclose cross-tenant collisions. Tests cover: one-org no-event alias continuity; primary-versus-alias collisions across orgs; multiple primaries; multiple aliases; event-scoped alias lookup; event-scoped out-of-tenant refusal; and identical public response bodies for found, alias-found, ambiguous, and missing addresses.

### F. Full reset, ordinary event deletion, and removeDemoPeople

The new tables have explicit lifecycle policies rather than a generic housekeeping note.

Full reset of the shipped demo organization:

- add person_aliases and person_merges to WIPE_ORDER and to the total DELETE_PLANS map;
- scope both delete statements to the demo organization, never globally;
- place person_aliases before person_merges because merge_id is a child foreign key, and place both before people;
- delete all demo-org aliases and merge receipts so the reseeded demo has no stale sign-in continuity, historical ids, or undo receipts;
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

- before deleting selected demo people, delete aliases whose target is a selected demo person or whose merge_id points to a receipt whose historical retired or survivor id is selected;
- delete person_merges receipts involving any selected demo person, even though their historical ids are not foreign keys;
- run this cleanup before the people delete and after all ordinary live references have been severed; the new person_aliases FK must therefore never make the batch fail;
- preserve aliases and receipts belonging only to non-demo people in the shared organization, marking event-scoped receipts event_deleted when appropriate;
- repeated removeDemoPeople and full reset runs are idempotent and leave no alias/receipt row that names a removed demo identity.

Add integration coverage for all three lifecycle paths, including a shared organization with one non-demo person, an alias targeting that person from a demo merge, a receipt with event-owned movements, a full reset, ordinary event deletion, removeDemoPeople, and a second cleanup run. Assert no cross-tenant deletion, no stale live alias, no stale demo receipt, and no accidental loss of retained non-demo history.

### G. Required P1 regression coverage and unchanged signed contracts

The canonical inventory census is updated from 28 to 29 direct people-reference families. Collision coverage is updated from 13 indexes to 13 indexes plus the person_list_members primary key. The test list must explicitly include entity-scoped import rows, every live people column projection, no-event primary/alias precedence, and full-reset/event-delete/removeDemoPeople lifecycle cleanup.

The signed prototype contract remains unchanged: both entry points, exactly-two Merge…, ordinals and tooltip, default survivor by conference count with one-click override, blank-fill highlights, identical-name email continuity, named collisions, receipt id, toast Undo, and survivor activity-feed Undo. Mirror propagation remains unsuppressed with survivor upsert and retired delete. person_events still moves history and appends fresh survivor tag/stage reassertions for the production latest-row-wins fold. Undo remains whole-operation CAS with clean, edited-since, survivor-remerged refusal, and idempotent replay states.

No stable US/AC IDs or contract documents are minted or edited in this amendment.

## Reset 2026-08-16 by agent:delegator-mrq-235
