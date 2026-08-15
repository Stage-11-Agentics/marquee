/**
 * The sponsor deliverables whose completion writes something beyond its own
 * answers, named by their deterministic template ids.
 *
 * This is a leaf on purpose. The seed generator (plain Node with type stripping)
 * and the Worker both need these identities, and a shared constant is the only
 * way one identity cannot become two — a template id restated in a second file
 * is a deliverable that silently stops writing back the day someone edits one
 * copy. Imports here carry their `.ts` extension for the same reason
 * `reset-demo/seed-modules.ts` does: Node resolves this file directly.
 */

import { seedId } from "../ids.ts";

export const SPONSOR_WRITEBACK_TEMPLATE_IDS = {
  /** Confirms the org-level company facts the event site publishes. */
  companyDetails: seedId("tpl", "sponsor-company-details"),
  /** Fills the linked Session's speaker — the single write path into it. */
  nameYourSpeaker: seedId("tpl", "sponsor-name-your-speaker"),
  /** Fills the linked Session's title and description. */
  sessionContent: seedId("tpl", "sponsor-session-content"),
} as const;
