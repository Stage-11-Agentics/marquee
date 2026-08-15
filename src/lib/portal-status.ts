/**
 * Customer-facing portal status projection.
 *
 * Database values describe the program team's workflow. Portal readers need
 * the status in their own terms, plus the tone the shared surface can use for
 * its visual treatment. Keep both seats here so a route cannot quietly fall
 * back to title-casing an internal enum.
 */

export type PortalStatusTone = "" | "success" | "warning" | "alarm";
export type PortalStatusSeat = "speaker" | "sponsor";

export interface PortalStatusProjection {
  label: string;
  tone: PortalStatusTone;
}

const SPEAKER_STATUS: Record<string, PortalStatusProjection> = {
  draft: { label: "Draft", tone: "warning" },
  submitted: { label: "Submitted · awaiting review", tone: "" },
  in_review: { label: "Under review", tone: "" },
  accepted: { label: "Accepted", tone: "success" },
  waitlisted: { label: "Maybe", tone: "warning" },
  rejected: { label: "Not selected", tone: "alarm" },
  withdrawn: { label: "Withdrawn", tone: "warning" },
};

const SPONSOR_STATUS: Record<string, PortalStatusProjection> = {
  // The portal is not a sales board. This neutral label says what the sponsor
  // can rely on without exposing the organizer's pipeline stage.
  courting: { label: "Tier selected", tone: "warning" },
  committed: { label: "Confirmed", tone: "success" },
  fulfilled: { label: "Complete", tone: "success" },
};

const UNKNOWN_STATUS: PortalStatusProjection = { label: "Status current", tone: "" };

export function portalStatusProjection(
  seat: PortalStatusSeat,
  status: string,
): PortalStatusProjection {
  const projection = (seat === "speaker" ? SPEAKER_STATUS : SPONSOR_STATUS)[status];
  return projection ? { ...projection } : { ...UNKNOWN_STATUS };
}
