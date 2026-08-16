import { parseFormCondition, type FormCondition } from "./form-conditions";

/**
 * Keys owned by participant collection rather than reusable organizer
 * questions. Keep this predicate shared by the API, seed, and picker so a
 * structural speaker slot cannot accidentally become a second answer path.
 */
export const PARTICIPANT_MACHINERY_KEYS = [
  "speaker_name",
  "speaker_email",
  "speaker_role",
  "speaker_company",
  "co_speaker_name",
  "co_speaker_email",
  "co_speaker_role",
  "co_speaker_company",
  "moderator_name",
  "moderator_email",
  "moderator_role",
  "moderator_company",
  "chairperson_name",
  "chairperson_email",
  "chairperson_role",
  "chairperson_company",
  "submitter_name",
  "submitter_email",
  "participant_name",
  "participant_email",
  "other_participant_name",
  "other_participant_email",
] as const;

const PARTICIPANT_MACHINERY_PREFIXES = [
  "speaker_",
  "co_speaker_",
  "moderator_",
  "chairperson_",
  "submitter_",
  "participant_",
  "other_participant_",
] as const;

export function isParticipantMachineryKey(key: string): boolean {
  const normalized = key.trim().toLocaleLowerCase();
  return (PARTICIPANT_MACHINERY_KEYS as readonly string[]).includes(normalized)
    || PARTICIPANT_MACHINERY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function conditionTriggerKeys(condition: unknown): string[] {
  const parsed = parseFormCondition(condition);
  if (!parsed) return [];
  return [...new Set(parsed.all.map((clause) => clause.fieldKey))];
}

export interface MissingConditionWarning {
  code: "missing_condition_trigger";
  missing_keys: string[];
  message: string;
}

export function materializeLibraryCondition(
  condition: FormCondition | null,
  destinationKeys: ReadonlySet<string>,
): { condition: FormCondition | null; warning: MissingConditionWarning | null } {
  if (!condition) return { condition: null, warning: null };
  const missingKeys = conditionTriggerKeys(condition).filter((key) => !destinationKeys.has(key));
  if (missingKeys.length === 0) return { condition, warning: null };
  const triggerLabel = missingKeys.length === 1 ? "trigger" : "triggers";
  return {
    condition: null,
    warning: {
      code: "missing_condition_trigger",
      missing_keys: missingKeys,
      message: `This question shows unconditionally until re-pointed; missing condition ${triggerLabel}: ${missingKeys.join(", ")}.`,
    },
  };
}

export function conditionNote(condition: FormCondition | null): string | null {
  if (!condition?.all.length) return null;
  return condition.all
    .map((clause) => `${clause.fieldKey} ${clause.op.replaceAll("_", " ")}${clause.value === undefined ? "" : ` ${String(clause.value)}`}`)
    .join(" · ");
}
