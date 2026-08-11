export type SubmissionListStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "accepted"
  | "waitlisted"
  | "rejected"
  | "withdrawn"
  | "waved"
  | "unreviewed"
  | "onboarding"
  | "scheduled"
  | "published";

export interface SubmissionTrackListItem {
  id: string;
  name: string;
  color: string;
  is_primary: boolean;
}

export interface SubmissionSpeakerListItem {
  id: string;
  name: string;
  company: string | null;
}

export interface SubmissionSlotListItem {
  starts_at: number;
  duration_min: number;
  room: string;
  building: string;
  timezone: string;
  is_published: boolean;
}

export interface SubmissionListItem {
  id: string;
  kind: "abstract" | "session";
  title: string;
  status: SubmissionListStatus;
  format_id: string | null;
  format: string | null;
  speakers: SubmissionSpeakerListItem[];
  tracks: SubmissionTrackListItem[];
  score: number | null;
  submitted_at: number | null;
  updated_at: number;
  origin: "public" | "admin" | "import";
  missing_fields: string[];
  slot: SubmissionSlotListItem | null;
}
