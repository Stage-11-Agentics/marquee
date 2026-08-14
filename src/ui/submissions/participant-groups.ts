export interface Participant {
  id: string;
  person_id: string;
  name: string;
  email: string;
  company: string | null;
  role: string;
  confirmation_status: "pending" | "confirmed" | "declined";
  confirmed_at: number | null;
  invited_at: number | null;
}

export interface ParticipantGroup {
  person_id: string;
  name: string;
  email: string;
  company: string | null;
  participants: Participant[];
}

/**
 * A submission has one participation per role, but the record panel is about
 * the people attached to it. Keep the role rows inside one person card so a
 * submitter who is also a speaker is counted once without losing either role's
 * confirmation state or removal action.
 */
export function groupParticipants(participants: Participant[]): ParticipantGroup[] {
  const groups = new Map<string, ParticipantGroup>();
  for (const participant of participants) {
    const group = groups.get(participant.person_id);
    if (group) {
      group.participants.push(participant);
      continue;
    }
    groups.set(participant.person_id, {
      person_id: participant.person_id,
      name: participant.name,
      email: participant.email,
      company: participant.company,
      participants: [participant],
    });
  }
  return [...groups.values()];
}
