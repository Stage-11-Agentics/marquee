/**
 * The sponsor deliverables whose completion writes something beyond its own
 * answers, named by their deterministic template ids.
 *
 * This leaf imports NOTHING on purpose. The seed generator runs on plain Node
 * with type stripping, the Worker runs through Vite, and the two disagree about
 * whether a relative import may carry its `.ts` extension — so a shared constant
 * that reaches for a helper cannot be imported by both. A template id restated in
 * a second file is a deliverable that silently stops writing back the day someone
 * edits one copy, so the constant is shared and the literals are the constant.
 *
 * They are exactly `seedId("tpl", <key>)`, and
 * `tests/node/sponsor-deliverable-templates.test.mjs` asserts that rather than
 * trusting it.
 */

export const SPONSOR_WRITEBACK_TEMPLATE_IDS = {
  /** Confirms the org-level company facts the event site publishes. */
  companyDetails: "tpl_sponsor-company-details",
  /** Fills the linked Session's speaker — the single write path into it. */
  nameYourSpeaker: "tpl_sponsor-name-your-speaker",
  /** Fills the linked Session's title and description. */
  sessionContent: "tpl_sponsor-session-content",
} as const;
