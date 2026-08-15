/**
 * One action, one sentence — for every lens.
 *
 * `audit_log` is one substrate read three ways (the org admin lens, a person's
 * feed, a submission's timeline), and the fastest way to end up with three logs
 * is to let each surface invent its own words for the same row. So the copy
 * lives here, on the server, and every lens ships the rendered sentence on the
 * wire: an agent reading `GET /api/v1/org/activity` gets the same account of the
 * day as the organizer reading the page, which is the whole promise of an
 * agent-native product.
 *
 * The fallback matters as much as the table. Tickets landing in parallel add
 * actions this file has not met yet — organization defaults, ownership
 * transfer — and an unknown action must degrade to a readable line rather than
 * to a blank row, or the log quietly stops being a complete account of itself.
 */

export interface ActivityLine {
  /** The fact, in the organizer's language. Always present. */
  summary: string;
  /** What the payload adds — which roles, which scope, how many. */
  detail: string | null;
}

/** The organization-level vocabulary. Writers use these constants, never literals. */
export const ORG_ACTIVITY_ACTIONS = {
  inviteMinted: "org.invite_minted",
  inviteRevoked: "org.invite_revoked",
  inviteClaimed: "org.invite_claimed",
  /** The cold start: the deploy's one-time link spent, and this instance owned. */
  instanceClaimed: "org.instance_claimed",
  memberRemoved: "org.member_removed",
  tokenCreated: "org.token_created",
  tokenRevoked: "org.token_revoked",
  /** MRQ-207 writes this one; the lens already reads it. */
  defaultsChanged: "org.defaults_changed",
  /** MRQ-207 / MRQ-212 write this one; the lens already reads it. */
  ownershipTransferred: "org.ownership_transferred",
} as const;

export type OrgActivityAction = (typeof ORG_ACTIVITY_ACTIONS)[keyof typeof ORG_ACTIVITY_ACTIONS];

const SUMMARIES: Readonly<Record<string, string>> = {
  [ORG_ACTIVITY_ACTIONS.inviteMinted]: "Invite created",
  [ORG_ACTIVITY_ACTIONS.inviteRevoked]: "Invite revoked",
  [ORG_ACTIVITY_ACTIONS.inviteClaimed]: "Invite accepted",
  [ORG_ACTIVITY_ACTIONS.instanceClaimed]: "Instance claimed",
  [ORG_ACTIVITY_ACTIONS.memberRemoved]: "Organizer access ended",
  [ORG_ACTIVITY_ACTIONS.tokenCreated]: "API token created",
  [ORG_ACTIVITY_ACTIONS.tokenRevoked]: "API token revoked",
  [ORG_ACTIVITY_ACTIONS.defaultsChanged]: "Organization defaults changed",
  [ORG_ACTIVITY_ACTIONS.ownershipTransferred]: "Ownership transferred",

  // The conference-level actions the person and submission lenses read. They
  // predate this file; naming them here is what turns a timeline of
  // `submission.acceptance_reversed` into a timeline someone can read.
  created: "Record created",
  "submission.received": "Submitted",
  "submission.routed": "Routed by rule",
  "submission.reviewed": "Reviewed",
  "submission.conflict_declared": "Conflict declared",
  content_updated: "Content edited",
  content_restored: "Earlier version restored",
  speaker_talk_updated: "Speaker edited their talk",
  speaker_updated: "Speaker profile edited",
  scheduled: "Scheduled",
  published: "Published to the public agenda",
  unpublished: "Removed from the public agenda",
  participant_added: "Speaker added",
  participant_removed: "Speaker removed",
  // The decision writer records the DECISION, not the organizer's verb:
  // `approve`/`maybe`/`deny`. Reading those three back as the words the
  // pipeline uses on screen is most of what makes a timeline legible.
  "submission.approve": "Accepted",
  "submission.maybe": "Moved to Maybe",
  "submission.deny": "Declined",
  "bulk.accept": "Accepted in a bulk action",
  "bulk.waitlist": "Moved to Maybe in a bulk action",
  "bulk.reject": "Declined in a bulk action",
  "bulk.withdraw": "Withdrawn in a bulk action",
  "submission.acceptance_reversed": "Acceptance reversed",
  "submission.decision_mail_queued": "Decision email queued",
  "submission.decision_mail_sent": "Decision email sent",
  "submission.decision_resent": "Decision email resent",
  "submission.message_queued": "Message queued",
  "submission.message_sent": "Message sent",
  "submission.tasks_reconciled": "Speaker tasks updated",
  "submission.tasks_cancelled": "Speaker tasks cancelled",
  "submission.tasks_retained": "Speaker tasks kept",
  "submission.emails_cancelled": "Queued email cancelled",
  "submission.emails_retained": "Queued email kept",
  "submission.calendar_cancelled": "Calendar invitation cancelled",
  "submission.calendar_retained": "Calendar invitation kept",
  "participation.confirmed": "Speaker confirmed",
  "participation.declined": "Speaker declined",
  reviewer_invited: "Reviewer invited",
  reviewer_added_to_committee: "Reviewer added to committee",
  reviewer_removed_from_committee: "Reviewer removed from committee",
  evaluation_score_overridden: "Score overridden",
  evaluation_score_cleared: "Score override cleared",
  evaluation_score_override_cleared: "Score override cleared",
  agent_evaluator_seat_created: "Agent reviewer seat created",
  "form.published_without_mail": "Form published without mail configured",
};

/**
 * An action nobody has written copy for, made readable: `org.invite_minted`
 * reads "Invite minted" rather than disappearing. A row that says something
 * approximate is honest; a row that says nothing is a hole in an append-only
 * log.
 */
function humanize(action: string): string {
  const words = action.replace(/^[a-z_]+\./, "").replace(/[._]+/g, " ").trim();
  if (words.length === 0) return "Change recorded";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function payloadField(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function payloadList(payload: unknown, key: string): string[] {
  if (!payload || typeof payload !== "object") return [];
  const value = (payload as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** UI "Organizer" is schema `program_lead`; the log speaks the organizer's word. */
export function roleLabel(role: string): string {
  if (role === "program_lead") return "Organizer";
  if (role === "owner") return "Owner";
  if (role === "ops") return "Ops";
  if (role === "reviewer") return "Reviewer";
  if (role === "speaker") return "Speaker";
  return role.replace(/[._]/g, " ");
}

function joinDetail(parts: readonly (string | null)[]): string | null {
  const present = parts.filter((part): part is string => typeof part === "string" && part.length > 0);
  return present.length === 0 ? null : present.join(" · ");
}

/**
 * Scope is NOT read out of the payload. An action scoped to one conference
 * records that conference as the row's own `event_id`, so the lens resolves its
 * name by join and every surface — page, API, agent — reads the same word for
 * it. A copy of the name inside the payload would be a second answer, free to
 * go stale the moment a conference is renamed.
 */

const CONTENT_FIELDS = ["title", "abstract", "description"] as const;

/**
 * The content fields that actually differ between the two payloads.
 *
 * `description` is the portal's name for the abstract, so both map to one word
 * — the reader is told what changed about the talk, not which writer wrote the
 * row.
 */
function changedFields(before: unknown, after: unknown): string | null {
  if (!after || typeof after !== "object") return null;
  const previous = (before ?? {}) as Record<string, unknown>;
  const current = after as Record<string, unknown>;
  const changed = new Set<string>();
  for (const field of CONTENT_FIELDS) {
    if (!(field in current)) continue;
    if (before && field in previous && previous[field] === current[field]) continue;
    changed.add(field === "description" ? "abstract" : field);
  }
  if (changed.size === 0) return null;
  const words = [...changed];
  const sentence = words.length === 1 ? words[0]! : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * The line one audit row becomes. `before`/`after` are the parsed payloads —
 * whatever the writer recorded — so a lens never has to know a payload shape.
 */
export function describeActivity(entry: {
  action: string;
  before?: unknown;
  after?: unknown;
}): ActivityLine {
  const summary = SUMMARIES[entry.action] ?? humanize(entry.action);
  const { after, before } = entry;
  switch (entry.action) {
    case ORG_ACTIVITY_ACTIONS.inviteMinted:
    case ORG_ACTIVITY_ACTIONS.inviteClaimed:
    case ORG_ACTIVITY_ACTIONS.instanceClaimed: {
      const role = payloadField(after, "role");
      return { summary, detail: joinDetail([role ? roleLabel(role) : null, payloadField(after, "email")]) };
    }
    case ORG_ACTIVITY_ACTIONS.inviteRevoked: {
      const role = payloadField(before, "role");
      return { summary, detail: role ? roleLabel(role) : null };
    }
    case ORG_ACTIVITY_ACTIONS.memberRemoved: {
      const roles = payloadList(before, "removed_roles").map(roleLabel);
      const sessions = payloadField(after, "revoked_sessions");
      const sessionCount = Number(sessions ?? 0);
      return {
        summary,
        detail: joinDetail([
          roles.length > 0 ? roles.join(", ") : null,
          // Naming what a removal actually revoked is the point of logging it:
          // "access ended" alone leaves the owner wondering whether the link in
          // that person's inbox still works.
          sessionCount > 0 ? `${sessionCount} ${sessionCount === 1 ? "sign-in" : "sign-ins"} revoked` : "no active sign-ins",
        ]),
      };
    }
    case ORG_ACTIVITY_ACTIONS.tokenCreated: {
      const permissions = payloadList(after, "permissions");
      return { summary, detail: joinDetail([payloadField(after, "name"), permissions.length > 0 ? permissions.join(", ") : null]) };
    }
    case ORG_ACTIVITY_ACTIONS.tokenRevoked:
      return { summary, detail: payloadField(before, "name") };
    case ORG_ACTIVITY_ACTIONS.defaultsChanged: {
      const changed = payloadList(after, "changed").map((key) => key.replace(/[._]/g, " "));
      return { summary, detail: changed.length > 0 ? changed.join(", ") : null };
    }
    case ORG_ACTIVITY_ACTIONS.ownershipTransferred:
      return { summary, detail: joinDetail([payloadField(before, "name"), payloadField(after, "name") ? `→ ${payloadField(after, "name")}` : null]) };
    case "content_updated":
    case "content_restored":
    case "speaker_talk_updated":
      // WHICH fields moved, not the record's title: the title is already at the
      // top of the record the reader is looking at, so repeating it says
      // nothing, and it says the same nothing for an edit that only touched the
      // abstract. Naming the changed fields is the part that is not already on
      // screen.
      return { summary, detail: changedFields(before, after) };
    case "submission.received":
      return { summary, detail: payloadField(after, "title") };
    case "submission.routed":
      return { summary, detail: payloadField(after, "rule_name") };
    case "submission.message_queued":
    case "submission.message_sent":
    case "submission.decision_mail_queued":
    case "submission.decision_mail_sent":
    case "submission.decision_resent":
      return { summary, detail: payloadField(after, "subject") ?? payloadField(after, "template_key") };
    default:
      return { summary, detail: null };
  }
}
