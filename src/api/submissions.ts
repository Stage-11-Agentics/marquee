/** Row statuses are derived output; filter-only tokens such as accepted_any stay out. */
export const SUBMISSION_LIST_STATUSES = [
  "draft",
  "submitted",
  "in_review",
  "accepted",
  "waitlisted",
  "rejected",
  "withdrawn",
  "waved",
  "unreviewed",
  "onboarding",
  "scheduled",
  "published",
] as const;

export type SubmissionListStatus = (typeof SUBMISSION_LIST_STATUSES)[number];

export interface SubmissionTrackListItem {
  id: string;
  name: string;
  color: string;
  is_primary: boolean;
}

export type SubmissionParticipationRole =
  | "speaker"
  | "co_speaker"
  | "moderator"
  | "chairperson"
  | "submitter"
  | "sponsor_contact";

export interface SubmissionSpeakerListItem {
  id: string;
  name: string;
  company: string | null;
  role?: SubmissionParticipationRole;
  confirmation_status?: "pending" | "confirmed" | "declined";
}

export interface SubmissionSubmitterListItem {
  id: string;
  name: string;
  email: string;
}

export interface SubmissionSlotListItem {
  starts_at: number;
  duration_min: number;
  room: string;
  building: string;
  timezone: string;
  is_published: boolean;
  show_building: boolean;
}

export type SubmissionNotificationState =
  | "sent"
  | "changed_in_airtable"
  | "not_delivered"
  | "no_valid_address";

export interface SubmissionNotificationAction {
  label: string;
  route: string;
}

export interface SubmissionNotification {
  state: SubmissionNotificationState;
  label: string;
  detail: string;
  sent_at: number | null;
  outbox_status: "queued" | "sent" | "suppressed" | "failed" | null;
  action: SubmissionNotificationAction | null;
}

export interface SubmissionAgentReview {
  id: string;
  name: string;
  /** What the Agent seat itself recorded, kept even when a chair overrode it. */
  score: number | null;
  /** The chair's value, when one governs; null when the agent's own stands. */
  override_score: number | null;
  recommendation: string | null;
  comment: string | null;
}

export interface SubmissionListItem {
  id: string;
  reference_code: string | null;
  kind: "abstract" | "session";
  title: string;
  status: SubmissionListStatus;
  format_id: string | null;
  format: string | null;
  speakers: SubmissionSpeakerListItem[];
  tracks: SubmissionTrackListItem[];
  score: number | null;
  /** Non-abstained evaluations behind `score`. "4.7 from 1 review" is not 4.7. */
  review_count: number;
  /** False when `score` fell back to a pre-criteria scalar and is not weighted. */
  score_is_weighted: boolean;
  /** Agent evidence is deliberately separate from the human aggregate. */
  agent_reviews: SubmissionAgentReview[];
  submitted_at: number | null;
  last_saved_at: number | null;
  updated_at: number;
  origin: "public" | "admin" | "import";
  closes_at: number | null;
  close_label: string;
  form_closed: boolean;
  form_actionable: boolean;
  missing_fields: string[];
  submitter: SubmissionSubmitterListItem | null;
  slot: SubmissionSlotListItem | null;
  notified: SubmissionNotification | null;
}
