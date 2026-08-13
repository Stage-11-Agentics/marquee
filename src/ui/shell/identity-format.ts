/**
 * Pure formatting for the shell's identity slot. Kept clear of preact and the
 * api client so it can be exercised in the node project rather than a Worker
 * isolate — these are string rules, and string rules should be cheap to test.
 */

/** The organizer's vocabulary, not the schema's. */
const ROLE_LABELS: Record<string, string> = {
  owner: "Organizer",
  admin: "Organizer",
  program_lead: "Program lead",
  reviewer: "Reviewer",
  speaker: "Speaker",
};

export function roleLabel(role: string | undefined | null): string {
  if (!role) return "Signed in";
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
}

/**
 * How a person is on a session, in the organizer's words. Distinct from
 * `roleLabel`, which names a membership: "Co-speaker" is a stage credit, not
 * an account role, and "Co speaker" is neither.
 */
const PARTICIPATION_ROLE_LABELS: Record<string, string> = {
  speaker: "Speaker",
  co_speaker: "Co-speaker",
  moderator: "Moderator",
  chairperson: "Chairperson",
  submitter: "Submitter",
  sponsor_contact: "Sponsor contact",
};

export function participationRoleLabel(role: string | undefined | null): string {
  if (!role) return "Speaker";
  return PARTICIPATION_ROLE_LABELS[role]
    ?? role.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
}

/**
 * One person holds several memberships — the seeded program committee is owner,
 * program_lead and reviewer at once — and /auth/me returns them in whatever
 * order the query produced. Labelling an owner "Reviewer" because that row
 * sorted first would be worse than showing nothing, so the widest standing
 * wins rather than the first one seen.
 */
const ROLE_PRECEDENCE = ["owner", "admin", "program_lead", "reviewer", "speaker"];

export function primaryRole(memberships: { role: string }[] | undefined | null): string | undefined {
  const roles = (memberships ?? []).map((membership) => membership.role).filter(Boolean);
  if (roles.length === 0) return undefined;
  const ranked = [...roles].sort((left, right) => {
    const leftRank = ROLE_PRECEDENCE.indexOf(left);
    const rightRank = ROLE_PRECEDENCE.indexOf(right);
    return (leftRank < 0 ? ROLE_PRECEDENCE.length : leftRank) - (rightRank < 0 ? ROLE_PRECEDENCE.length : rightRank);
  });
  return ranked[0];
}

/**
 * Two letters, from a name that may be one word, may carry diacritics or
 * astral-plane characters, and may be very long. What matters is that nothing
 * throws on real-ugly data and the result is always one or two characters,
 * because the avatar is a fixed 28px box that must not resize.
 */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  const first = [...words[0]][0] ?? "";
  const last = words.length > 1 ? [...words[words.length - 1]][0] ?? "" : "";
  return (first + last).toLocaleUpperCase();
}
