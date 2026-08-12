/**
 * The setup checklist, and the one thing it is not.
 *
 * Every step here is scoped to ONE conference. Claiming the instance, wiring
 * mail, and everything else that belongs to the machine rather than to the
 * programme are deliberately absent — they live on the Instance panel, which
 * is a different card answering a different question (ruling D8).
 *
 * That is what makes next year's conference cheap: the `＋` beside the switcher
 * produces this same list against a new event, with nothing instance-level to
 * repeat and nothing to claim (AC-280).
 */

export interface ChecklistStep {
  key: string;
  label: string;
  note: string;
  /** Where the step is done. Always a conference-scoped screen. */
  route: string;
  action: string;
}

export const CONFERENCE_CHECKLIST_STEPS: readonly ChecklistStep[] = [
  {
    key: "details",
    label: "Create the conference",
    note: "Name, dates, timezone, and venue",
    route: "/conferences/new",
    action: "Create conference",
  },
  {
    key: "taxonomy",
    label: "Add tracks, formats, and rooms",
    note: "Forms, agenda, and invites all inherit these",
    route: "/settings",
    action: "Open conference settings",
  },
  {
    key: "form",
    label: "Build the call for speakers",
    note: "Fields, participants, rules, and routing — unpublished until you say so",
    route: "/forms",
    action: "Open the form builder",
  },
  {
    key: "evaluation",
    label: "Plan evaluation",
    note: "Scorecard, committee, rounds",
    route: "/evaluation",
    action: "Open the evaluation plan",
  },
  {
    key: "intake",
    label: "Open intake",
    note: "Publishes the call for speakers to the world — your click, never an agent's",
    route: "/forms",
    action: "Open intake",
  },
];

/**
 * Steps that would be wrong on a conference checklist. Named rather than
 * implied, because the failure this guards against is a later ticket quietly
 * adding "configure mail" here and making every second conference re-run the
 * instance setup.
 */
export const INSTANCE_LEVEL_STEP_KEYS = ["claim", "mail", "uploads", "spam", "domain"] as const;
