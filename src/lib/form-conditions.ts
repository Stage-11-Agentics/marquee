/**
 * Shared form-condition contract.
 *
 * This file is deliberately small and dependency-free: the builder preview,
 * public form, server writers, and the draft queue all need the same answer
 * to "does this field apply?". Later form surfaces add consumers here; they do
 * not create a second evaluator.
 */

export const FORM_CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "answered",
  "not_answered",
] as const;

export type FormConditionOperator = (typeof FORM_CONDITION_OPERATORS)[number];
export type FormAnswerValue =
  | string
  | number
  | boolean
  | null
  | FormAnswerValue[]
  | { [key: string]: FormAnswerValue };

export interface FormConditionClause {
  fieldKey: string;
  op: FormConditionOperator | string;
  value?: FormAnswerValue;
}

/** Persisted in `form_fields.condition` as JSON. */
export interface FormCondition {
  all: FormConditionClause[];
}

export interface FormFieldConditionInput {
  condition?: unknown;
}

export interface FormFieldAnswerInput extends FormFieldConditionInput {
  key: string;
  required?: boolean | 0 | 1;
  type?: string;
  config?: unknown;
}

export interface FormValidationIssue {
  fieldKey: string;
  message: string;
  /** Internal classification for constraints that span more than one field. */
  kind?: "form_length_rule";
  /** Every field participating in a group-level constraint. */
  fieldKeys?: readonly string[];
}

export interface ProjectedFormAnswers {
  answers: Record<string, FormAnswerValue>;
  issues: FormValidationIssue[];
}

/** A form-owned group of text fields with one printed-block ceiling. */
export interface FormLengthRule {
  id?: string;
  label: string;
  field_keys: string[];
  max_chars: number;
  sort_order?: number;
}

export interface FormLengthRuleEvaluation extends FormLengthRule {
  character_count: number;
  over_by: number;
  disabled: boolean;
  missing_field_keys: string[];
}

const COMBINED_LENGTH_FIELD_TYPES = new Set(["short_text", "long_text", "email", "url"]);

export function isCombinedLengthField(field: Pick<FormFieldAnswerInput, "type">): boolean {
  return typeof field.type === "string" && COMBINED_LENGTH_FIELD_TYPES.has(field.type);
}

type DecodeResult =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "valid"; condition: FormCondition };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAnswerValue(value: unknown): value is FormAnswerValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return Number.isFinite(value as number) || typeof value !== "number";
  }
  if (Array.isArray(value)) return value.every(isAnswerValue);
  return isRecord(value) && Object.values(value).every(isAnswerValue);
}

function decodeCondition(input: unknown): DecodeResult {
  if (input === null || input === undefined || input === "") return { kind: "none" };
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return { kind: "invalid" };
    }
  }
  if (!isRecord(value) || !Array.isArray(value.all)) return { kind: "invalid" };
  const clauses: FormConditionClause[] = [];
  for (const clause of value.all) {
    if (!isRecord(clause) || typeof clause.fieldKey !== "string" || clause.fieldKey.length === 0) {
      return { kind: "invalid" };
    }
    if (typeof clause.op !== "string" || clause.op.length === 0) return { kind: "invalid" };
    if ("value" in clause && !isAnswerValue(clause.value)) return { kind: "invalid" };
    clauses.push({
      fieldKey: clause.fieldKey,
      op: clause.op,
      ...(Object.prototype.hasOwnProperty.call(clause, "value") ? { value: clause.value as FormAnswerValue } : {}),
    });
  }
  return { kind: "valid", condition: { all: clauses } };
}

/** Parse a stored or API condition without changing its persisted shape. */
export function parseFormCondition(input: unknown): FormCondition | null {
  const decoded = decodeCondition(input);
  return decoded.kind === "valid" ? decoded.condition : null;
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function scalarEqual(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) return actual.some((item) => scalarEqual(item, expected));
  if (Array.isArray(expected)) return expected.some((item) => scalarEqual(actual, item));
  return actual === expected || String(actual) === String(expected);
}

function clauseMatches(clause: FormConditionClause, answers: Record<string, unknown>): boolean {
  const actual = answers[clause.fieldKey];
  switch (clause.op) {
    case "equals":
    case "eq":
    case "is":
      return scalarEqual(actual, clause.value);
    case "not_equals":
    case "neq":
    case "is_not":
      return !scalarEqual(actual, clause.value);
    case "contains":
    case "includes":
      return Array.isArray(actual)
        ? actual.some((item) => scalarEqual(item, clause.value))
        : typeof actual === "string" && typeof clause.value === "string"
          ? actual.includes(clause.value)
          : false;
    case "not_contains":
    case "not_includes":
      return !clauseMatches({ ...clause, op: "contains" }, answers);
    case "answered":
    case "exists":
      return isPresent(actual);
    case "not_answered":
    case "not_exists":
      return !isPresent(actual);
    default:
      return false;
  }
}

/**
 * The one shared applicability decision. A malformed condition is fail-closed
 * so an invalid stored rule can never make a hidden field required or persist
 * a value by accident.
 */
export function isFieldApplicable(
  field: FormFieldConditionInput,
  answers: Record<string, unknown>,
): boolean {
  const decoded = decodeCondition(field.condition);
  if (decoded.kind === "none") return true;
  if (decoded.kind === "invalid") return false;
  return decoded.condition.all.every((clause) => clauseMatches(clause, answers));
}

function readConfig(config: unknown): Record<string, unknown> {
  if (typeof config === "string") {
    try {
      config = JSON.parse(config) as unknown;
    } catch {
      return {};
    }
  }
  return isRecord(config) ? config : {};
}

function emptyAnswer(value: unknown): boolean {
  return !isPresent(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** A calendar date has no time or zone; keep its persisted form exact. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1]!;
}

function normalizedValue(field: FormFieldAnswerInput, value: unknown): FormAnswerValue | null {
  if (field.type === "date") return isIsoDate(value) ? value : null;
  return isAnswerValue(value) ? value : null;
}

function validateField(field: FormFieldAnswerInput, value: unknown): string | null {
  const config = readConfig(field.config);
  if (emptyAnswer(value)) return field.required ? "This field is required." : null;
  switch (field.type) {
    case "short_text":
    case "long_text":
      if (typeof value !== "string") return "Enter text for this field.";
      break;
    case "email":
      if (typeof value !== "string" || !/^\S+@\S+\.\S+$/.test(value)) return "Enter a valid email address.";
      break;
    case "url":
      if (typeof value !== "string") return "Enter a valid URL.";
      try {
        const url = new URL(value);
        if (!/^https?:$/.test(url.protocol)) return "Enter a valid URL.";
      } catch {
        return "Enter a valid URL.";
      }
      break;
    case "number":
      if (asNumber(value) === null) return "Enter a number.";
      break;
    case "date":
      if (!isIsoDate(value)) return "Enter a valid date in YYYY-MM-DD format.";
      break;
    case "single_select":
      if (typeof value !== "string") return "Choose one option.";
      break;
    case "multi_select":
      if (!Array.isArray(value)) return "Choose one or more options.";
      break;
    case "file":
      if (!(typeof value === "string" || isRecord(value))) return "Choose a file.";
      break;
    default:
      break;
  }

  const text = typeof value === "string" ? value : null;
  const supportsTextRules = field.type === "short_text" || field.type === "long_text" || field.type === "email" || field.type === "url";
  const minLength = asNumber(config.minLength);
  const maxLength = asNumber(config.maxLength);
  if (supportsTextRules && text !== null && minLength !== null && text.length < minLength) return `Use at least ${minLength} characters.`;
  if (supportsTextRules && text !== null && maxLength !== null && text.length > maxLength) return `Use no more than ${maxLength} characters.`;
  const number = asNumber(value);
  const min = asNumber(config.min);
  const max = asNumber(config.max);
  if (number !== null && min !== null && number < min) return `Use a number of at least ${min}.`;
  if (number !== null && max !== null && number > max) return `Use a number of no more than ${max}.`;
  if (supportsTextRules && typeof config.pattern === "string") {
    try {
      if (text === null || !new RegExp(config.pattern).test(text)) return "Use the requested format.";
    } catch {
      return "Use the requested format.";
    }
  }
  const options = Array.isArray(config.options) ? config.options : null;
  if (options && (field.type === "single_select" || field.type === "multi_select")) {
    const values = Array.isArray(value) ? value : [value];
    if (!values.every((item) => options.some((option) => scalarEqual(option, item)))) return "Choose an available option.";
    const minItems = asNumber(config.minItems);
    const maxItems = asNumber(config.maxItems);
    if (field.type === "multi_select" && minItems !== null && values.length < minItems) return `Choose at least ${minItems} options.`;
    if (field.type === "multi_select" && maxItems !== null && values.length > maxItems) return `Choose no more than ${maxItems} options.`;
  }
  return null;
}

/**
 * Project a raw answer map onto the currently visible fields and validate it.
 * Unknown keys and values for hidden fields are intentionally omitted. A
 * caller must persist only `answers` from this result.
 */
export function projectApplicableAnswers(
  fields: readonly FormFieldAnswerInput[],
  rawAnswers: Record<string, unknown>,
  lengthRules: readonly FormLengthRule[] = [],
): ProjectedFormAnswers {
  const answers: Record<string, FormAnswerValue> = {};
  const issues: FormValidationIssue[] = [];
  for (const field of fields) {
    if (!isFieldApplicable(field, rawAnswers)) continue;
    const value = rawAnswers[field.key];
    const issue = validateField(field, value);
    if (issue) issues.push({ fieldKey: field.key, message: issue });
    if (!emptyAnswer(value)) {
      const normalized = normalizedValue(field, value);
      if (normalized !== null) answers[field.key] = normalized;
    }
  }
  if (lengthRules.length > 0) {
    for (const violation of formLengthRuleIssues(lengthRules, fields, answers)) issues.push(violation);
  }
  return { answers, issues };
}

/**
 * Evaluate every configured group against the already-projected answer map.
 * Missing or non-text field keys soft-disable a rule: a deleted question must
 * never become a ghost constraint, but the author still needs to see Fix rule.
 */
export function evaluateFormLengthRules(
  rules: readonly FormLengthRule[],
  fields: readonly FormFieldAnswerInput[],
  answers: Record<string, unknown>,
): FormLengthRuleEvaluation[] {
  if (rules.length === 0) return [];
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  return [...rules]
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || String(left.id ?? "").localeCompare(String(right.id ?? "")))
    .map((rule) => {
      const fieldKeys = Array.isArray(rule.field_keys) ? rule.field_keys : [];
      const missing = fieldKeys.filter((key) => {
        const field = fieldsByKey.get(key);
        return !field || !isCombinedLengthField(field);
      });
      const characterCount = missing.length > 0
        ? 0
        : fieldKeys.reduce((total, key) => total + (typeof answers[key] === "string" ? (answers[key] as string).length : 0), 0);
      const maxChars = Number(rule.max_chars);
      const disabled = missing.length > 0 || !Number.isFinite(maxChars) || maxChars <= 0 || fieldKeys.length === 0;
      const overBy = disabled ? 0 : Math.max(0, characterCount - maxChars);
      return {
        ...rule,
        field_keys: fieldKeys,
        max_chars: maxChars,
        character_count: characterCount,
        over_by: overBy,
        disabled,
        missing_field_keys: missing,
      };
    });
}

export function formLengthRuleIssues(
  rules: readonly FormLengthRule[],
  fields: readonly FormFieldAnswerInput[],
  projectedAnswers: Record<string, unknown>,
): FormValidationIssue[] {
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  return evaluateFormLengthRules(rules, fields, projectedAnswers)
    .filter((rule) => !rule.disabled && rule.over_by > 0)
    .map((rule) => {
      // A hidden first member cannot receive MRQ-240's recovery focus. Keep
      // the rule's order, but hand the client the first member that is
      // actually rendered under the projected answers.
      const firstVisibleKey = rule.field_keys.find((key) => {
        const field = fieldsByKey.get(key);
        return field !== undefined && isFieldApplicable(field, projectedAnswers);
      });
      return {
        fieldKey: firstVisibleKey ?? "",
        kind: "form_length_rule" as const,
        fieldKeys: rule.field_keys,
        message: `${rule.label} is ${rule.over_by} characters over its ${rule.max_chars}-character limit.`,
      };
    });
}

/** Stable preview projection shared by builder and public-form consumers. */
export function fieldPreviewProjection(
  fields: readonly (Pick<FormFieldAnswerInput, "key" | "type" | "required" | "condition"> & { label: string; position: number })[],
) {
  return [...fields]
    .sort((left, right) => left.position - right.position || left.key.localeCompare(right.key))
    .map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type ?? "short_text",
      position: field.position,
      required: field.required === true || field.required === 1,
      condition: parseFormCondition(field.condition),
    }));
}
