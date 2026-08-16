import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { BOUND_SOURCE_LABELS, BOUND_SOURCES, boundSourceOf, isBoundSourceCompatible, type BoundSource } from "../../lib/bound-options";
import { eventTimeLabel, instantToLocalDateTime, localDateTimeToInstant } from "../../lib/event-time";
import { canonicalRoutingFieldKey, evaluateFormLengthRules, evaluateRoutingConditions, fieldPreviewProjection, isCombinedLengthField, isFieldApplicable, projectApplicableAnswers, type FormAnswerValue, type FormCondition, type FormConditionClause, type FormLengthRule } from "../../lib/form-conditions";
import { disambiguatedNames } from "../../lib/duplicate-names";
import { AgentBriefLauncher } from "../shell/AgentBrief";
import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, Chip, EmptyState, PageHeader } from "../shell/components";
import { useEventContext } from "../shell/event-context";
import { SubmissionCapacityEditor } from "./SubmissionCapacityEditor";
import "./forms.css";

type FormKind = "abstract" | "session";
type FormStatus = "draft" | "open" | "closed";
type FieldType = "short_text" | "long_text" | "single_select" | "multi_select" | "url" | "email" | "file" | "number" | "date";

interface FormSummary {
  id: string;
  event_id: string;
  name: string;
  slug: string;
  kind: FormKind;
  status: FormStatus;
  opens_at: number | null;
  closes_at: number | null;
  welcome_md: string;
  per_submitter_limit: number;
  submitter_limit_inherit: boolean;
  effective_submitter_limit: number;
  min_speakers: number;
  max_speakers: number;
  max_sponsors: number;
  response_count: number;
  visibility: "public" | "private";
  public_url: string | null;
  created_at: number;
  updated_at: number;
}

interface FormField {
  id: string;
  form_id: string;
  key: string;
  label: string;
  help_text: string | null;
  type: FieldType;
  required: boolean;
  position: number;
  config: Record<string, unknown>;
  condition: FormCondition | null;
  library_field_id?: string;
  library_field_version?: number;
  created_at: number;
  updated_at: number;
}

interface LibraryQuestion {
  id: string;
  event_id: string;
  key: string;
  label: string;
  help_text: string | null;
  type: FieldType;
  required: boolean;
  config: Record<string, unknown>;
  condition: FormCondition | null;
  condition_note: string | null;
  version: number;
  used_on_forms: number;
  stale_copy_count: number;
  on_destination_form: boolean;
  created_at: number;
  updated_at: number;
}

interface LibraryCopyResult extends FormField {
  warning: { code: string; missing_keys: string[]; message: string } | null;
}

interface FormAdmin {
  id: string;
  person_id: string;
  name: string;
  email: string;
}

interface FormLengthRuleView extends FormLengthRule {
  id: string;
  form_id: string;
  sort_order: number;
  disabled: boolean;
  missing_field_keys: string[];
  created_at: number;
  updated_at: number;
}

interface FormDetail extends FormSummary {
  reminder_offset_hours: number | null;
  thankyou_template_key: string | null;
  admin_notify_person_ids: string[];
  turnstile_required: boolean;
  fields: FormField[];
  length_rules?: FormLengthRuleView[];
  admins: FormAdmin[];
  preview_fields: Array<{ key: string; label: string; type: string; position: number; required: boolean; condition: FormCondition | null }>;
}

interface RoutingRule {
  id: string;
  event_id: string;
  name: string;
  when_json: { all?: FormConditionClause[]; field?: string; op?: string; value?: FormAnswerValue };
  then_json: { track_id?: string | null; add_tag_ids?: string[]; level_id?: string | null; plan_id?: string | null; committee_id?: string | null; round_id?: string | null };
  position: number;
  enabled: boolean;
  dangling_references: string[];
  dangling_reason: string | null;
  summary: string;
  updated_at: number;
}

interface RoutingOption { id: string; name: string; color?: string; position?: number }

interface RoutingRuleDraft {
  id?: string;
  name: string;
  conditions: FormConditionClause[];
  action: {
    track_id: string | null;
    add_tag_ids: string[];
    level_id: string | null;
    plan_id: string | null;
    committee_id: string | null;
    round_id: string | null;
  };
}

interface RoutingPreviewRule {
  rule_id: string;
  state: "matchable" | "skipped" | "dangling" | "invalid";
  would_have_matched: number | null;
  rules_above: number;
  landing: {
    track_id: string | null;
    tag_ids: string[];
    level_id: string | null;
    plan_id: string | null;
    committee_id: string | null;
    round_id: string | null;
  } | null;
  reason: string | null;
}

interface RoutingPreview {
  form_id: string;
  sample_size: number;
  last_arrival_at: number | null;
  max_sample_size: 100;
  rules: RoutingPreviewRule[];
}

const ROUTING_OPERATORS = ["equals", "not_equals", "contains", "not_contains", "answered", "not_answered"] as const;
type RoutingOperator = (typeof ROUTING_OPERATORS)[number];

interface ReviewOption extends RoutingOption {
  status?: string;
  plan_id?: string;
}

function routingConditions(rule: RoutingRule): FormConditionClause[] {
  const raw = Array.isArray(rule.when_json.all)
    ? rule.when_json.all
    : typeof rule.when_json.field === "string"
      ? [{ fieldKey: rule.when_json.field, op: rule.when_json.op ?? "equals", ...(rule.when_json.value === undefined ? {} : { value: rule.when_json.value }) }]
      : [];
  return raw.map((clause) => ({
    fieldKey: canonicalRoutingFieldKey(clause.fieldKey),
    op: clause.op,
    ...(clause.value === undefined ? {} : { value: clause.value }),
  }));
}

function routingAction(rule: RoutingRule): RoutingRuleDraft["action"] {
  const raw = rule.then_json as Record<string, unknown>;
  const tagIds = raw.add_tag_ids ?? raw.addTagIds;
  return {
    track_id: typeof (raw.track_id ?? raw.trackId) === "string" ? String(raw.track_id ?? raw.trackId) : null,
    add_tag_ids: Array.isArray(tagIds) ? tagIds.filter((id): id is string => typeof id === "string") : [],
    level_id: typeof (raw.level_id ?? raw.levelId) === "string" ? String(raw.level_id ?? raw.levelId) : null,
    plan_id: typeof raw.plan_id === "string" ? raw.plan_id : null,
    committee_id: typeof raw.committee_id === "string" ? raw.committee_id : null,
    round_id: typeof raw.round_id === "string" ? raw.round_id : null,
  };
}

function emptyRoutingDraft(fieldKey: string): RoutingRuleDraft {
  return {
    name: "",
    conditions: [{ fieldKey, op: "equals", value: "Yes" }],
    action: { track_id: null, add_tag_ids: [], level_id: null, plan_id: null, committee_id: null, round_id: null },
  };
}

function operatorLabel(operator: string): string {
  return operator.replaceAll("_", " ");
}

function fieldLabelFor(fieldKey: string, choices: Array<{ value: string; label: string }>): string {
  const canonical = canonicalRoutingFieldKey(fieldKey);
  return choices.find((choice) => canonicalRoutingFieldKey(choice.value) === canonical)?.label ?? fieldKey;
}

function conditionSentence(conditions: readonly FormConditionClause[], choices: Array<{ value: string; label: string }>): string {
  if (!conditions.length) return "Always";
  return conditions.map((condition) => {
    const value = condition.value === undefined ? "" : ` ${String(condition.value)}`;
    return `${fieldLabelFor(condition.fieldKey, choices)} ${operatorLabel(condition.op)}${value}`;
  }).join(" and ");
}

function actionSentence(action: RoutingRuleDraft["action"], tracks: RoutingOption[], tags: RoutingOption[], levels: RoutingOption[]): string {
  const track = tracks.find((item) => item.id === action.track_id)?.name;
  const tagNames = action.add_tag_ids.map((id) => tags.find((item) => item.id === id)?.name ?? id).map((name) => `+ ${name}`);
  const level = levels.find((item) => item.id === action.level_id)?.name;
  const review = action.plan_id || action.committee_id || action.round_id ? "route to review" : "";
  return [track ? `track ${track}` : "", ...tagNames, level ? `level ${level}` : "", review].filter(Boolean).join(", ") || "no destination";
}

function landingSentence(action: RoutingRuleDraft["action"], tracks: RoutingOption[], tags: RoutingOption[], levels: RoutingOption[]): string {
  const destination = actionSentence(action, tracks, tags, levels);
  return destination === "no destination" ? "Would land in: no rule destination" : `Would land in: ${destination}`;
}

interface ListResponse {
  data: FormSummary[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

interface Props {
  eventId: string;
  search?: string;
}

const FIELD_TYPES: Array<{ value: FieldType; label: string }> = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "single_select", label: "Single select" },
  { value: "multi_select", label: "Multi select" },
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
  { value: "file", label: "File upload" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
];

const STEP_NAMES = ["Type & basics", "Welcome", "Form fields", "Participants", "Rules & routing", "Messages", "Publish"];
const LIFECYCLE_ROUTES = {
  publish: "/api/v1/events/{eventId}/forms/{formId}/publish",
  close: "/api/v1/events/{eventId}/forms/{formId}/close",
  reopen: "/api/v1/events/{eventId}/forms/{formId}/reopen",
} as const;

function fieldTypeLabel(type: string): string {
  return FIELD_TYPES.find((item) => item.value === type)?.label ?? type;
}

export function conditionSummary(condition: FormCondition | null): string {
  const clauses = condition?.all ?? [];
  if (!clauses.length) return "";
  return clauses.map((clause) => `${clause.fieldKey} ${clause.op.replaceAll("_", " ")} ${String(clause.value ?? "answered")}`).join(" · ");
}

async function request<T>(path: string, route: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    route,
  });
}

function formStatusTone(status: FormStatus): "success" | "warning" | "alarm" | "" {
  if (status === "open") return "success";
  if (status === "closed") return "warning";
  return "";
}

function initialPreviewAnswers(fields: FormField[]): Record<string, FormAnswerValue> {
  const result: Record<string, FormAnswerValue> = {};
  for (const field of fields) {
    const options = Array.isArray(field.config.options) ? field.config.options : [];
    const defaultValue = field.config.default;
    if (defaultValue !== undefined && (typeof defaultValue === "string" || typeof defaultValue === "number" || typeof defaultValue === "boolean")) {
      result[field.key] = defaultValue;
    } else if (field.type === "single_select" && options.length > 0 && (typeof options[0] === "string" || typeof options[0] === "number")) {
      result[field.key] = options[0] as string | number;
    }
  }
  return result;
}

function selectOptions(field: FormField): string[] {
  return Array.isArray(field.config.options) ? field.config.options.filter((option): option is string => typeof option === "string") : [];
}

function isSelectType(type: FieldType): boolean {
  return type === "single_select" || type === "multi_select";
}

/** The conference setting a select field draws its options from, if any. */
function fieldSource(field: { type: FieldType; config: Record<string, unknown> }): BoundSource | null {
  return boundSourceOf(field);
}

function sourceChoicesFor(type: FieldType): Array<{ value: "" | BoundSource; label: string }> {
  return [
    { value: "", label: "Custom list" },
    ...BOUND_SOURCES
      .filter((source) => isBoundSourceCompatible(source, type))
      .map((source) => ({ value: source, label: `Conference ${source}` })),
  ];
}

/**
 * A field key is an identifier the API validates; an organizer types a label.
 * Deriving one from the other is what removes a whole interaction from adding
 * a field, so the derivation has to survive labels that are punctuation,
 * emoji, or a duplicate of one already used.
 */
export function fieldKeyFromLabel(label: string, taken: readonly string[]): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 100);
  const root = base || `field_${Date.now().toString(36)}`;
  if (!taken.includes(root)) return root;
  for (let suffix = 2; suffix < 200; suffix += 1) {
    const candidate = `${root}_${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${root}_${Date.now().toString(36)}`;
}

export function parseOptionList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

/**
 * Where a select's options come from. Bound to a conference setting, the list
 * is not editable here on purpose: the options a submitter is offered are the
 * rows the submit path resolves against, and an editable copy is how the two
 * drift apart during a rename.
 */
function OptionsEditor({ field, onConfig }: { field: FormField; onConfig: (key: string, value: unknown) => void }): JSX.Element {
  const source = fieldSource(field);
  const options = selectOptions(field);
  return <div class="forms-options-box" data-options-source={source ?? "custom"}>
    <div class="field">
      <label for={`field-options-source-${field.id}`}>Options come from</label>
      <select id={`field-options-source-${field.id}`} value={source ?? ""} onChange={(event) => {
        const next = (event.currentTarget as HTMLSelectElement).value;
        // Binding drops the copy; unbinding keeps the resolved list as the
        // starting point for the custom one the organizer just asked for.
        if (next) onConfig("options", undefined);
        onConfig("source", next || undefined);
      }}>
        {sourceChoicesFor(field.type).map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </select>
    </div>
    {source
      ? <div class="forms-bound-note">
          <span>Options come from Conference settings → {BOUND_SOURCE_LABELS[source]}. Editing them there updates this form and every open submission.</span>
          <a href={`/settings#${source}`}>Edit {BOUND_SOURCE_LABELS[source].toLowerCase()} ↗</a>
          <div class="forms-bound-values" aria-label={`Current ${source}`}>{options.length ? options.map((option) => <span class="chip" key={option}>{option}</span>) : <span class="subtle">No {source} configured yet — add the first one in Conference settings.</span>}</div>
        </div>
      : <div class="field"><label for={`field-options-${field.id}`}>Options · comma separated</label><input id={`field-options-${field.id}`} value={options.join(", ")} onInput={(event) => onConfig("options", parseOptionList((event.currentTarget as HTMLInputElement).value))} /></div>}
  </div>;
}

function FieldValidationEditor({ field, onConfig }: { field: FormField; onConfig: (key: string, value: unknown) => void }): JSX.Element {
  const numberInput = (key: string, label: string) => <div class="field"><label>{label}</label><input type="number" value={typeof field.config[key] === "number" ? String(field.config[key]) : ""} onInput={(event) => { const raw = (event.currentTarget as HTMLInputElement).value; onConfig(key, raw === "" ? undefined : Number(raw)); }} /></div>;
  const hasTextRules = field.type === "short_text" || field.type === "long_text" || field.type === "email" || field.type === "url";
  const hasOptions = field.type === "single_select" || field.type === "multi_select";
  const hasFileRules = field.type === "file";
  return <div class="forms-validation-box">
    <div class="forms-validation-heading"><strong>Field validation</strong><span>Applied only when this field is visible.</span></div>
    {hasTextRules && <div class="grid-2">{numberInput("minLength", "Minimum characters")}{numberInput("maxLength", "Maximum characters")}</div>}
    {field.type === "number" && <div class="grid-2">{numberInput("min", "Minimum value")}{numberInput("max", "Maximum value")}</div>}
    {hasOptions && <OptionsEditor field={field} onConfig={onConfig} />}
    {field.type === "multi_select" && <div class="grid-2">{numberInput("minItems", "Minimum choices")}{numberInput("maxItems", "Maximum choices")}</div>}
    {hasFileRules && <><div class="field"><label>Accepted content types · comma separated</label><input value={Array.isArray(field.config.accept) ? field.config.accept.filter((item): item is string => typeof item === "string").join(", ") : ""} onInput={(event) => onConfig("accept", (event.currentTarget as HTMLInputElement).value.split(",").map((item) => item.trim()).filter(Boolean))} /></div>{numberInput("maxBytes", "Maximum bytes")}</>}
    {hasTextRules && <div class="field"><label>Pattern · optional regular expression</label><input value={typeof field.config.pattern === "string" ? field.config.pattern : ""} onInput={(event) => onConfig("pattern", (event.currentTarget as HTMLInputElement).value || undefined)} placeholder="^[A-Z]" /></div>}
  </div>;
}

function CombinedLimitsEditor({
  fields,
  rules,
  newLabel,
  newMaxChars,
  newFieldKeys,
  onNewLabel,
  onNewMaxChars,
  onNewFieldKeys,
  onRuleChange,
  onCreate,
  onSave,
  onDelete,
  busy,
}: {
  fields: FormField[];
  rules: FormLengthRuleView[];
  newLabel: string;
  newMaxChars: number;
  newFieldKeys: string[];
  onNewLabel: (value: string) => void;
  onNewMaxChars: (value: number) => void;
  onNewFieldKeys: (value: string[]) => void;
  onRuleChange: (id: string, patch: Partial<FormLengthRuleView>) => void;
  onCreate: () => void;
  onSave: (rule: FormLengthRuleView) => void;
  onDelete: (rule: FormLengthRuleView) => void;
  busy: string | null;
}): JSX.Element {
  const textFields = fields.filter(isCombinedLengthField);
  const toggle = (keys: string[], key: string): string[] => keys.includes(key) ? keys.filter((entry) => entry !== key) : [...keys, key];
  const fieldPicker = (keys: string[], onChange: (value: string[]) => void) => textFields.length
    ? <div class="forms-length-fields" aria-label="Text fields in combined limit">{textFields.map((field) => <label key={field.id} class="forms-check"><input type="checkbox" checked={keys.includes(field.key)} onChange={() => onChange(toggle(keys, field.key))} /> {field.label}</label>)}</div>
    : <span class="subtle">Add a short or long text field before creating a combined limit.</span>;
  return <div class="forms-combined-limits" data-combined-limits>
    <div class="forms-validation-heading"><strong>Combined limits</strong><span>Cap the printed programme block across several text fields.</span></div>
    {rules.map((rule) => <div class={`forms-length-rule${rule.disabled ? " is-disabled" : ""}`} key={rule.id}>
      <div class="grid-2">
        <div class="field"><label for={`length-rule-label-${rule.id}`}>Rule label</label><input id={`length-rule-label-${rule.id}`} value={rule.label} onInput={(event) => onRuleChange(rule.id, { label: (event.currentTarget as HTMLInputElement).value })} /></div>
        <div class="field"><label for={`length-rule-max-${rule.id}`}>Maximum characters</label><input id={`length-rule-max-${rule.id}`} type="number" min="1" value={rule.max_chars} onInput={(event) => onRuleChange(rule.id, { max_chars: Math.max(1, Number((event.currentTarget as HTMLInputElement).value) || 1) })} /></div>
      </div>
      <div class="field"><span class="forms-field-label">Included text fields</span>{fieldPicker(rule.field_keys, (field_keys) => onRuleChange(rule.id, { field_keys }))}</div>
      {rule.disabled && <div class="forms-length-fix" role="status"><strong>Fix rule</strong> {rule.missing_field_keys.length ? `Choose a replacement for ${rule.missing_field_keys.join(", ")}.` : "Choose at least one text field."}</div>}
      <div class="forms-length-actions"><Button small variant="primary" onClick={() => onSave(rule)} disabled={busy !== null}>{busy === `length-rule-${rule.id}` ? "Saving…" : "Save limit"}</Button><Button small variant="danger" onClick={() => onDelete(rule)} disabled={busy !== null}>Delete</Button></div>
    </div>)}
    {rules.length === 0 && <p class="subtle">Use one cap for the title, abstract, and bio that appear together in the printed programme.</p>}
    <div class="forms-length-new">
      <div class="forms-validation-heading"><strong>Add a combined limit</strong><span>Each rule is evaluated after hidden fields are removed.</span></div>
      <div class="grid-2"><div class="field"><label for="new-length-rule-label">Rule label</label><input id="new-length-rule-label" value={newLabel} onInput={(event) => onNewLabel((event.currentTarget as HTMLInputElement).value)} /></div><div class="field"><label for="new-length-rule-max">Maximum characters</label><input id="new-length-rule-max" type="number" min="1" value={newMaxChars} onInput={(event) => onNewMaxChars(Math.max(1, Number((event.currentTarget as HTMLInputElement).value) || 1))} /></div></div>
      <div class="field"><span class="forms-field-label">Included text fields</span>{fieldPicker(newFieldKeys, onNewFieldKeys)}</div>
      <Button small variant="primary" onClick={onCreate} disabled={busy !== null || newFieldKeys.length === 0}>{busy === "length-rule-new" ? "Adding…" : "Add combined limit"}</Button>
    </div>
  </div>;
}

function PreviewControl({ field, value, onChange }: { field: FormField; value: FormAnswerValue | undefined; onChange: (value: FormAnswerValue) => void }): JSX.Element {
  if (field.type === "long_text") return <textarea class="forms-preview-input" aria-label={field.label} value={typeof value === "string" ? value : ""} onInput={(event) => onChange((event.currentTarget as HTMLTextAreaElement).value)} />;
  if (field.type === "single_select") return <select class="forms-preview-input" aria-label={field.label} value={typeof value === "string" ? value : ""} onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value)}><option value="">Choose an option</option>{selectOptions(field).map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  if (field.type === "multi_select") return <div class="forms-preview-options">{selectOptions(field).map((option) => <label key={option}><input type="checkbox" checked={Array.isArray(value) && value.includes(option)} onChange={(event) => { const current = Array.isArray(value) ? value.filter((item): item is FormAnswerValue => item !== option) : []; onChange((event.currentTarget as HTMLInputElement).checked ? [...current, option] : current); }} /> {option}</label>)}</div>;
  if (field.type === "file") return <input class="forms-preview-input" aria-label={field.label} type="file" />;
  return <input class="forms-preview-input" aria-label={field.label} type={field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "date" ? "date" : "text"} value={typeof value === "string" || typeof value === "number" ? String(value) : ""} onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)} />;
}

function refreshLengthRuleStatus(fields: FormField[], rules: readonly FormLengthRuleView[]): FormLengthRuleView[] {
  const evaluations = evaluateFormLengthRules(rules, fields, {});
  const byId = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));
  return rules.map((rule) => {
    const evaluation = byId.get(rule.id);
    return evaluation ? { ...rule, disabled: evaluation.disabled, missing_field_keys: evaluation.missing_field_keys } : rule;
  });
}

function Preview({ fields, answers, lengthRules, onAnswer }: { fields: FormField[]; answers: Record<string, FormAnswerValue>; lengthRules: FormLengthRuleView[]; onAnswer: (key: string, value: FormAnswerValue) => void }): JSX.Element {
  const ordered = [...fields].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const conditionalTriggers = ordered.filter((field) => ordered.some((candidate) => candidate.condition?.all.some((clause) => clause.fieldKey === field.key)));
  const visible = ordered.filter((field) => isFieldApplicable(field, answers));
  const projected = lengthRules.length > 0 ? projectApplicableAnswers(ordered, answers, lengthRules) : { answers: {}, issues: [] };
  const lengthEvaluations = evaluateFormLengthRules(lengthRules, ordered, projected.answers);
  return <div class="forms-preview-window">
    <div class="forms-preview-top" aria-hidden="true"><i /><i /><i /><span>public / f / preview</span></div>
    <div class="forms-preview-body">
      <span class="eyebrow">Call for speakers</span>
      <h3>Share your work with the conference.</h3>
      <p>Fields update from the same schema that powers the public form.</p>
      {conditionalTriggers.length > 0 && <div class="forms-preview-answer-bar"><span class="eyebrow">Preview answers</span>{conditionalTriggers.map((field) => <label key={field.key}>{field.label}<PreviewControl field={field} value={answers[field.key]} onChange={(value) => onAnswer(field.key, value)} /></label>)}</div>}
      <div class="forms-preview-fields" aria-label="Live form preview">
        {visible.map((field) => <div class="forms-preview-field" key={field.id} data-preview-field={field.key} data-field-label={field.label} data-field-type={field.type} data-field-position={field.position} data-field-required={field.required ? "true" : "false"}>
          <label>{field.label}{field.required ? <span aria-hidden="true"> *</span> : null}</label>
          {field.help_text && <small>{field.help_text}</small>}
          <PreviewControl field={field} value={answers[field.key]} onChange={(value) => onAnswer(field.key, value)} />
        </div>)}
        {visible.length === 0 && <span class="subtle">No fields yet — add one in the editor.</span>}
      </div>
      {lengthEvaluations.length > 0 && <div class="forms-preview-limits" aria-label="Combined character limits">{lengthEvaluations.map((rule) => <div class="forms-preview-limit" data-preview-length-rule={rule.id} key={rule.id}><span>{rule.label}</span><strong>{rule.disabled ? "Fix rule" : `${rule.character_count}/${rule.max_chars}`}</strong></div>)}</div>}
      <div class="forms-preview-footer"><span>Draft saved locally · just now</span><Button small variant="primary">Submit abstract</Button></div>
    </div>
  </div>;
}

export function FormsPage({ eventId, search = "" }: Props): JSX.Element {
  const { event } = useEventContext();
  const timezone = event?.timezone ?? null;
  const [catalog, setCatalog] = useState<FormSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormDetail | null>(null);
  const [step, setStep] = useState(2);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, FormAnswerValue>>({});
  const [newLengthRuleLabel, setNewLengthRuleLabel] = useState("Printed programme block");
  const [newLengthRuleMaxChars, setNewLengthRuleMaxChars] = useState(900);
  const [newLengthRuleFieldKeys, setNewLengthRuleFieldKeys] = useState<string[]>([]);
  const [newFieldType, setNewFieldType] = useState<FieldType>("short_text");
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldOptions, setNewFieldOptions] = useState("");
  const [newFieldSource, setNewFieldSource] = useState<"" | BoundSource>("");
  const [newFieldSaveToLibrary, setNewFieldSaveToLibrary] = useState(false);
  const [libraryRows, setLibraryRows] = useState<LibraryQuestion[]>([]);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [libraryPanelOpen, setLibraryPanelOpen] = useState(false);
  const [libraryEditorId, setLibraryEditorId] = useState<string | null>(null);
  const [libraryKey, setLibraryKey] = useState("");
  const [libraryLabel, setLibraryLabel] = useState("");
  const [libraryHelp, setLibraryHelp] = useState("");
  const [libraryType, setLibraryType] = useState<FieldType>("short_text");
  const [libraryRequired, setLibraryRequired] = useState(false);
  const [libraryOptions, setLibraryOptions] = useState("");
  const [conditionTrigger, setConditionTrigger] = useState("");
  const [conditionValue, setConditionValue] = useState("Yes");
  const [adminPersonId, setAdminPersonId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // null while the instance has not answered yet: the dialog must not fire on a
  // guess, in either direction.
  const [mailConfigured, setMailConfigured] = useState<boolean | null>(null);
  const [mailWarning, setMailWarning] = useState(false);
  const libraryButtonRef = useRef<HTMLButtonElement>(null);
  const requestedFormId = new URLSearchParams(search).get("form");
  const selectedField = form?.fields.find((field) => field.id === selectedFieldId) ?? null;

  const loadCatalog = async () => {
    setState("loading");
    try {
      const result = await request<ListResponse>(`/api/v1/events/${encodeURIComponent(eventId)}/forms?page=1&per_page=100&sort=name`, "/api/v1/events/{eventId}/forms");
      setCatalog(result.data);
      const queryFormId = requestedFormId && result.data.some((item) => item.id === requestedFormId) ? requestedFormId : null;
      setSelectedId((current) => queryFormId ?? (current && result.data.some((item) => item.id === current) ? current : result.data[0]?.id ?? null));
      setState("ready");
      setMessage("");
    } catch (error) {
      setState("error");
      setMessage(errorSummary(error));
    }
  };

  const loadForm = async (id: string) => {
    try {
      const detail = await request<FormDetail>(`/api/v1/events/${encodeURIComponent(eventId)}/forms/${encodeURIComponent(id)}`, "/api/v1/events/{eventId}/forms/{formId}");
      setForm(detail);
      setSelectedFieldId((current) => current && detail.fields.some((field) => field.id === current) ? current : detail.fields[0]?.id ?? null);
      setPreviewAnswers(initialPreviewAnswers(detail.fields));
      setNewLengthRuleFieldKeys(detail.fields.filter(isCombinedLengthField).slice(0, 3).map((field) => field.key));
      setConditionTrigger("");
      setAdminPersonId("");
      setMessage("");
    } catch (error) {
      setMessage(errorSummary(error));
    }
  };

  const loadLibrary = async (destinationFormId: string | null = form?.id ?? null, search = librarySearch) => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (destinationFormId) params.set("form_id", destinationFormId);
      const result = await request<{ data: LibraryQuestion[] }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/field-library?${params.toString()}`,
        "/api/v1/events/{eventId}/field-library",
      );
      setLibraryRows(result.data);
    } catch (error) {
      setMessage(errorSummary(error));
    }
  };

  const closeLibraryPicker = () => {
    setLibraryPickerOpen(false);
    requestAnimationFrame(() => libraryButtonRef.current?.focus());
  };

  useEffect(() => { void loadCatalog(); }, [eventId, requestedFormId]);
  // Read once per mount: whether this instance can send mail decides whether
  // opening intake needs the acknowledgment. A failed read leaves it null, and
  // null never raises the dialog — the panel is honest or it is silent.
  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ data: { rows: { key: string; configured: boolean }[] } }>("/api/v1/instance/status", { route: "/api/v1/instance/status" })
      .then((body) => {
        if (cancelled) return;
        setMailConfigured(body.data.rows.find((row) => row.key === "mail")?.configured ?? null);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (selectedId) {
      void loadForm(selectedId);
      void loadLibrary(selectedId, "");
    } else setForm(null);
  }, [selectedId, eventId]);
  useEffect(() => {
    const condition = selectedField?.condition?.all[0];
    setConditionTrigger(condition?.fieldKey ?? "");
    setConditionValue(String(condition?.value ?? "Yes"));
  }, [selectedFieldId, selectedField?.condition]);

  const mutate = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try { await action(); } catch (error) { setMessage(errorSummary(error)); } finally { setBusy(null); }
  };

  const saveForm = () => {
    if (!form) return;
    void mutate("form", async () => {
      // Legacy explicit-zero rows are read-only unlimited state. An inherit
      // transition must still carry a bounded dormant value for the writer;
      // unrelated saves preserve an explicit legacy zero by omitting capacity.
      const dormantLimit = form.per_submitter_limit >= 1 && form.per_submitter_limit <= 100
        ? form.per_submitter_limit
        : 1;
      const capacity = form.submitter_limit_inherit
        ? { per_submitter_limit: dormantLimit, submitter_limit_inherit: true }
        : form.per_submitter_limit === 0
          ? {}
          : { per_submitter_limit: form.per_submitter_limit, submitter_limit_inherit: false };
      const updated = await request<FormDetail>(`/api/v1/events/${eventId}/forms/${form.id}`, "/api/v1/events/{eventId}/forms/{formId}", { method: "PATCH", body: JSON.stringify({
        name: form.name, slug: form.slug, kind: form.kind, welcome_md: form.welcome_md, ...capacity,
        min_speakers: form.min_speakers, max_speakers: form.max_speakers, max_sponsors: form.max_sponsors,
        closes_at: form.closes_at, reminder_offset_hours: form.reminder_offset_hours, thankyou_template_key: form.thankyou_template_key,
      }) });
      setForm(updated); await loadCatalog();
    });
  };

  const addForm = () => {
    const suffix = Date.now().toString(36);
    void mutate("new", async () => {
      const created = await request<FormDetail>(`/api/v1/events/${eventId}/forms`, "/api/v1/events/{eventId}/forms", { method: "POST", body: JSON.stringify({ name: `New conference form ${catalog.length + 1}`, slug: `conference-form-${suffix}`, kind: "abstract" }) });
      setSelectedId(created.id); setForm(created); await loadCatalog();
    });
  };

  const duplicateForm = () => {
    if (!form) return;
      void mutate("duplicate", async () => { const copy = await request<FormDetail>(`/api/v1/events/${eventId}/forms/${form.id}/duplicate`, "/api/v1/events/{eventId}/forms/{formId}/duplicate", { method: "POST" }); setSelectedId(copy.id); setForm(copy); await loadCatalog(); });
  };

  const runLifecycle = (next: "publish" | "close" | "reopen", acknowledgeMailUnconfigured = false) => {
    if (!form) return;
    void mutate(next, async () => {
      const updated = await request<FormDetail>(
        `/api/v1/events/${eventId}/forms/${form.id}/${next}`,
        LIFECYCLE_ROUTES[next],
        next === "publish" && acknowledgeMailUnconfigured
          ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acknowledge_mail_unconfigured: true }) }
          : { method: "POST" },
      );
      setForm(updated);
      await loadCatalog();
    });
  };

  /**
   * Opening intake on a mail-less instance is warned about once, never blocked
   * (ruling D8, AC-285). The operator may be handling mail elsewhere; what they
   * must not do is find out from an angry speaker. Acknowledging records the
   * decision server-side with its actor and time.
   */
  const setLifecycle = (next: "publish" | "close" | "reopen") => {
    if (!form) return;
    if (next !== "publish" || mailConfigured !== false) {
      runLifecycle(next);
      return;
    }
    setMailWarning(true);
  };

  const editLibraryQuestion = (question: LibraryQuestion) => {
    setLibraryEditorId(question.id);
    setLibraryKey(question.key);
    setLibraryLabel(question.label);
    setLibraryHelp(question.help_text ?? "");
    setLibraryType(question.type);
    setLibraryRequired(question.required);
    setLibraryOptions(Array.isArray(question.config.options) ? question.config.options.filter((item): item is string => typeof item === "string").join(", ") : "");
  };

  const resetLibraryEditor = () => {
    setLibraryEditorId(null);
    setLibraryKey("");
    setLibraryLabel("");
    setLibraryHelp("");
    setLibraryType("short_text");
    setLibraryRequired(false);
    setLibraryOptions("");
  };

  const saveLibraryQuestion = () => {
    const label = libraryLabel.trim();
    const key = libraryKey.trim() || fieldKeyFromLabel(label, libraryRows.map((question) => question.key));
    if (!label || !key) return;
    const config = isSelectType(libraryType) ? { options: parseOptionList(libraryOptions) } : {};
    void mutate("library", async () => {
      const path = libraryEditorId
        ? `/api/v1/events/${eventId}/field-library/${libraryEditorId}`
        : `/api/v1/events/${eventId}/field-library`;
      const route = libraryEditorId ? "/api/v1/events/{eventId}/field-library/{libraryFieldId}" : "/api/v1/events/{eventId}/field-library";
      await request<LibraryQuestion>(path, route, {
        method: libraryEditorId ? "PATCH" : "POST",
        body: JSON.stringify({ key, label, help_text: libraryHelp.trim() || null, type: libraryType, required: libraryRequired, config, condition: null }),
      });
      resetLibraryEditor();
      await loadLibrary(form?.id ?? null, librarySearch);
    });
  };

  const deleteLibraryQuestion = (question: LibraryQuestion) => {
    if (question.used_on_forms > 0) return;
    void mutate("library", async () => {
      await request<{ deleted: boolean }>(`/api/v1/events/${eventId}/field-library/${question.id}`, "/api/v1/events/{eventId}/field-library/{libraryFieldId}", { method: "DELETE" });
      await loadLibrary(form?.id ?? null, librarySearch);
      if (libraryEditorId === question.id) resetLibraryEditor();
    });
  };

  const copyLibraryQuestion = (question: LibraryQuestion) => {
    if (!form || question.on_destination_form) return;
    void mutate("library-copy", async () => {
      const result = await request<LibraryCopyResult>(
        `/api/v1/events/${eventId}/forms/${form.id}/fields/from-library`,
        "/api/v1/events/{eventId}/forms/{formId}/fields/from-library",
        { method: "POST", body: JSON.stringify({ library_field_id: question.id, position: form.fields.length }) },
      );
      setForm((current) => current ? { ...current, fields: [...current.fields, result] } : current);
      await loadLibrary(form.id, librarySearch);
      closeLibraryPicker();
      setMessage(result.warning?.message ?? `Added ${result.label} as a self-contained copy.`);
    });
  };

  /**
   * One request creates a field the organizer can actually use. The builder
   * used to post a placeholder and then require the row to be selected and
   * every property edited in a second panel — nine interactions per field for
   * a human, and the same nine turns for an agent, against a subtree that
   * re-rendered underneath them between each one.
   */
  const addField = (overrides: { label?: string; type?: FieldType } = {}) => {
    if (!form) return;
    const type = overrides.type ?? newFieldType;
    const label = (overrides.label ?? newFieldLabel).trim() || "New question";
    const key = fieldKeyFromLabel(label, form.fields.map((field) => field.key));
    const bound = isSelectType(type) && newFieldSource ? newFieldSource : null;
    const options = isSelectType(type) && !bound ? parseOptionList(newFieldOptions) : [];
    const config: Record<string, unknown> = bound ? { source: bound } : options.length ? { options } : {};
    void mutate("field", async () => {
      const created = await request<FormField>(`/api/v1/events/${eventId}/forms/${form.id}/fields`, "/api/v1/events/{eventId}/forms/{formId}/fields", { method: "POST", body: JSON.stringify({ key, label, type, required: newFieldRequired, config, save_to_library: newFieldSaveToLibrary }) });
      setForm((current) => {
        if (!current) return current;
        const fields = [...current.fields, created];
        return { ...current, fields, length_rules: refreshLengthRuleStatus(fields, current.length_rules ?? []) };
      });
      // The add row keeps focus and its own identity; stealing the detail
      // editor here is what invalidated the element a caller had just
      // addressed, costing a re-query per field.
      setNewFieldLabel("");
      setNewFieldOptions("");
      setNewFieldSource("");
      setNewFieldRequired(false);
      setNewFieldSaveToLibrary(false);
      if (newFieldSaveToLibrary) await loadLibrary(form.id, librarySearch);
    });
  };

  const saveField = () => {
    if (!form || !selectedField) return;
    void mutate("field", async () => {
      const condition = conditionTrigger ? { all: [{ fieldKey: conditionTrigger, op: "equals", value: conditionValue }] } : null;
      const updated = await request<FormField>(`/api/v1/events/${eventId}/forms/${form.id}/fields/${selectedField.id}`, "/api/v1/events/{eventId}/forms/{formId}/fields/{fieldId}", { method: "PATCH", body: JSON.stringify({ key: selectedField.key, label: selectedField.label, help_text: selectedField.help_text, type: selectedField.type, required: selectedField.required, config: selectedField.config, condition }) });
      setForm((current) => {
        if (!current) return current;
        const fields = current.fields.map((field) => field.id === updated.id ? updated : field);
        return { ...current, fields, length_rules: refreshLengthRuleStatus(fields, current.length_rules ?? []) };
      });
    });
  };

  const deleteField = () => {
    if (!form || !selectedField) return;
    void mutate("field", async () => { await request<{ deleted: boolean }>(`/api/v1/events/${eventId}/forms/${form.id}/fields/${selectedField.id}`, "/api/v1/events/{eventId}/forms/{formId}/fields/{fieldId}", { method: "DELETE" }); setForm((current) => { if (!current) return current; const fields = current.fields.filter((field) => field.id !== selectedField.id); return { ...current, fields, length_rules: refreshLengthRuleStatus(fields, current.length_rules ?? []) }; }); setSelectedFieldId(form.fields.find((field) => field.id !== selectedField.id)?.id ?? null); });
  };

  const moveField = (direction: -1 | 1) => {
    if (!form || !selectedField) return;
    const fields = [...form.fields].sort((left, right) => left.position - right.position);
    const from = fields.findIndex((field) => field.id === selectedField.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= fields.length) return;
    [fields[from], fields[to]] = [fields[to], fields[from]];
    void mutate("field", async () => { const result = await request<{ data: FormField[] }>(`/api/v1/events/${eventId}/forms/${form.id}/fields/reorder`, "/api/v1/events/{eventId}/forms/{formId}/fields/reorder", { method: "PATCH", body: JSON.stringify({ field_ids: fields.map((field) => field.id) }) }); setForm((current) => current ? { ...current, fields: result.data } : current); });
  };

  const setLengthRuleValue = (id: string, patch: Partial<FormLengthRuleView>) => {
    setForm((current) => {
      if (!current) return current;
      const rules = (current.length_rules ?? []).map((rule) => rule.id === id ? { ...rule, ...patch } : rule);
      return { ...current, length_rules: refreshLengthRuleStatus(current.fields, rules) };
    });
  };

  const createLengthRule = () => {
    if (!form || newLengthRuleFieldKeys.length === 0) return;
    void mutate("length-rule-new", async () => {
      const created = await request<FormLengthRuleView>(`/api/v1/events/${eventId}/forms/${form.id}/length-rules`, "/api/v1/events/{eventId}/forms/{formId}/length-rules", {
        method: "POST",
        body: JSON.stringify({ label: newLengthRuleLabel.trim() || "Printed programme block", field_keys: newLengthRuleFieldKeys, max_chars: newLengthRuleMaxChars, sort_order: (form.length_rules ?? []).length }),
      });
      setForm((current) => current ? { ...current, length_rules: [...(current.length_rules ?? []), created] } : current);
      setNewLengthRuleLabel("Printed programme block");
      setNewLengthRuleMaxChars(900);
    });
  };

  const saveLengthRule = (rule: FormLengthRuleView) => {
    if (!form) return;
    void mutate(`length-rule-${rule.id}`, async () => {
      const updated = await request<FormLengthRuleView>(`/api/v1/events/${eventId}/forms/${form.id}/length-rules/${rule.id}`, "/api/v1/events/{eventId}/forms/{formId}/length-rules/{ruleId}", {
        method: "PATCH",
        body: JSON.stringify({ label: rule.label, field_keys: rule.field_keys, max_chars: rule.max_chars, sort_order: rule.sort_order }),
      });
      setForm((current) => current ? { ...current, length_rules: (current.length_rules ?? []).map((entry) => entry.id === updated.id ? updated : entry) } : current);
    });
  };

  const deleteLengthRule = (rule: FormLengthRuleView) => {
    if (!form) return;
    void mutate(`length-rule-${rule.id}`, async () => {
      await request<{ deleted: boolean }>(`/api/v1/events/${eventId}/forms/${form.id}/length-rules/${rule.id}`, "/api/v1/events/{eventId}/forms/{formId}/length-rules/{ruleId}", { method: "DELETE" });
      setForm((current) => current ? { ...current, length_rules: (current.length_rules ?? []).filter((entry) => entry.id !== rule.id) } : current);
    });
  };

  const setFieldValue = (key: keyof FormField, value: unknown) => { setForm((current) => { if (!current || !selectedField) return current; const fields = current.fields.map((field) => field.id === selectedField.id ? { ...field, [key]: value } : field); return { ...current, fields, length_rules: refreshLengthRuleStatus(fields, current.length_rules ?? []) }; }); };
  const setFieldConfig = (key: string, value: unknown) => { setForm((current) => current && selectedField ? { ...current, fields: current.fields.map((field) => { if (field.id !== selectedField.id) return field; const config = { ...field.config }; if (value === undefined || value === "") delete config[key]; else config[key] = value; return { ...field, config }; }) } : current); };
  const addAdmin = () => {
    if (!form || !adminPersonId.trim()) return;
    void mutate("admin", async () => { const admin = await request<FormAdmin>(`/api/v1/events/${eventId}/forms/${form.id}/admins`, "/api/v1/events/{eventId}/forms/{formId}/admins", { method: "POST", body: JSON.stringify({ person_id: adminPersonId.trim() }) }); setForm((current) => current ? { ...current, admins: [...current.admins, admin] } : current); setAdminPersonId(""); });
  };
  const removeAdmin = (personId: string) => {
    if (!form) return;
    void mutate("admin", async () => { await request<{ deleted: boolean }>(`/api/v1/events/${eventId}/forms/${form.id}/admins/${personId}`, "/api/v1/events/{eventId}/forms/{formId}/admins/{personId}", { method: "DELETE" }); setForm((current) => current ? { ...current, admins: current.admins.filter((admin) => admin.person_id !== personId) } : current); });
  };
  const projection = useMemo(() => form ? fieldPreviewProjection(form.fields) : [], [form?.fields]);

  if (state === "loading") return <div class="forms-page"><PageHeader title="CFP forms" copy="Reading the conference form catalog and its builder contract." /><div class="forms-loading" aria-busy="true"><span>Loading conference forms</span><strong>—</strong><span>Reading D1</span></div></div>;
  if (state === "error") return <div class="forms-page"><PageHeader title="CFP forms" copy="The form catalog is event-scoped and authoring access is protected." actions={<Button onClick={() => void loadCatalog()}>Retry</Button>} /><div class="forms-error" role="alert"><strong>Forms could not be loaded</strong><span>{message}</span></div></div>;
  if (!form) return <div class="forms-page"><PageHeader title="CFP forms" copy="Build the conference intake once; the public form follows its schema." actions={<><AgentBriefLauncher surface="cfp" eventId={eventId} /><Button variant="primary" onClick={addForm} disabled={busy !== null}>+ New form</Button></>} />{catalog.length === 0 ? <EmptyState title="Your conference has no forms yet" copy="Create the first Abstract or Session form to start collecting the program." action={<Button onClick={addForm}>+ New form</Button>} /> : <section class="forms-catalog">{catalog.map((item) => <button key={item.id} class="forms-catalog-card" onClick={() => setSelectedId(item.id)}><Chip tone={formStatusTone(item.status)}>{item.status}</Chip><strong>{item.name}</strong><span>{item.kind === "abstract" ? "Abstracts" : "Sessions"} · {item.visibility}</span><small>{item.response_count.toLocaleString()} responses</small></button>)}<button type="button" class="forms-catalog-card forms-library-tile" onClick={() => { setLibraryPanelOpen(true); void loadLibrary(null, ""); }}><span class="eyebrow">Library</span><strong>Question library</strong><span>Reusable questions for this conference.</span><small>Open library management →</small></button></section>}</div>;

  return <div class="forms-page">
    <PageHeader title="CFP forms" copy={`${catalog.length} conference form${catalog.length === 1 ? "" : "s"} · each audience, field list, rules, and response state stays isolated.`} actions={<><AgentBriefLauncher surface="cfp" eventId={eventId} /><Button onClick={duplicateForm} disabled={busy !== null}>Duplicate</Button><Button onClick={addForm} disabled={busy !== null}>+ New form</Button>{form.status === "open" ? <Button variant="primary" onClick={() => setLifecycle("close")} disabled={busy !== null}>Close form</Button> : <Button variant="primary" onClick={() => setLifecycle(form.status === "closed" ? "reopen" : "publish")} disabled={busy !== null}>{form.status === "closed" ? "Reopen form" : "Publish changes"}</Button>}</>} />
    <section class="forms-catalog" aria-label="Conference forms">{catalog.map((item) => <button key={item.id} class={`forms-catalog-card ${item.id === form.id ? "active" : ""}`} onClick={() => setSelectedId(item.id)}><Chip tone={formStatusTone(item.status)}>{item.status}</Chip><strong>{item.name}</strong><span>{item.kind === "abstract" ? "Abstracts" : "Sessions"} · {item.visibility}</span><small>{item.response_count.toLocaleString()} responses · {item.public_url ?? "private until published"}</small></button>)}<button type="button" class="forms-catalog-card forms-library-tile" onClick={() => { setLibraryPanelOpen(true); void loadLibrary(form.id, ""); }}><span class="eyebrow">Library</span><strong>Question library</strong><span>Reusable questions for this conference.</span><small>Open library management →</small></button></section>
    {message && <div class="forms-error" role="status"><strong>Form update needs attention</strong><span>{message}</span></div>}
    {mailWarning && <div class="forms-mail-warning" role="alertdialog" aria-modal="true" aria-labelledby="mail-warning-title">
      <div class="forms-mail-warning-card">
        <span class="eyebrow">Open intake</span>
        <h2 id="mail-warning-title">This instance can’t send mail yet</h2>
        <p>The call for speakers will be live to the world, but until mail is configured:</p>
        <ul>
          <li>submitters get no confirmation email;</li>
          <li>accepted speakers get no decision mail;</li>
          <li>no calendar invites are delivered.</li>
        </ul>
        <p class="subtle">Everything queues honestly in the outbox — nothing pretends to send.</p>
        <div class="forms-mail-warning-actions">
          <Button onClick={() => setMailWarning(false)}>Configure mail first</Button>
          <Button variant="primary" onClick={() => { setMailWarning(false); runLifecycle("publish", true); }}>Open intake anyway</Button>
        </div>
      </div>
    </div>}
    {libraryPanelOpen && <section class="card forms-library-panel" aria-label="Question library">
      <div class="forms-library-heading"><div><span class="eyebrow">Event-scoped definitions</span><h2>Question library</h2><p>Save a question once, then place self-contained copies into draft forms. Editing this library never changes an existing form.</p></div><Button small onClick={() => setLibraryPanelOpen(false)}>Close library</Button></div>
      <form class="forms-library-search" onSubmit={(event) => { event.preventDefault(); void loadLibrary(form?.id ?? null, librarySearch); }}><label for="library-search">Search questions</label><input id="library-search" value={librarySearch} placeholder="Search by name or key" onInput={(event) => setLibrarySearch((event.currentTarget as HTMLInputElement).value)} /><Button type="submit">Search</Button></form>
      <div class="forms-library-layout">
        <div class="forms-library-list" aria-label="Reusable questions">{libraryRows.length ? libraryRows.map((question) => <article class="forms-library-row" key={question.id}><button type="button" onClick={() => editLibraryQuestion(question)}><strong>{question.label}</strong><span>{fieldTypeLabel(question.type)} · Used on {question.used_on_forms} form{question.used_on_forms === 1 ? "" : "s"} · v{question.version}</span>{question.condition_note && <small>When {question.condition_note}</small>}{question.stale_copy_count > 0 && <small>{question.stale_copy_count} form{question.stale_copy_count === 1 ? " uses" : "s use"} an older version</small>}</button><Button small variant="danger" onClick={() => deleteLibraryQuestion(question)} disabled={question.used_on_forms > 0 || busy !== null}>Delete</Button></article>) : <div class="forms-library-empty">No reusable questions yet. Save an ordinary question from the builder or create one here.</div>}</div>
        <div class="forms-library-editor"><span class="eyebrow">{libraryEditorId ? "Edit question" : "New library question"}</span><div class="field"><label for="library-key">Stable key</label><input id="library-key" value={libraryKey} disabled={libraryEditorId !== null} placeholder="audience_focus" onInput={(event) => setLibraryKey((event.currentTarget as HTMLInputElement).value)} /></div><div class="field"><label for="library-label">Question label</label><input id="library-label" value={libraryLabel} placeholder="What should attendees learn?" onInput={(event) => setLibraryLabel((event.currentTarget as HTMLInputElement).value)} /></div><div class="field"><label for="library-type">Type</label><select id="library-type" value={libraryType} onChange={(event) => setLibraryType((event.currentTarget as HTMLSelectElement).value as FieldType)}>{FIELD_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>{isSelectType(libraryType) && <div class="field"><label for="library-options">Options · comma separated</label><input id="library-options" value={libraryOptions} onInput={(event) => setLibraryOptions((event.currentTarget as HTMLInputElement).value)} /></div>}<div class="field"><label for="library-help">Help text</label><textarea id="library-help" value={libraryHelp} onInput={(event) => setLibraryHelp((event.currentTarget as HTMLTextAreaElement).value)} /></div><label class="forms-check"><input type="checkbox" checked={libraryRequired} onChange={(event) => setLibraryRequired((event.currentTarget as HTMLInputElement).checked)} /> Required</label><div class="forms-library-editor-actions"><Button variant="primary" onClick={saveLibraryQuestion} disabled={busy !== null || !libraryLabel.trim()}>{busy === "library" ? "Saving…" : libraryEditorId ? "Save library edit" : "Add to library"}</Button>{libraryEditorId && <Button onClick={resetLibraryEditor}>New question</Button>}</div><p class="subtle">Participant machinery such as speaker email, co-speakers, and moderator fields is structural and never appears here because a second participant placement cannot survive the submit path.</p></div>
      </div>
    </section>}
    <div class="forms-builder">
      <aside class="card forms-steps" aria-label="Form builder steps">
        <CardHeader title="Build steps" />
        <CardBody><div class="forms-step-list">{STEP_NAMES.map((name, index) => <button key={name} class={step === index ? "active" : ""} onClick={() => setStep(index)}><span>{index + 1}</span>{name}</button>)}</div><div class="divider" /><div class="field"><label>Collects</label><div class="segment forms-target"><button class={form.kind === "abstract" ? "active" : ""} disabled={form.status !== "draft"} onClick={() => setForm({ ...form, kind: "abstract" })}>Abstracts</button><button class={form.kind === "session" ? "active" : ""} disabled={form.status !== "draft"} onClick={() => setForm({ ...form, kind: "session" })}>Sessions</button></div><span class="field-note">{form.status === "draft" ? form.kind === "abstract" ? "Enters the evaluation pipeline." : "Bypasses evaluation; ready for agenda." : "Target locked after the conference form opened."}</span></div><div class="divider" /><div class="field"><label>Close date {eventTimeLabel(timezone)}</label><input type="datetime-local" value={timezone ? instantToLocalDateTime(form.closes_at, timezone) : ""} disabled={!timezone} onInput={(inputEvent) => { if (!timezone) return; setForm({ ...form, closes_at: localDateTimeToInstant((inputEvent.currentTarget as HTMLInputElement).value, timezone) }); }} /></div><SubmissionCapacityEditor inherit={form.submitter_limit_inherit} rawLimit={form.per_submitter_limit} effectiveLimit={form.effective_submitter_limit} onChange={(patch) => setForm({ ...form, ...patch })} /><Button variant="primary" onClick={saveForm} disabled={busy !== null}>{busy === "form" ? "Saving…" : "Save form"}</Button></CardBody>
      </aside>
      <section class="card forms-editor" aria-label="Form editor">
        <CardHeader title={STEP_NAMES[step] ?? "Form fields"}><Chip tone={formStatusTone(form.status)}>{form.status}</Chip></CardHeader>
        <CardBody>{step === 2 ? <>
          <div class="forms-editor-intro"><div><strong>Fields in public order</strong><span>Drag is optional; the arrows are keyboard-safe and persist the same order.</span></div><div class="forms-add-modes"><Button type="button" variant="primary" onClick={() => document.getElementById("new-field-label")?.focus()}>＋ New question</Button><Button type="button" ref={libraryButtonRef} onClick={() => { setLibrarySearch(""); setLibraryPickerOpen(true); void loadLibrary(form.id, ""); }}>From library · {libraryRows.length}</Button></div></div>
          <form class="forms-add-row" data-field-add="row" aria-label="Add a field" onSubmit={(event) => { event.preventDefault(); addField(); }}>
            <div class="field"><label for="new-field-label">New field label</label><input id="new-field-label" name="new-field-label" data-field-add="label" value={newFieldLabel} placeholder="Key takeaway" onInput={(event) => setNewFieldLabel((event.currentTarget as HTMLInputElement).value)} /></div>
            <div class="field"><label for="new-field-type">Type</label><select id="new-field-type" name="new-field-type" data-field-add="type" value={newFieldType} onChange={(event) => { const type = (event.currentTarget as HTMLSelectElement).value as FieldType; setNewFieldType(type); if (newFieldSource && !isBoundSourceCompatible(newFieldSource, type)) setNewFieldSource(""); }}>{FIELD_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
            <div class="field"><label for="new-field-source">Options come from</label><select id="new-field-source" name="new-field-source" data-field-add="source" value={newFieldSource} disabled={!isSelectType(newFieldType)} onChange={(event) => setNewFieldSource((event.currentTarget as HTMLSelectElement).value as "" | BoundSource)}>{sourceChoicesFor(newFieldType).map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></div>
            <div class="field"><label for="new-field-options">Options · comma separated</label><input id="new-field-options" name="new-field-options" data-field-add="options" value={newFieldSource && isSelectType(newFieldType) ? "" : newFieldOptions} disabled={!isSelectType(newFieldType) || Boolean(newFieldSource)} placeholder={!isSelectType(newFieldType) ? "Select fields only" : newFieldSource ? `From Conference settings → ${BOUND_SOURCE_LABELS[newFieldSource]}` : "Beginner, Intermediate, Advanced"} onInput={(event) => setNewFieldOptions((event.currentTarget as HTMLInputElement).value)} /></div>
            <label class="forms-check forms-add-required" for="new-field-required"><input id="new-field-required" name="new-field-required" data-field-add="required" type="checkbox" checked={newFieldRequired} onChange={(event) => setNewFieldRequired((event.currentTarget as HTMLInputElement).checked)} /> Required</label>
            <label class="forms-check forms-add-save" for="new-field-save-library"><input id="new-field-save-library" name="new-field-save-library" type="checkbox" checked={newFieldSaveToLibrary} onChange={(event) => setNewFieldSaveToLibrary((event.currentTarget as HTMLInputElement).checked)} /> Save to library</label>
            <Button id="new-field-submit" data-field-add="submit" type="submit" variant="primary" disabled={busy !== null}>{busy === "field" ? "Adding…" : "Add field"}</Button>
          </form>
          {libraryPickerOpen && <div class="forms-library-picker" role="dialog" aria-modal="true" aria-label="From library"><div class="forms-library-picker-heading"><div><span class="eyebrow">From library</span><h3>Reuse a question</h3></div><Button small onClick={closeLibraryPicker}>Close</Button></div><form class="forms-library-search" onSubmit={(event) => { event.preventDefault(); void loadLibrary(form.id, librarySearch); }}><label for="library-picker-search">Search questions</label><input id="library-picker-search" autoFocus value={librarySearch} placeholder="Search by name or key" onInput={(event) => setLibrarySearch((event.currentTarget as HTMLInputElement).value)} /><Button type="submit">Search</Button></form><div class="forms-library-picker-list">{libraryRows.length ? libraryRows.map((question) => <button type="button" class="forms-library-picker-row" key={question.id} disabled={question.on_destination_form || busy !== null} onClick={() => copyLibraryQuestion(question)}><span><strong>{question.label}</strong><small>{fieldTypeLabel(question.type)} · Used on {question.used_on_forms} form{question.used_on_forms === 1 ? "" : "s"}{question.condition_note ? ` · When ${question.condition_note}` : ""}</small></span><em>{question.on_destination_form ? "On this form" : "Add copy"}</em></button>) : <div class="forms-library-empty">No questions match that search.</div>}</div><p class="forms-library-footer">Participant machinery such as speaker email, co-speakers, and moderator fields is structural and never appears here because a second participant placement cannot survive the submit path.</p></div>}
          <div class="forms-field-list">{form.fields.length ? [...form.fields].sort((left, right) => left.position - right.position).map((field, index) => { const summary = field.condition ? conditionSummary(field.condition) : ""; return <button key={field.id} class={`forms-field-row ${field.id === selectedFieldId ? "active" : ""}`} data-builder-field={field.key} onClick={() => setSelectedFieldId(field.id)}><span class="forms-drag-handle" aria-hidden="true">⋮⋮</span><span class="forms-field-order">{String(index + 1).padStart(2, "0")}</span><span class="forms-field-copy"><strong data-field-label={field.label}>{field.label}{field.required ? " *" : ""}</strong><small data-condition-summary={summary}>{fieldTypeLabel(field.type)} · {field.required ? "Required" : "Optional"}{summary ? ` · When ${summary}` : ""}</small></span><span class="forms-field-actions"><span class="chip">{field.type}</span><span class="forms-arrow" aria-hidden="true">→</span></span></button>; }) : <div class="forms-field-empty"><strong>No fields yet</strong><span>Add the first question to give the public form a place to start.</span><Button small variant="primary" onClick={() => addField()}>＋ Add first field</Button></div>}</div>
          {selectedField && <div class="forms-field-editor"><div class="forms-editor-heading"><div><span class="eyebrow">Editing field</span><h3>{selectedField.label}</h3></div><div class="forms-reorder-actions"><Button small onClick={() => moveField(-1)}>↑</Button><Button small onClick={() => moveField(1)}>↓</Button><Button small variant="danger" onClick={deleteField}>Delete</Button></div></div><div class="grid-2"><div class="field"><label>Field key</label><input value={selectedField.key} onInput={(event) => setFieldValue("key", (event.currentTarget as HTMLInputElement).value)} /></div><div class="field"><label>Field type</label><select value={selectedField.type} onChange={(event) => setFieldValue("type", (event.currentTarget as HTMLSelectElement).value)}>{FIELD_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div></div><div class="field"><label>Label</label><input value={selectedField.label} onInput={(event) => setFieldValue("label", (event.currentTarget as HTMLInputElement).value)} /></div><div class="field"><label>Help text</label><textarea value={selectedField.help_text ?? ""} onInput={(event) => setFieldValue("help_text", (event.currentTarget as HTMLInputElement).value)} /></div><label class="forms-check"><input type="checkbox" checked={selectedField.required} onChange={(event) => setFieldValue("required", (event.currentTarget as HTMLInputElement).checked)} /> Required when this field applies</label><FieldValidationEditor field={selectedField} onConfig={setFieldConfig} /><CombinedLimitsEditor fields={form.fields} rules={form.length_rules ?? []} newLabel={newLengthRuleLabel} newMaxChars={newLengthRuleMaxChars} newFieldKeys={newLengthRuleFieldKeys} onNewLabel={setNewLengthRuleLabel} onNewMaxChars={setNewLengthRuleMaxChars} onNewFieldKeys={setNewLengthRuleFieldKeys} onRuleChange={setLengthRuleValue} onCreate={createLengthRule} onSave={saveLengthRule} onDelete={deleteLengthRule} busy={busy} /><div class="forms-condition-box"><div><strong>Conditional visibility</strong><span>Persisted as <code>{"{ all: [{ fieldKey, op, value }] }"}</code>; hidden values are never written.</span></div><div class="grid-2"><div class="field"><label>Show when this field</label><select value={conditionTrigger} onChange={(event) => setConditionTrigger((event.currentTarget as HTMLSelectElement).value)}><option value="">Always show</option>{form.fields.filter((field) => field.id !== selectedField.id).map((field) => <option key={field.id} value={field.key}>{field.label}</option>)}</select></div><div class="field"><label>Equals</label><input value={conditionValue} onInput={(event) => setConditionValue((event.currentTarget as HTMLInputElement).value)} disabled={!conditionTrigger} /></div></div></div><Button variant="primary" onClick={saveField} disabled={busy !== null}>{busy === "field" ? "Saving…" : "Save field"}</Button></div>}
          {!selectedField && <CombinedLimitsEditor fields={form.fields} rules={form.length_rules ?? []} newLabel={newLengthRuleLabel} newMaxChars={newLengthRuleMaxChars} newFieldKeys={newLengthRuleFieldKeys} onNewLabel={setNewLengthRuleLabel} onNewMaxChars={setNewLengthRuleMaxChars} onNewFieldKeys={setNewLengthRuleFieldKeys} onRuleChange={setLengthRuleValue} onCreate={createLengthRule} onSave={saveLengthRule} onDelete={deleteLengthRule} busy={busy} />}
        </> : <StepPanel step={step} form={form} setForm={setForm} saveForm={saveForm} setLifecycle={setLifecycle} busy={busy} adminPersonId={adminPersonId} setAdminPersonId={setAdminPersonId} addAdmin={addAdmin} removeAdmin={removeAdmin} previewAnswers={previewAnswers} />}</CardBody>
      </section>
      <section class="card forms-preview-card" aria-label="Live preview"><CardHeader title="Live preview"><Chip>Same field schema</Chip></CardHeader><div class="forms-preview-reservation"><span>Reserved preview column</span><small>Fields change inside this frame; the editor stays put.</small></div><Preview fields={form.fields} lengthRules={form.length_rules ?? []} answers={previewAnswers} onAnswer={(key, value) => setPreviewAnswers((current) => ({ ...current, [key]: value }))} /><div class="forms-projection" aria-label="Preview projection"><span class="eyebrow">Deep-equal projection</span><code>{JSON.stringify(projection.map((field) => ({ label: field.label, type: field.type, position: field.position, required: field.required })))}</code></div></section>
    </div>
  </div>;
}

function StepPanel({ step, form, setForm, saveForm, setLifecycle, busy, adminPersonId, setAdminPersonId, addAdmin, removeAdmin, previewAnswers }: { step: number; form: FormDetail; setForm: (form: FormDetail) => void; saveForm: () => void; setLifecycle: (next: "publish" | "close" | "reopen") => void; busy: string | null; adminPersonId: string; setAdminPersonId: (value: string) => void; addAdmin: () => void; removeAdmin: (personId: string) => void; previewAnswers: Record<string, FormAnswerValue> }): JSX.Element {
  if (step === 0) return <div class="forms-step-panel"><p class="subtle">Choose the intake target and make the public identity legible before opening the conference form.</p><div class="field"><label>Form name</label><input value={form.name} onInput={(event) => setForm({ ...form, name: (event.currentTarget as HTMLInputElement).value })} /></div><div class="field"><label>Public slug</label><input value={form.slug} onInput={(event) => setForm({ ...form, slug: (event.currentTarget as HTMLInputElement).value })} /></div><div class="forms-lock-note">{form.status === "draft" ? "This target can still be changed while the form is unpublished." : "Target locked after opening. Reopening preserves this URL and its responses."}</div><Button variant="primary" onClick={saveForm} disabled={busy !== null}>Save Type & basics</Button></div>;
  if (step === 1) return <div class="forms-step-panel"><p class="subtle">Welcome copy appears above the first field on the public form.</p><div class="field"><label>Welcome copy</label><textarea rows={7} value={form.welcome_md} onInput={(event) => setForm({ ...form, welcome_md: (event.currentTarget as HTMLTextAreaElement).value })} /></div><Button variant="primary" onClick={saveForm} disabled={busy !== null}>Save welcome</Button></div>;
  if (step === 3) return <div class="forms-step-panel"><p class="subtle">Speaker and sponsor limits are stated before the first add-person control.</p><div class="grid-2"><div class="field"><label>Minimum speakers</label><input type="number" min="0" value={form.min_speakers} onInput={(event) => setForm({ ...form, min_speakers: Number((event.currentTarget as HTMLInputElement).value) || 0 })} /></div><div class="field"><label>Maximum speakers</label><input type="number" min="0" value={form.max_speakers} onInput={(event) => setForm({ ...form, max_speakers: Number((event.currentTarget as HTMLInputElement).value) || 0 })} /></div></div><div class="field"><label>Maximum sponsors</label><input type="number" min="0" value={form.max_sponsors} onInput={(event) => setForm({ ...form, max_sponsors: Number((event.currentTarget as HTMLInputElement).value) || 0 })} /></div><div class="forms-limit-note">{form.min_speakers}–{form.max_speakers} speakers · up to {form.max_sponsors} sponsor{form.max_sponsors === 1 ? "" : "s"}</div><Button variant="primary" onClick={saveForm} disabled={busy !== null}>Save participants</Button></div>;
  if (step === 4) return <RoutingRulesPanel eventId={form.event_id} form={form} previewAnswers={previewAnswers} />;
  if (step === 5) return <div class="forms-step-panel"><p class="subtle">Messages and named administrators are part of the form, not a conference-wide default.</p><div class="field"><label>Thank-you template key</label><input value={form.thankyou_template_key ?? ""} placeholder="submission_confirmation" onInput={(event) => setForm({ ...form, thankyou_template_key: (event.currentTarget as HTMLInputElement).value || null })} /></div><div class="field"><label>Reminder offset hours</label><input type="number" min="0" value={form.reminder_offset_hours ?? ""} onInput={(event) => { const value = (event.currentTarget as HTMLInputElement).value; setForm({ ...form, reminder_offset_hours: value === "" ? null : Number(value) }); }} /></div><div class="forms-admin-list"><span class="eyebrow">Form administrators</span>{form.admins.length ? form.admins.map((admin) => <div key={admin.id}><strong>{disambiguatedNames(form.admins.map((entry) => ({ id: entry.person_id, name: entry.name }))).get(admin.person_id) ?? admin.name}</strong><span>{admin.email}</span><Button small variant="ghost" aria-label={`Remove ${disambiguatedNames(form.admins.map((entry) => ({ id: entry.person_id, name: entry.name }))).get(admin.person_id) ?? admin.name} as a form administrator`} onClick={() => removeAdmin(admin.person_id)} disabled={busy !== null}>Remove</Button></div>) : <span class="subtle">No explicit form administrators. Program staff retain access.</span>}<div class="forms-admin-add"><input value={adminPersonId} placeholder="person_id" aria-label="Administrator person ID" onInput={(event) => setAdminPersonId((event.currentTarget as HTMLInputElement).value)} /><Button small onClick={addAdmin} disabled={busy !== null || !adminPersonId.trim()}>Add admin</Button></div></div><Button variant="primary" onClick={saveForm} disabled={busy !== null}>Save messages</Button></div>;
  return <div class="forms-step-panel"><div class="forms-publish-summary"><span class="eyebrow">Publication state</span><strong>{form.status === "open" ? "Open and public" : form.status === "closed" ? "Closed, URL preserved" : "Unpublished draft"}</strong><span>{form.response_count.toLocaleString()} responses · {form.fields.length} fields · {form.kind === "abstract" ? "Enters evaluation" : "Ready for agenda"}</span></div><div class="forms-state-buttons"><Button onClick={() => setLifecycle("close")} disabled={busy !== null || form.status !== "open"}>Close</Button><Button onClick={() => setLifecycle("reopen")} disabled={busy !== null || form.status !== "closed"}>Reopen</Button><Button variant="primary" onClick={() => setLifecycle("publish")} disabled={busy !== null || form.status === "open"}>Publish</Button></div></div>;
}

function RoutingRulesPanel({ eventId, form, previewAnswers }: { eventId: string; form: FormDetail; previewAnswers: Record<string, FormAnswerValue> }): JSX.Element {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [tracks, setTracks] = useState<RoutingOption[]>([]);
  const [tags, setTags] = useState<RoutingOption[]>([]);
  const [levels, setLevels] = useState<RoutingOption[]>([]);
  const [reviewPlans, setReviewPlans] = useState<ReviewOption[]>([]);
  const [reviewCommittees, setReviewCommittees] = useState<ReviewOption[]>([]);
  const [reviewRounds, setReviewRounds] = useState<ReviewOption[]>([]);
  const [preview, setPreview] = useState<RoutingPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<RoutingRuleDraft | null>(null);
  const [fixingRuleId, setFixingRuleId] = useState<string | null>(null);

  const fieldChoices = fieldOptions(form);

  const loadPreview = async (): Promise<void> => {
    try {
      const result = await request<{ data: RoutingPreview }>(`/api/v1/events/${eventId}/forms/${form.id}/routing-preview`, "/api/v1/events/{eventId}/forms/{formId}/routing-preview");
      setPreview(result.data);
    } catch {
      // Preview is an evidence panel, not a second source of rule state. A
      // missing review grant or an empty fixture should not hide the builder.
      setPreview(null);
    }
  };

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const [ruleResult, settingsResult, tagResult, levelResult, planResult] = await Promise.all([
        request<{ data: RoutingRule[] }>(`/api/v1/events/${eventId}/routing-rules`, "/api/v1/events/{eventId}/routing-rules"),
        request<{ data: { tracks: RoutingOption[] } }>(`/api/v1/events/${eventId}/settings`, "/api/v1/events/{eventId}/settings"),
        request<{ data: RoutingOption[] }>(`/api/v1/events/${eventId}/tags`, "/api/v1/events/{eventId}/tags"),
        request<{ data: RoutingOption[] }>(`/api/v1/events/${eventId}/levels`, "/api/v1/events/{eventId}/levels"),
        request<{ data: ReviewOption[] }>(`/api/v1/events/${eventId}/plans?page=1&per_page=100`, "/api/v1/events/{eventId}/plans"),
      ]);
      const planDetails = await Promise.all(planResult.data.map((plan) => request<{ rounds?: ReviewOption[]; committees?: ReviewOption[] }>(`/api/v1/events/${eventId}/plans/${plan.id}`, "/api/v1/events/{eventId}/plans/{planId}")));
      setRules(ruleResult.data.sort((left, right) => left.position - right.position || left.id.localeCompare(right.id)));
      setTracks(settingsResult.data.tracks);
      setTags(tagResult.data);
      setLevels(levelResult.data);
      setReviewPlans(planResult.data);
      setReviewRounds(planDetails.flatMap((detail, index) => (detail.rounds ?? []).map((round) => ({ ...round, plan_id: planResult.data[index]?.id }))));
      setReviewCommittees(planDetails.flatMap((detail) => detail.committees ?? []).filter((committee, index, all) => all.findIndex((item) => item.id === committee.id) === index));
      setMessage("");
    } catch (error) {
      setMessage(errorSummary(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); void loadPreview(); }, [eventId, form.id]);

  const run = async (key: string, action: () => Promise<void>): Promise<void> => {
    setBusy(key);
    setMessage("");
    try { await action(); } catch (error) { setMessage(errorSummary(error)); } finally { setBusy(null); }
  };

  const refreshPreview = async (): Promise<void> => {
    await loadPreview();
  };

  const updateEditor = (change: Partial<RoutingRuleDraft>): void => {
    setEditor((current) => current ? { ...current, ...change } : current);
  };

  const updateCondition = (index: number, change: Partial<FormConditionClause>): void => {
    setEditor((current) => current ? { ...current, conditions: current.conditions.map((condition, itemIndex) => itemIndex === index ? { ...condition, ...change } : condition) } : current);
  };

  const updateAction = (change: Partial<RoutingRuleDraft["action"]>): void => {
    setEditor((current) => current ? { ...current, action: { ...current.action, ...change } } : current);
  };

  const openNew = (): void => {
    setFixingRuleId(null);
    setEditor(emptyRoutingDraft(fieldChoices[0]?.value ?? "vendor_content"));
    setMessage("");
  };

  const openEdit = (rule: RoutingRule, fix = false): void => {
    setFixingRuleId(fix ? rule.id : null);
    setEditor({ id: rule.id, name: rule.name, conditions: routingConditions(rule), action: routingAction(rule) });
    setMessage(fix ? "This rule is disabled for you, not deleted. Replace the dangling reference, then save." : "");
  };

  const save = () => void run("save", async () => {
    if (!editor) return;
    const conditions = editor.conditions.map((condition) => ({
      fieldKey: canonicalRoutingFieldKey(condition.fieldKey),
      op: condition.op,
      ...(condition.value === undefined ? {} : { value: condition.value }),
    }));
    const action = {
      track_id: editor.action.track_id,
      add_tag_ids: [...new Set(editor.action.add_tag_ids)],
      level_id: editor.action.level_id,
      plan_id: editor.action.plan_id,
      committee_id: editor.action.committee_id,
      round_id: editor.action.round_id,
    };
    const payload = { name: editor.name.trim() || "Untitled routing rule", when_json: { all: conditions }, then_json: action, enabled: true };
    const result = editor.id
      ? await request<{ data: RoutingRule }>(`/api/v1/events/${eventId}/routing-rules/${editor.id}`, "/api/v1/events/{eventId}/routing-rules/{ruleId}", { method: "PATCH", body: JSON.stringify(payload) })
      : await request<{ data: RoutingRule }>(`/api/v1/events/${eventId}/routing-rules`, "/api/v1/events/{eventId}/routing-rules", { method: "POST", body: JSON.stringify(payload) });
    setRules((current) => {
      const next = editor.id ? current.map((rule) => rule.id === result.data.id ? result.data : rule) : [...current, result.data];
      return next.sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
    });
    setEditor(null);
    setFixingRuleId(null);
    await refreshPreview();
  });

  const toggle = (rule: RoutingRule) => void run(`toggle-${rule.id}`, async () => {
    if (rule.dangling_references.length > 0) {
      openEdit(rule, true);
      return;
    }
    const result = await request<{ data: RoutingRule }>(`/api/v1/events/${eventId}/routing-rules/${rule.id}`, "/api/v1/events/{eventId}/routing-rules/{ruleId}", { method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled }) });
    setRules((current) => current.map((item) => item.id === result.data.id ? result.data : item));
    await refreshPreview();
  });

  const remove = (rule: RoutingRule) => void run(`delete-${rule.id}`, async () => {
    await request<{ data: RoutingRule }>(`/api/v1/events/${eventId}/routing-rules/${rule.id}`, "/api/v1/events/{eventId}/routing-rules/{ruleId}", { method: "DELETE" });
    setRules((current) => current.filter((item) => item.id !== rule.id));
    if (editor?.id === rule.id) setEditor(null);
    await refreshPreview();
  });

  const move = (rule: RoutingRule, direction: -1 | 1) => void run(`move-${rule.id}`, async () => {
    const ordered = [...rules].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
    const current = ordered.findIndex((item) => item.id === rule.id);
    const position = Math.max(0, Math.min(ordered.length - 1, current + direction));
    if (current < 0 || position === current) return;
    const result = await request<{ data: RoutingRule[] }>(`/api/v1/events/${eventId}/routing-rules/reorder`, "/api/v1/events/{eventId}/routing-rules/reorder", { method: "PATCH", body: JSON.stringify({ rule_id: rule.id, position }) });
    setRules(result.data);
    await refreshPreview();
  });

  const liveAnswers: Record<string, FormAnswerValue> = {};
  for (const [key, value] of Object.entries(previewAnswers)) liveAnswers[canonicalRoutingFieldKey(key)] = value;
  const derivedKeys = ["format", "tracks", "vendor", "vendor_content", "vendor_affiliation"];
  const eventFieldKeys = new Set([...derivedKeys, ...fieldChoices.map((field) => canonicalRoutingFieldKey(field.value))]);
  const formFieldKeys = new Set([...derivedKeys, ...form.fields.map((field) => canonicalRoutingFieldKey(field.key))]);
  const liveRule = rules.find((rule) => rule.enabled && rule.dangling_references.length === 0 && evaluateRoutingConditions(routingConditions(rule), { eventFieldKeys, formFieldKeys, answers: liveAnswers }).state === "matched");

  const selectedPlanRounds = editor?.action.plan_id ? reviewRounds.filter((round) => round.plan_id === editor.action.plan_id) : reviewRounds;
  const selectedConditionKeys = new Set(editor?.conditions.map((condition) => condition.fieldKey) ?? []);

  return <div class="forms-step-panel forms-routing-panel">
    <div class="forms-routing-header">
      <div><span class="eyebrow">Conference routing</span><strong>Rules apply across every form on this conference.</strong><span class="subtle">A rule that names a question this form does not ask is skipped here, never evaluated.</span></div>
      <Button variant="primary" onClick={openNew} disabled={busy !== null || loading}>＋ New rule</Button>
    </div>
    <p class="subtle">Rules run top to bottom. The first matching rule wins; setting a track replaces the submitted track projection, while tags are added idempotently. Manual record edits never re-run these rules.</p>
    {message && <p class="record-inline-message error" role="alert">{message}</p>}

    {editor && <section class="forms-routing-editor" aria-label={editor.id ? "Edit routing rule" : "New routing rule"}>
      <div class="forms-editor-heading"><div><span class="eyebrow">{editor.id ? fixingRuleId ? "Fix rule" : "Edit rule" : "New rule"}</span><h3>{editor.name || "Untitled routing rule"}</h3></div><Button small variant="ghost" onClick={() => { setEditor(null); setFixingRuleId(null); }}>Cancel</Button></div>
      <label class="field"><span>Name</span><input value={editor.name} placeholder="Vendor content review" onInput={(event) => updateEditor({ name: event.currentTarget.value })} /></label>
      <div class="forms-routing-conditions">
        <div class="forms-routing-section-heading"><strong>When</strong><span>All conditions must match · 1–5 conditions</span></div>
        {editor.conditions.map((condition, index) => <div class={`forms-routing-condition ${fixingRuleId ? "is-dangling" : ""}`} key={`${editor.id ?? "new"}-${index}`}>
          <span class="forms-routing-condition-number">{index + 1}</span>
          <label class="field"><span>Question or answer</span><select value={condition.fieldKey} onChange={(event) => updateCondition(index, { fieldKey: event.currentTarget.value })}>{selectedConditionKeys.has(condition.fieldKey) && !fieldChoices.some((field) => field.value === condition.fieldKey) && <option value={condition.fieldKey}>{condition.fieldKey} (missing)</option>}{fieldChoices.map((field) => <option value={field.value} key={field.value}>{field.label}</option>)}</select></label>
          <label class="field"><span>Operator</span><select value={condition.op} onChange={(event) => { const op = event.currentTarget.value as RoutingOperator; updateCondition(index, op === "answered" || op === "not_answered" ? { op, value: undefined } : { op, value: condition.value === undefined ? "Yes" : condition.value }); }}>{ROUTING_OPERATORS.map((item) => <option value={item} key={item}>{operatorLabel(item)}</option>)}</select></label>
          <label class="field"><span>Value</span><input value={condition.value === undefined ? "" : String(condition.value)} disabled={condition.op === "answered" || condition.op === "not_answered"} onInput={(event) => updateCondition(index, { value: event.currentTarget.value })} /></label>
          <Button small variant="ghost" aria-label={`Remove condition ${index + 1}`} onClick={() => setEditor((current) => current && current.conditions.length > 1 ? { ...current, conditions: current.conditions.filter((_, itemIndex) => itemIndex !== index) } : current)} disabled={editor.conditions.length <= 1}>Remove</Button>
        </div>)}
        <Button small onClick={() => setEditor((current) => current && current.conditions.length < 5 ? { ...current, conditions: [...current.conditions, { fieldKey: fieldChoices[0]?.value ?? "vendor_content", op: "equals", value: "Yes" }] } : current)} disabled={editor.conditions.length >= 5}>＋ Add condition</Button>
      </div>

      <div class="forms-routing-actions">
        <div class="forms-routing-section-heading"><strong>Then</strong><span>Choose one or more destinations</span></div>
        <div class="grid-2">
          <label class="field"><span>Set primary track</span><select value={editor.action.track_id ?? ""} onChange={(event) => updateAction({ track_id: event.currentTarget.value || null })}><option value="">Keep submitted track</option>{tracks.map((track) => <option value={track.id} key={track.id}>{track.name}</option>)}</select></label>
          <label class="field"><span>Set audience level</span><select value={editor.action.level_id ?? ""} onChange={(event) => updateAction({ level_id: event.currentTarget.value || null })}><option value="">Keep submitted level</option>{levels.map((level) => <option value={level.id} key={level.id}>{level.name}</option>)}</select></label>
          <label class="field"><span>Add tags</span><select multiple size={Math.min(5, Math.max(2, tags.length))} onChange={(event) => updateAction({ add_tag_ids: Array.from(event.currentTarget.selectedOptions).map((option) => option.value) })}>{tags.map((tag) => <option value={tag.id} selected={editor.action.add_tag_ids.includes(tag.id)} key={tag.id}>{tag.name}</option>)}</select></label>
          <div class="forms-routing-review-target"><span class="eyebrow">Route to review</span><label class="field"><span>Plan</span><select value={editor.action.plan_id ?? ""} onChange={(event) => { const planId = event.currentTarget.value || null; const roundId = editor.action.round_id && reviewRounds.some((round) => round.id === editor.action.round_id && round.plan_id === planId) ? editor.action.round_id : null; updateAction({ plan_id: planId, round_id: roundId }); }}><option value="">No review plan</option>{reviewPlans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name}{plan.status && plan.status !== "open" ? ` · ${plan.status}` : ""}</option>)}</select></label><label class="field"><span>Committee</span><select value={editor.action.committee_id ?? ""} onChange={(event) => updateAction({ committee_id: event.currentTarget.value || null })}><option value="">Default committee</option>{reviewCommittees.map((committee) => <option value={committee.id} key={committee.id}>{committee.name}</option>)}</select></label><label class="field"><span>Round</span><select value={editor.action.round_id ?? ""} onChange={(event) => updateAction({ round_id: event.currentTarget.value || null })}><option value="">Default round</option>{selectedPlanRounds.map((round) => <option value={round.id} key={round.id}>{round.name}</option>)}</select></label></div>
        </div>
        {!reviewPlans.length && <span class="field-note">Create an open review plan before routing arrivals into review.</span>}
      </div>
      <div class="forms-routing-editor-footer"><span class="subtle">{landingSentence(editor.action, tracks, tags, levels)}</span><Button variant="primary" onClick={save} disabled={busy !== null || editor.conditions.length < 1}>{busy === "save" ? "Saving…" : "Save rule"}</Button></div>
    </section>}

    <div class="forms-routing-preview" aria-live="polite">
      <div class="forms-routing-section-heading"><strong>Live proof</strong><span>Last 100 public arrivals · rule order is binding</span></div>
      {preview ? <>
        <div class="forms-routing-proof">{preview.rules.length ? preview.rules.map((item) => <div key={item.rule_id}><strong>{rules.find((rule) => rule.id === item.rule_id)?.name ?? item.rule_id}</strong><span>of the last {preview.sample_size} arrivals, {item.would_have_matched ?? 0} would have matched · {item.rules_above} rules above run first</span>{item.reason && <small>{item.reason}</small>}</div>) : <span class="subtle">No enabled rules to preview yet.</span>}</div>
        <div class="forms-routing-landing"><span class="eyebrow">This answer preview</span><strong>{liveRule ? landingSentence(routingAction(liveRule), tracks, tags, levels) : "Would land in: no rule matches — stays as submitted"}</strong></div>
      </> : <span class="subtle">Live proof is unavailable until this form has a readable routing preview.</span>}
    </div>

    <div class="forms-routing-list" aria-live="polite">
      <div class="forms-routing-section-heading"><strong>Ordered rules</strong><span>{rules.length} rule{rules.length === 1 ? "" : "s"} · first match wins</span></div>
      {loading ? <span class="subtle">Reading routing rules…</span> : rules.length === 0 ? <span class="subtle">No routing rules yet. Add a rule to prove where the next arrival will land.</span> : rules.map((rule, index) => {
        const clauses = routingConditions(rule);
        const action = routingAction(rule);
        const previewRule = preview?.rules.find((item) => item.rule_id === rule.id);
        return <article class={`forms-rule-row ${rule.enabled ? "" : "is-disabled"} ${rule.dangling_references.length ? "is-dangling" : ""}`} key={rule.id}>
          <div class="forms-rule-copy"><strong>{index + 1}. {rule.name}</strong><span>When {conditionSentence(clauses, fieldChoices)} → {actionSentence(action, tracks, tags, levels)}</span>{rule.dangling_reason && <small>{rule.dangling_reason} This rule is disabled for you, not deleted.</small>}{previewRule && <small class="forms-rule-proof">of the last {preview?.sample_size ?? 0} arrivals, {previewRule.would_have_matched ?? 0} would have matched · {previewRule.rules_above} rules above run first</small>}</div>
          <div class="forms-rule-actions"><Chip tone={rule.enabled ? "success" : "warning"}>{rule.dangling_references.length ? "Fix needed" : rule.enabled ? "On" : "Off"}</Chip><Button small onClick={() => openEdit(rule)} disabled={busy !== null}>Edit</Button>{rule.dangling_references.length > 0 && <Button small variant="primary" onClick={() => openEdit(rule, true)} disabled={busy !== null}>Fix rule</Button>}<Button small onClick={() => void move(rule, -1)} disabled={busy !== null || index === 0} aria-label={`Move ${rule.name} up`}>↑</Button><Button small onClick={() => void move(rule, 1)} disabled={busy !== null || index === rules.length - 1} aria-label={`Move ${rule.name} down`}>↓</Button><Button small onClick={() => void toggle(rule)} disabled={busy !== null}>{rule.enabled ? "Turn off" : "Turn on"}</Button><Button small variant="danger" onClick={() => void remove(rule)} disabled={busy !== null}>Archive</Button></div>
        </article>;
      })}
    </div>
  </div>;
}

function fieldOptions(form: FormDetail): Array<{ value: string; label: string }> {
  const derived = [
    { value: "format", label: "Format" },
    { value: "tracks", label: "Tracks" },
    { value: "vendor_content", label: "Vendor content" },
    { value: "vendor", label: "Vendor flag" },
    { value: "vendor_affiliation", label: "Vendor affiliation" },
  ];
  const fields = form.fields.map((field) => ({ value: field.key, label: field.label }));
  return [...derived, ...fields.filter((field) => !derived.some((item) => item.value === field.value))];
}
