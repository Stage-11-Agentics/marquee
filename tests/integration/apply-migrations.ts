import { env as rawEnv } from "cloudflare:test";

import migrationSql from "../../migrations/0001_init.sql?raw";
import venueGeographyMigrationSql from "../../migrations/0002_venue_geography.sql?raw";
import venueAccessNoteMigrationSql from "../../migrations/0003_building_access_note.sql?raw";
import calendarReversalMigrationSql from "../../migrations/0004_calendar_reversal.sql?raw";
import taskCancellationWebhooksMigrationSql from "../../migrations/0005_task_cancellation_webhooks.sql?raw";
import auditRequestIdMigrationSql from "../../migrations/0006_audit_log_request_id.sql?raw";
import embedWidgetKindsMigrationSql from "../../migrations/0007_embed_widget_kinds.sql?raw";
import formFieldDatesMigrationSql from "../../migrations/0008_form_field_dates.sql?raw";
import personCustomFieldsMigrationSql from "../../migrations/0009_person_custom_fields.sql?raw";
import fileCommentsMigrationSql from "../../migrations/0009_file_comments.sql?raw";
import criterionKindsMigrationSql from "../../migrations/0009_criterion_kinds.sql?raw";
import boundFormOptionsMigrationSql from "../../migrations/0010_bound_form_options.sql?raw";
import savedEmbedsMigrationSql from "../../migrations/0010_saved_embeds.sql?raw";
import evaluationRoundCommitteesMigrationSql from "../../migrations/0010_evaluation_round_committees.sql?raw";
import coldStartMigrationSql from "../../migrations/0011_cold_start.sql?raw";
import publicSchedulesMigrationSql from "../../migrations/0011_public_schedules.sql?raw";
import peopleAnnotationsMigrationSql from "../../migrations/0012_people_annotations.sql?raw";
import agentEvaluatorSeatsMigrationSql from "../../migrations/0013_agent_evaluator_seats.sql?raw";
import inboundDeliveryStateMigrationSql from "../../migrations/0014_inbound_delivery_state.sql?raw";
import evaluationOverridesMigrationSql from "../../migrations/0015_evaluation_overrides.sql?raw";
import peopleImportUndoReceiptsMigrationSql from "../../migrations/0016_people_import_undo_receipts.sql?raw";
import orgSettingsMigrationSql from "../../migrations/0017_org_settings.sql?raw";
import eventDeletionMigrationSql from "../../migrations/0018_event_deletion.sql?raw";
import outreachTargetingMigrationSql from "../../migrations/0019_outreach_targeting.sql?raw";
// Both 0020 migrations are present after the rebase. Keep their lexical order:
// the portal rebuild carries forward the invite-seat columns added first.
import orgInviteSeatsMigrationSql from "../../migrations/0020_org_invite_seats.sql?raw";
import portalInvitesMigrationSql from "../../migrations/0020_portal_invites.sql?raw";
import auditOrgScopeMigrationSql from "../../migrations/0021_audit_log_org_scope.sql?raw";
import attendeeSchedulesMigrationSql from "../../migrations/0022_attendee_schedules.sql?raw";
import sponsorsMigrationSql from "../../migrations/0023_sponsors.sql?raw";
import airtableOutboundMigrationSql from "../../migrations/0024_airtable_outbound.sql?raw";
import airtableConnectMigrationSql from "../../migrations/0025_airtable_connect.sql?raw";
import calendarTruthMigrationSql from "../../migrations/0026_calendar_truth.sql?raw";
import airtableDecisionActorMigrationSql from "../../migrations/0027_airtable_decision_actor.sql?raw";
import participantFanoutMigrationSql from "../../migrations/0028_participant_fanout.sql?raw";
import submissionNotesMigrationSql from "../../migrations/0029_submission_notes.sql?raw";
import submissionReferenceCodesMigrationSql from "../../migrations/0030_submission_reference_codes.sql?raw";
import submissionCapacityMigrationSql from "../../migrations/0031_submission_capacity.sql?raw";
import type { Env } from "../../src/index";
import { WIPE_ORDER } from "../../src/lib/reset-demo/reseed-demo";

export const env = rawEnv as unknown as Env;

/**
 * D1's `exec()` splits on bare newlines, which breaks on this file's
 * multi-line `CREATE TABLE` statements — so each top-level statement (every
 * one of which ends its own line with `;` in this migration) is run
 * individually via `prepare().run()` instead. `CREATE TRIGGER … BEGIN … END;`
 * bodies contain their own internal `;\n`-terminated statements, so chunks
 * that open a `BEGIN` without a matching `END` are re-merged with whatever
 * follows until the trigger's `END` closes them.
 */
function splitStatements(sql: string): string[] {
  const chunks = sql
    .split(/;\s*\n/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
  const statements: string[] = [];
  let pending: string | null = null;
  for (const chunk of chunks) {
    if (pending !== null) {
      pending = `${pending};\n${chunk}`;
      if (/\bEND\b/.test(chunk)) {
        statements.push(pending);
        pending = null;
      }
      continue;
    }
    if (/\bBEGIN\b/.test(chunk) && !/\bEND\b/.test(chunk)) {
      pending = chunk;
      continue;
    }
    statements.push(chunk);
  }
  if (pending !== null) statements.push(pending);
  return statements;
}

/**
 * Storage persists across `test()` calls within a file (isolatedStorage only
 * scopes to request/queue entry points, not raw `env.DB` access from the test
 * body). The D1 authorizer used here rejects `DROP TABLE`, so on every call
 * after the first, wipe rows (same FK-safe order the reseed uses) instead of
 * dropping and recreating the schema.
 */
export async function applyMigrations(): Promise<void> {
  const alreadyApplied = await env.DB.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'organizations'",
  ).first();
  if (alreadyApplied) {
    const calendarTruthApplied = await env.DB.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'calendar_cancellations'",
    ).first();
    await env.DB.batch(WIPE_ORDER.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
    if (calendarTruthApplied) {
      // WIPE_ORDER already clears both calendar tables for test isolation.
      // Production reset deliberately preserves the ledger through its null
      // DELETE_PLANS entry; this helper is intentionally a different path.
    } else {
      for (const statement of splitStatements(calendarTruthMigrationSql)) {
        await env.DB.prepare(`${statement};`).run();
      }
    }
    return;
  }
  for (const statement of [
    ...splitStatements(migrationSql),
    ...splitStatements(venueGeographyMigrationSql),
    ...splitStatements(venueAccessNoteMigrationSql),
    ...splitStatements(calendarReversalMigrationSql),
    ...splitStatements(taskCancellationWebhooksMigrationSql),
    ...splitStatements(auditRequestIdMigrationSql),
    ...splitStatements(embedWidgetKindsMigrationSql),
    ...splitStatements(formFieldDatesMigrationSql),
    ...splitStatements(personCustomFieldsMigrationSql),
    ...splitStatements(fileCommentsMigrationSql),
    ...splitStatements(criterionKindsMigrationSql),
    ...splitStatements(boundFormOptionsMigrationSql),
    ...splitStatements(savedEmbedsMigrationSql),
    ...splitStatements(evaluationRoundCommitteesMigrationSql),
    ...splitStatements(coldStartMigrationSql),
    ...splitStatements(publicSchedulesMigrationSql),
    ...splitStatements(peopleAnnotationsMigrationSql),
    ...splitStatements(agentEvaluatorSeatsMigrationSql),
    ...splitStatements(inboundDeliveryStateMigrationSql),
    ...splitStatements(evaluationOverridesMigrationSql),
    ...splitStatements(peopleImportUndoReceiptsMigrationSql),
    ...splitStatements(orgSettingsMigrationSql),
    ...splitStatements(eventDeletionMigrationSql),
    ...splitStatements(outreachTargetingMigrationSql),
    ...splitStatements(orgInviteSeatsMigrationSql),
    ...splitStatements(portalInvitesMigrationSql),
    ...splitStatements(auditOrgScopeMigrationSql),
    ...splitStatements(attendeeSchedulesMigrationSql),
    ...splitStatements(sponsorsMigrationSql),
    ...splitStatements(airtableOutboundMigrationSql),
    ...splitStatements(airtableConnectMigrationSql),
    ...splitStatements(calendarTruthMigrationSql),
    ...splitStatements(airtableDecisionActorMigrationSql),
    ...splitStatements(participantFanoutMigrationSql),
    ...splitStatements(submissionNotesMigrationSql),
    ...splitStatements(submissionReferenceCodesMigrationSql),
    ...splitStatements(submissionCapacityMigrationSql),
  ]) {
    await env.DB.prepare(`${statement};`).run();
  }
}
