/**
 * The one policy for a submitter changing an abstract after it was sent.
 *
 * A submitted or in-review response remains the submitter's work while the
 * public call is open. Once the call closes, or the program team records a
 * decision, the control stays visible but the reason changes to the fact that
 * actually prevents the write.
 */
export interface SubmitterEditabilityInput {
  submissionStatus: string;
  formStatus: string | null;
  opensAt?: number | null;
  closesAt: number | null;
}

export interface SubmissionEditability {
  enabled: boolean;
  reason: string | null;
}

const UNDECIDED_STATUSES = new Set(["submitted", "in_review"]);

export function submitterEditability(
  input: SubmitterEditabilityInput,
  now = Date.now(),
): SubmissionEditability {
  if (!UNDECIDED_STATUSES.has(input.submissionStatus)) {
    return {
      enabled: false,
      reason: "Editing is closed because the conference has already made a decision.",
    };
  }
  if (
    input.formStatus !== "open"
    || (input.opensAt !== null && input.opensAt !== undefined && input.opensAt > now)
    || (input.closesAt !== null && input.closesAt <= now)
  ) {
    return {
      enabled: false,
      reason: "Editing is closed because the call for speakers is closed.",
    };
  }
  return { enabled: true, reason: null };
}
