import type { SubmissionSpeakerListItem } from "../api/submissions";
import { WORK_HOLDING_PARTICIPATION_ROLES } from "./participants";

/**
 * Roles whose attendance makes two agenda Sessions conflict — the on-stage
 * population, read from the one place that defines it rather than restated
 * here. A person cannot be in two rooms at once precisely when the conference
 * is asking them to be in one, so this set and the work fan-out's set are the
 * same fact and move together.
 */
export const AGENDA_PARTICIPATION_ROLES = WORK_HOLDING_PARTICIPATION_ROLES;

export type AgendaParticipationRole = (typeof AGENDA_PARTICIPATION_ROLES)[number];

const agendaRoles = new Set<string>(AGENDA_PARTICIPATION_ROLES);

function rolePriority(role: SubmissionSpeakerListItem["role"]): number {
  if (role && agendaRoles.has(role)) return 2;
  return role === undefined ? 1 : 0;
}

/** Keep the display projection one row per person even when they hold two roles. */
export function dedupeParticipants(
  participants: readonly SubmissionSpeakerListItem[],
): SubmissionSpeakerListItem[] {
  const output: SubmissionSpeakerListItem[] = [];
  const indexes = new Map<string, number>();
  for (const participant of participants) {
    const existingIndex = indexes.get(participant.id);
    if (existingIndex === undefined) {
      indexes.set(participant.id, output.length);
      output.push(participant);
      continue;
    }
    const existing = output[existingIndex]!;
    if (rolePriority(participant.role) > rolePriority(existing.role)) output[existingIndex] = participant;
  }
  return output;
}

/**
 * Project the participant set used by every computed agenda conflict class.
 * Older in-memory fixtures omit role; those rows remain speaker-compatible.
 *
 * A Session whose only participant is its `submitter` falls back to that
 * person. The organizer's "+ Add session" records one participation, of role
 * `submitter`, while the public form writes the same human twice — submitter
 * and speaker. Every organizer surface prints the submitter either way, so
 * without the fallback the agenda names a human on the tile and the conflict
 * panel simultaneously believes nobody is on that stage. The fallback fires
 * only when no participant holds an agenda role, so a Session someone
 * submitted *on behalf of* a speaker keeps exactly the conflicts that speaker
 * earns and gains none of the submitter's.
 */
export function conflictParticipants(
  participants: readonly SubmissionSpeakerListItem[],
): SubmissionSpeakerListItem[] {
  const deduped = dedupeParticipants(participants);
  const onStage = deduped.filter((participant) =>
    participant.role === undefined || agendaRoles.has(participant.role),
  );
  if (onStage.length) return onStage;
  return deduped.filter((participant) => participant.role === "submitter");
}

export function sharedConflictParticipants(
  left: readonly SubmissionSpeakerListItem[],
  right: readonly SubmissionSpeakerListItem[],
): SubmissionSpeakerListItem[] {
  const rightIds = new Set(conflictParticipants(right).map((participant) => participant.id));
  return conflictParticipants(left).filter((participant) => rightIds.has(participant.id));
}
