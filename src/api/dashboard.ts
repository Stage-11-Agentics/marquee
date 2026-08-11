export const DASHBOARD_STAGE_IDS = [
  "submitted",
  "in_review",
  "waved",
  "accepted",
  "onboarding",
  "scheduled",
  "published",
] as const;

export type DashboardStageId = (typeof DASHBOARD_STAGE_IDS)[number];

export interface DashboardCount {
  id: DashboardStageId | string;
  label: string;
  count: number;
  href: string;
  note: string;
}

export interface DashboardWave {
  id: string;
  name: string;
  decision_on: string;
  target_count: number;
  sent_at: number | null;
  accepted_count: number;
  href: string;
}

export interface DashboardTaskPreview {
  person_name: string;
  submission_id: string;
  submission_title: string;
  task_title: string;
  due_at: number;
  overdue: boolean;
  href: string;
}

export interface DashboardSnapshot {
  generated_at: number;
  pipeline: DashboardCount[];
  format_mix: DashboardCount[];
  track_pressure: DashboardCount[];
  waves: DashboardWave[];
  attention: {
    next_wave: DashboardWave | null;
    unreviewed_track: DashboardCount | null;
    overdue_submissions: DashboardCount;
    decided_not_notified: DashboardCount;
  };
  metrics: DashboardCount[];
  task_preview: DashboardTaskPreview[];
}
