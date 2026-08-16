import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { BOUND_SOURCE_LABELS, BOUND_SOURCES, boundSourceOf, isBoundSourceCompatible, type BoundSource } from "../../lib/bound-options";
import { eventTimeLabel, instantToLocalDateTime, localDateTimeToInstant } from "../../lib/event-time";
import { fieldPreviewProjection, isFieldApplicable, type FormAnswerValue, type FormCondition } from "../../lib/form-conditions";
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
  created_at: number;
  updated_at: number;
}

interface FormAdmin {
  id: string;
  person_id: string;
  name: string;
  email: string;
}

interface FormDetail extends FormSummary {
  reminder_offset_hours: number | null;
  thankyou_template_key: string | null;
  admin_notify_person_ids: string[];
  turnstile_required: boolean;
  fields: FormField[];
  admins: FormAdmin[];
  preview_fields: Array<{ key: string; label: string; type: string; position: number; required: boolean; condition: FormCondition | null }>;
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

function PreviewControl({ field, value, onChange }: { field: FormField; value: FormAnswerValue | undefined; onChange: (value: FormAnswerValue) => void }): JSX.Element {
  if (field.type === "long_text") return <textarea class="forms-preview-input" aria-label={field.label} value={typeof value === "string" ? value : ""} onInput={(event) => onChange((event.currentTarget as HTMLTextAreaElement).value)} />;
  if (field.type === "single_select") return <select class="forms-preview-input" aria-label={field.label} value={typeof value === "string" ? value : ""} onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value)}><option value="">Choose an option</option>{selectOptions(field).map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  if (field.type === "multi_select") return <div class="forms-preview-options">{selectOptions(field).map((option) => <label key={option}><input type="checkbox" checked={Array.isArray(value) && value.includes(option)} onChange={(event) => { const current = Array.isArray(value) ? value.filter((item): item is FormAnswerValue => item !== option) : []; onChange((event.currentTarget as HTMLInputElement).checked ? [...current, option] : current); }} /> {option}</label>)}</div>;
  if (field.type === "file") return <input class="forms-preview-input" aria-label={field.label} type="file" />;
  return <input class="forms-preview-input" aria-label={field.label} type={field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "date" ? "date" : "text"} value={typeof value === "string" || typeof value === "number" ? String(value) : ""} onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)} />;
}

function Preview({ fields, answers, onAnswer }: { fields: FormField[]; answers: Record<string, FormAnswerValue>; onAnswer: (key: string, value: FormAnswerValue) => void }): JSX.Element {
  const ordered = [...fields].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const conditionalTriggers = ordered.filter((field) => ordered.some((candidate) => candidate.condition?.all.some((clause) => clause.fieldKey === field.key)));
  const visible = ordered.filter((field) => isFieldApplicable(field, answers));
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
  const [newFieldType, setNewFieldType] = useState<FieldType>("short_text");
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldOptions, setNewFieldOptions] = useState("");
  const [newFieldSource, setNewFieldSource] = useState<"" | BoundSource>("");
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
      setConditionTrigger("");
      setAdminPersonId("");
      setMessage("");
    } catch (error) {
      setMessage(errorSummary(error));
    }
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
  useEffect(() => { if (selectedId) void loadForm(selectedId); else setForm(null); }, [selectedId, eventId]);
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
      const created = await request<FormField>(`/api/v1/events/${eventId}/forms/${form.id}/fields`, "/api/v1/events/{eventId}/forms/{formId}/fields", { method: "POST", body: JSON.stringify({ key, label, type, required: newFieldRequired, config }) });
      setForm((current) => current ? { ...current, fields: [...current.fields, created] } : current);
      // The add row keeps focus and its own identity; stealing the detail
      // editor here is what invalidated the element a caller had just
      // addressed, costing a re-query per field.
      setNewFieldLabel("");
      setNewFieldOptions("");
      setNewFieldSource("");
      setNewFieldRequired(false);
    });
  };

  const saveField = () => {
    if (!form || !selectedField) return;
    void mutate("field", async () => {
      const condition = conditionTrigger ? { all: [{ fieldKey: conditionTrigger, op: "equals", value: conditionValue }] } : null;
      const updated = await request<FormField>(`/api/v1/events/${eventId}/forms/${form.id}/fields/${selectedField.id}`, "/api/v1/events/{eventId}/forms/{formId}/fields/{fieldId}", { method: "PATCH", body: JSON.stringify({ key: selectedField.key, label: selectedField.label, help_text: selectedField.help_text, type: selectedField.type, required: selectedField.required, config: selectedField.config, condition }) });
      setForm((current) => current ? { ...current, fields: current.fields.map((field) => field.id === updated.id ? updated : field) } : current);
    });
  };

  const deleteField = () => {
    if (!form || !selectedField) return;
    void mutate("field", async () => { await request<{ deleted: boolean }>(`/api/v1/events/${eventId}/forms/${form.id}/fields/${selectedField.id}`, "/api/v1/events/{eventId}/forms/{formId}/fields/{fieldId}", { method: "DELETE" }); setForm((current) => current ? { ...current, fields: current.fields.filter((field) => field.id !== selectedField.id) } : current); setSelectedFieldId(form.fields.find((field) => field.id !== selectedField.id)?.id ?? null); });
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

  const setFieldValue = (key: keyof FormField, value: unknown) => { setForm((current) => current && selectedField ? { ...current, fields: current.fields.map((field) => field.id === selectedField.id ? { ...field, [key]: value } : field) } : current); };
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
  if (!form) return <div class="forms-page"><PageHeader title="CFP forms" copy="Build the conference intake once; the public form follows its schema." actions={<><AgentBriefLauncher surface="cfp" eventId={eventId} /><Button variant="primary" onClick={addForm} disabled={busy !== null}>+ New form</Button></>} />{catalog.length === 0 ? <EmptyState title="Your conference has no forms yet" copy="Create the first Abstract or Session form to start collecting the program." action={<Button onClick={addForm}>+ New form</Button>} /> : <section class="forms-catalog">{catalog.map((item) => <button key={item.id} class="forms-catalog-card" onClick={() => setSelectedId(item.id)}><Chip tone={formStatusTone(item.status)}>{item.status}</Chip><strong>{item.name}</strong><span>{item.kind === "abstract" ? "Abstracts" : "Sessions"} · {item.visibility}</span><small>{item.response_count.toLocaleString()} responses</small></button>)}</section>}</div>;

  return <div class="forms-page">
    <PageHeader title="CFP forms" copy={`${catalog.length} conference form${catalog.length === 1 ? "" : "s"} · each audience, field list, rules, and response state stays isolated.`} actions={<><AgentBriefLauncher surface="cfp" eventId={eventId} /><Button onClick={duplicateForm} disabled={busy !== null}>Duplicate</Button><Button onClick={addForm} disabled={busy !== null}>+ New form</Button>{form.status === "open" ? <Button variant="primary" onClick={() => setLifecycle("close")} disabled={busy !== null}>Close form</Button> : <Button variant="primary" onClick={() => setLifecycle(form.status === "closed" ? "reopen" : "publish")} disabled={busy !== null}>{form.status === "closed" ? "Reopen form" : "Publish changes"}</Button>}</>} />
    <section class="forms-catalog" aria-label="Conference forms">{catalog.map((item) => <button key={item.id} class={`forms-catalog-card ${item.id === form.id ? "active" : ""}`} onClick={() => setSelectedId(item.id)}><Chip tone={formStatusTone(item.status)}>{item.status}</Chip><strong>{item.name}</strong><span>{item.kind === "abstract" ? "Abstracts" : "Sessions"} · {item.visibility}</span><small>{item.response_count.toLocaleString()} responses · {item.public_url ?? "private until published"}</small></button>)}</section>
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
    <div class="forms-builder">
      <aside class="card forms-steps" aria-label="Form builder steps">
        <CardHeader title="Build steps" />
        <CardBody><div class="forms-step-list">{STEP_NAMES.map((name, index) => <button key={name} class={step === index ? "active" : ""} onClick={() => setStep(index)}><span>{index + 1}</span>{name}</button>)}</div><div class="divider" /><div class="field"><label>Collects</label><div class="segment forms-target"><button class={form.kind === "abstract" ? "active" : ""} disabled={form.status !== "draft"} onClick={() => setForm({ ...form, kind: "abstract" })}>Abstracts</button><button class={form.kind === "session" ? "active" : ""} disabled={form.status !== "draft"} onClick={() => setForm({ ...form, kind: "session" })}>Sessions</button></div><span class="field-note">{form.status === "draft" ? form.kind === "abstract" ? "Enters the evaluation pipeline." : "Bypasses evaluation; ready for agenda." : "Target locked after the conference form opened."}</span></div><div class="divider" /><div class="field"><label>Close date {eventTimeLabel(timezone)}</label><input type="datetime-local" value={timezone ? instantToLocalDateTime(form.closes_at, timezone) : ""} disabled={!timezone} onInput={(inputEvent) => { if (!timezone) return; setForm({ ...form, closes_at: localDateTimeToInstant((inputEvent.currentTarget as HTMLInputElement).value, timezone) }); }} /></div><SubmissionCapacityEditor inherit={form.submitter_limit_inherit} rawLimit={form.per_submitter_limit} effectiveLimit={form.effective_submitter_limit} onChange={(patch) => setForm({ ...form, ...patch })} /><Button variant="primary" onClick={saveForm} disabled={busy !== null}>{busy === "form" ? "Saving…" : "Save form"}</Button></CardBody>
      </aside>
      <section class="card forms-editor" aria-label="Form editor">
        <CardHeader title={STEP_NAMES[step] ?? "Form fields"}><Chip tone={formStatusTone(form.status)}>{form.status}</Chip></CardHeader>
        <CardBody>{step === 2 ? <>
          <div class="forms-editor-intro"><div><strong>Fields in public order</strong><span>Drag is optional; the arrows are keyboard-safe and persist the same order.</span></div></div>
          <form class="forms-add-row" data-field-add="row" aria-label="Add a field" onSubmit={(event) => { event.preventDefault(); addField(); }}>
            <div class="field"><label for="new-field-label">New field label</label><input id="new-field-label" name="new-field-label" data-field-add="label" value={newFieldLabel} placeholder="Key takeaway" onInput={(event) => setNewFieldLabel((event.currentTarget as HTMLInputElement).value)} /></div>
            <div class="field"><label for="new-field-type">Type</label><select id="new-field-type" name="new-field-type" data-field-add="type" value={newFieldType} onChange={(event) => { const type = (event.currentTarget as HTMLSelectElement).value as FieldType; setNewFieldType(type); if (newFieldSource && !isBoundSourceCompatible(newFieldSource, type)) setNewFieldSource(""); }}>{FIELD_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
            <div class="field"><label for="new-field-source">Options come from</label><select id="new-field-source" name="new-field-source" data-field-add="source" value={newFieldSource} disabled={!isSelectType(newFieldType)} onChange={(event) => setNewFieldSource((event.currentTarget as HTMLSelectElement).value as "" | BoundSource)}>{sourceChoicesFor(newFieldType).map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></div>
            <div class="field"><label for="new-field-options">Options · comma separated</label><input id="new-field-options" name="new-field-options" data-field-add="options" value={newFieldSource && isSelectType(newFieldType) ? "" : newFieldOptions} disabled={!isSelectType(newFieldType) || Boolean(newFieldSource)} placeholder={!isSelectType(newFieldType) ? "Select fields only" : newFieldSource ? `From Conference settings → ${BOUND_SOURCE_LABELS[newFieldSource]}` : "Beginner, Intermediate, Advanced"} onInput={(event) => setNewFieldOptions((event.currentTarget as HTMLInputElement).value)} /></div>
            <label class="forms-check forms-add-required" for="new-field-required"><input id="new-field-required" name="new-field-required" data-field-add="required" type="checkbox" checked={newFieldRequired} onChange={(event) => setNewFieldRequired((event.currentTarget as HTMLInputElement).checked)} /> Required</label>
            <Button id="new-field-submit" data-field-add="submit" type="submit" variant="primary" disabled={busy !== null}>{busy === "field" ? "Adding…" : "Add field"}</Button>
          </form>
          <div class="forms-field-list">{form.fields.length ? [...form.fields].sort((left, right) => left.position - right.position).map((field, index) => { const summary = field.condition ? conditionSummary(field.condition) : ""; return <button key={field.id} class={`forms-field-row ${field.id === selectedFieldId ? "active" : ""}`} data-builder-field={field.key} onClick={() => setSelectedFieldId(field.id)}><span class="forms-drag-handle" aria-hidden="true">⋮⋮</span><span class="forms-field-order">{String(index + 1).padStart(2, "0")}</span><span class="forms-field-copy"><strong data-field-label={field.label}>{field.label}{field.required ? " *" : ""}</strong><small data-condition-summary={summary}>{fieldTypeLabel(field.type)} · {field.required ? "Required" : "Optional"}{summary ? ` · When ${summary}` : ""}</small></span><span class="forms-field-actions"><span class="chip">{field.type}</span><span class="forms-arrow" aria-hidden="true">→</span></span></button>; }) : <div class="forms-field-empty"><strong>No fields yet</strong><span>Add the first question to give the public form a place to start.</span><Button small variant="primary" onClick={() => addField()}>＋ Add first field</Button></div>}</div>
          {selectedField && <div class="forms-field-editor"><div class="forms-editor-heading"><div><span class="eyebrow">Editing field</span><h3>{selectedField.label}</h3></div><div class="forms-reorder-actions"><Button small onClick={() => moveField(-1)}>↑</Button><Button small onClick={() => moveField(1)}>↓</Button><Button small variant="danger" onClick={deleteField}>Delete</Button></div></div><div class="grid-2"><div class="field"><label>Field key</label><input value={selectedField.key} onInput={(event) => setFieldValue("key", (event.currentTarget as HTMLInputElement).value)} /></div><div class="field"><label>Field type</label><select value={selectedField.type} onChange={(event) => setFieldValue("type", (event.currentTarget as HTMLSelectElement).value)}>{FIELD_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div></div><div class="field"><label>Label</label><input value={selectedField.label} onInput={(event) => setFieldValue("label", (event.currentTarget as HTMLInputElement).value)} /></div><div class="field"><label>Help text</label><textarea value={selectedField.help_text ?? ""} onInput={(event) => setFieldValue("help_text", (event.currentTarget as HTMLTextAreaElement).value)} /></div><label class="forms-check"><input type="checkbox" checked={selectedField.required} onChange={(event) => setFieldValue("required", (event.currentTarget as HTMLInputElement).checked)} /> Required when this field applies</label><FieldValidationEditor field={selectedField} onConfig={setFieldConfig} /><div class="forms-condition-box"><div><strong>Conditional visibility</strong><span>Persisted as <code>{"{ all: [{ fieldKey, op, value }] }"}</code>; hidden values are never written.</span></div><div class="grid-2"><div class="field"><label>Show when this field</label><select value={conditionTrigger} onChange={(event) => setConditionTrigger((event.currentTarget as HTMLSelectElement).value)}><option value="">Always show</option>{form.fields.filter((field) => field.id !== selectedField.id).map((field) => <option key={field.id} value={field.key}>{field.label}</option>)}</select></div><div class="field"><label>Equals</label><input value={conditionValue} onInput={(event) => setConditionValue((event.currentTarget as HTMLInputElement).value)} disabled={!conditionTrigger} /></div></div></div><Button variant="primary" onClick={saveField} disabled={busy !== null}>{busy === "field" ? "Saving…" : "Save field"}</Button></div>}
        </> : <StepPanel step={step} form={form} setForm={setForm} saveForm={saveForm} setLifecycle={setLifecycle} busy={busy} adminPersonId={adminPersonId} setAdminPersonId={setAdminPersonId} addAdmin={addAdmin} removeAdmin={removeAdmin} />}</CardBody>
      </section>
      <section class="card forms-preview-card" aria-label="Live preview"><CardHeader title="Live preview"><Chip>Same field schema</Chip></CardHeader><div class="forms-preview-reservation"><span>Reserved preview column</span><small>Fields change inside this frame; the editor stays put.</small></div><Preview fields={form.fields} answers={previewAnswers} onAnswer={(key, value) => setPreviewAnswers((current) => ({ ...current, [key]: value }))} /><div class="forms-projection" aria-label="Preview projection"><span class="eyebrow">Deep-equal projection</span><code>{JSON.stringify(projection.map((field) => ({ label: field.label, type: field.type, position: field.position, required: field.required })))}</code></div></section>
    </div>
  </div>;
}

function StepPanel({ step, form, setForm, saveForm, setLifecycle, busy, adminPersonId, setAdminPersonId, addAdmin, removeAdmin }: { step: number; form: FormDetail; setForm: (form: FormDetail) => void; saveForm: () => void; setLifecycle: (next: "publish" | "close" | "reopen") => void; busy: string | null; adminPersonId: string; setAdminPersonId: (value: string) => void; addAdmin: () => void; removeAdmin: (personId: string) => void }): JSX.Element {
  if (step === 0) return <div class="forms-step-panel"><p class="subtle">Choose the intake target and make the public identity legible before opening the conference form.</p><div class="field"><label>Form name</label><input value={form.name} onInput={(event) => setForm({ ...form, name: (event.currentTarget as HTMLInputElement).value })} /></div><div class="field"><label>Public slug</label><input value={form.slug} onInput={(event) => setForm({ ...form, slug: (event.currentTarget as HTMLInputElement).value })} /></div><div class="forms-lock-note">{form.status === "draft" ? "This target can still be changed while the form is unpublished." : "Target locked after opening. Reopening preserves this URL and its responses."}</div><Button variant="primary" onClick={saveForm} disabled={busy !== null}>Save Type & basics</Button></div>;
  if (step === 1) return <div class="forms-step-panel"><p class="subtle">Welcome copy appears above the first field on the public form.</p><div class="field"><label>Welcome copy</label><textarea rows={7} value={form.welcome_md} onInput={(event) => setForm({ ...form, welcome_md: (event.currentTarget as HTMLTextAreaElement).value })} /></div><Button variant="primary" onClick={saveForm} disabled={busy !== null}>Save welcome</Button></div>;
  if (step === 3) return <div class="forms-step-panel"><p class="subtle">Speaker and sponsor limits are stated before the first add-person control.</p><div class="grid-2"><div class="field"><label>Minimum speakers</label><input type="number" min="0" value={form.min_speakers} onInput={(event) => setForm({ ...form, min_speakers: Number((event.currentTarget as HTMLInputElement).value) || 0 })} /></div><div class="field"><label>Maximum speakers</label><input type="number" min="0" value={form.max_speakers} onInput={(event) => setForm({ ...form, max_speakers: Number((event.currentTarget as HTMLInputElement).value) || 0 })} /></div></div><div class="field"><label>Maximum sponsors</label><input type="number" min="0" value={form.max_sponsors} onInput={(event) => setForm({ ...form, max_sponsors: Number((event.currentTarget as HTMLInputElement).value) || 0 })} /></div><div class="forms-limit-note">{form.min_speakers}–{form.max_speakers} speakers · up to {form.max_sponsors} sponsor{form.max_sponsors === 1 ? "" : "s"}</div><Button variant="primary" onClick={saveForm} disabled={busy !== null}>Save participants</Button></div>;
  if (step === 4) return <div class="forms-step-panel"><p class="subtle">Conditions are schema-driven. Routing rules can consume the same field keys and answers at submission time.</p><div class="forms-rule-row"><strong>Vendor content</strong><span>When the vendor answer is Yes → workshop review</span><Chip>Schema rule</Chip></div><div class="forms-rule-row"><strong>Tracks</strong><span>One or more tracks; first selected remains primary for the agenda.</span><Chip>AC-234</Chip></div></div>;
  if (step === 5) return <div class="forms-step-panel"><p class="subtle">Messages and named administrators are part of the form, not a conference-wide default.</p><div class="field"><label>Thank-you template key</label><input value={form.thankyou_template_key ?? ""} placeholder="submission_confirmation" onInput={(event) => setForm({ ...form, thankyou_template_key: (event.currentTarget as HTMLInputElement).value || null })} /></div><div class="field"><label>Reminder offset hours</label><input type="number" min="0" value={form.reminder_offset_hours ?? ""} onInput={(event) => { const value = (event.currentTarget as HTMLInputElement).value; setForm({ ...form, reminder_offset_hours: value === "" ? null : Number(value) }); }} /></div><div class="forms-admin-list"><span class="eyebrow">Form administrators</span>{form.admins.length ? form.admins.map((admin) => <div key={admin.id}><strong>{disambiguatedNames(form.admins.map((entry) => ({ id: entry.person_id, name: entry.name }))).get(admin.person_id) ?? admin.name}</strong><span>{admin.email}</span><Button small variant="ghost" aria-label={`Remove ${disambiguatedNames(form.admins.map((entry) => ({ id: entry.person_id, name: entry.name }))).get(admin.person_id) ?? admin.name} as a form administrator`} onClick={() => removeAdmin(admin.person_id)} disabled={busy !== null}>Remove</Button></div>) : <span class="subtle">No explicit form administrators. Program staff retain access.</span>}<div class="forms-admin-add"><input value={adminPersonId} placeholder="person_id" aria-label="Administrator person ID" onInput={(event) => setAdminPersonId((event.currentTarget as HTMLInputElement).value)} /><Button small onClick={addAdmin} disabled={busy !== null || !adminPersonId.trim()}>Add admin</Button></div></div><Button variant="primary" onClick={saveForm} disabled={busy !== null}>Save messages</Button></div>;
  return <div class="forms-step-panel"><div class="forms-publish-summary"><span class="eyebrow">Publication state</span><strong>{form.status === "open" ? "Open and public" : form.status === "closed" ? "Closed, URL preserved" : "Unpublished draft"}</strong><span>{form.response_count.toLocaleString()} responses · {form.fields.length} fields · {form.kind === "abstract" ? "Enters evaluation" : "Ready for agenda"}</span></div><div class="forms-state-buttons"><Button onClick={() => setLifecycle("close")} disabled={busy !== null || form.status !== "open"}>Close</Button><Button onClick={() => setLifecycle("reopen")} disabled={busy !== null || form.status !== "closed"}>Reopen</Button><Button variant="primary" onClick={() => setLifecycle("publish")} disabled={busy !== null || form.status === "open"}>Publish</Button></div></div>;
}
