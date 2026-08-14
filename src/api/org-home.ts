export const ORG_HOME_ROUTE = "/api/v1/org/home";
export const ORG_ACTIVITY_HREF = "/org/settings?tab=activity";
export const ORG_HOME_CREATE_HREF = "/conferences/new";

export const ORG_HOME_ATTENTION_IDS = [
  "overdue_outreach",
  "stale_seats",
  "server_status",
] as const;

export type OrgHomeAttentionId = (typeof ORG_HOME_ATTENTION_IDS)[number];
export type OrgHomeAttentionState = "ready" | "empty" | "unavailable";
export type OrgHomeLifecycle = "draft" | "upcoming" | "live" | "ended";

export interface OrgHomeSeason {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: string;
  lifecycle: OrgHomeLifecycle;
  lifecycle_label: string;
  submission_count: number;
  speaker_count: number;
  session_count: number;
  links: {
    dashboard: string;
  };
}

export interface OrgHomeRelationshipMetric {
  value: number | null;
  state: "ready" | "unavailable";
  note: string;
  href: string;
}

export interface OrgHomeAttentionItem {
  id: string;
  person_name: string | null;
  event_name: string | null;
  role: string | null;
  due_at: number | null;
  href: string;
}

export interface OrgHomeServerStatus {
  host: string;
  configured: number;
  total: number;
  status: "ok" | "attention";
  rows: Array<{
    key: "mail" | "uploads" | "spam" | "domain";
    label: string;
    configured: boolean;
    note: string;
  }>;
}

export interface OrgHomeAttention {
  id: OrgHomeAttentionId;
  label: string;
  state: OrgHomeAttentionState;
  status: "ok" | "attention" | "unavailable";
  count: number | null;
  title: string;
  detail: string;
  href: string | null;
  item: OrgHomeAttentionItem | null;
  server: OrgHomeServerStatus | null;
}

export interface OrgHomeActivity {
  id: string;
  event_id: string;
  event_name: string;
  actor_name: string;
  actor_kind: string;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: number;
  href: string;
}

export interface OrgHomeSnapshot {
  organization: {
    id: string;
    name: string;
  };
  seasons: OrgHomeSeason[];
  next_season: OrgHomeSeason | null;
  create_conference_href: string;
  relationships: {
    people: OrgHomeRelationshipMetric;
    returning_speakers: OrgHomeRelationshipMetric;
    in_outreach: OrgHomeRelationshipMetric;
    organizers: OrgHomeRelationshipMetric;
  };
  attention: [OrgHomeAttention, OrgHomeAttention, OrgHomeAttention];
  recent_activity: OrgHomeActivity[];
}
