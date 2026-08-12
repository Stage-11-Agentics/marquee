import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { PageHeader } from "../shell/components";
import { DEFAULT_EVENT_ID } from "../venues/venue-writer";
import "./settings.css";

const BYTES_PER_MB = 1024 * 1024;
const MAX_FILE_SIZE_MB = 100;
const DEFAULT_FILE_CONFIG: TaskFileConfig = { accept: ["pdf", "pptx", "key"], maxBytes: 25 * BYTES_PER_MB };

const FILE_PRESETS = [
  { id: "slides", label: "Slides (PDF, PPTX, Keynote)", extensions: ["pdf", "pptx", "key"] },
  { id: "documents", label: "Documents", extensions: ["pdf", "doc", "docx", "txt", "rtf"] },
  { id: "images", label: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif"] },
  { id: "video", label: "Video", extensions: ["mp4", "mov", "webm", "m4v"] },
] as const;

interface TaskFileConfig {
  accept: string[];
  maxBytes: number;
}

interface TaskTemplate {
  id: string;
  event_id: string;
  name: string;
  kind: "acknowledge" | "file" | "form";
  description: string;
  position: number;
  file_config: TaskFileConfig | null;
  updated_at: number;
}

type LoadState =
  | { kind: "loading"; templates: TaskTemplate[] }
  | { kind: "ready"; templates: TaskTemplate[] }
  | { kind: "error"; templates: TaskTemplate[]; message: string };

interface Props {
  eventId?: string;
}

async function requestJson<T>(path: string, route: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { credentials: "include", ...init, route });
}

function extensionDraft(value: string): string[] {
  return [...new Set(value
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^\.+/, ""))
    .filter((entry) => /^[a-z0-9](?:[a-z0-9_-]{0,31})$/.test(entry)))];
}

function fileSizeMb(config: TaskFileConfig): number {
  return Math.max(1, Math.round(config.maxBytes / BYTES_PER_MB));
}

function acceptedLabel(accept: readonly string[]): string {
  return accept.map((extension) => `.${extension}`).join(", ");
}

function TaskTemplatesSkeleton(): JSX.Element {
  return <div class="settings-grid settings-skeleton" aria-busy="true" aria-label="Loading task templates">
    <section class="card skeleton-block"><span class="skeleton-line wide" /><span class="skeleton-line" /><span class="skeleton-line" /></section>
    <section class="card skeleton-block"><span class="skeleton-line wide" /><span class="skeleton-line" /><span class="skeleton-line" /></section>
  </div>;
}

function FileTemplateRow({
  template,
  onChange,
}: {
  template: TaskTemplate;
  onChange: (fileConfig: TaskFileConfig | null) => void;
}): JSX.Element {
  const config = template.file_config;
  const custom = useMemo(() => config
    ? config.accept.filter((extension) => !FILE_PRESETS.some((preset) => preset.extensions.includes(extension as never))).join(", ")
    : "", [config]);

  const togglePreset = (extensions: readonly string[]): void => {
    if (!config) return;
    const selected = extensions.every((extension) => config.accept.includes(extension));
    const accept = selected
      ? config.accept.filter((extension) => !extensions.includes(extension))
      : [...new Set([...config.accept, ...extensions])];
    onChange({ ...config, accept });
  };

  return <article class="settings-row task-template-row">
    <div class="settings-row-heading"><strong>{template.name}</strong><span class="subtle">file task</span></div>
    <p class="task-template-description">{template.description || "Speakers complete this task by uploading a file."}</p>
    {config === null
      ? <div class="task-template-unconfigured"><span>No file limit is configured; the system's default upload policy remains in effect.</span><button class="button small" type="button" onClick={() => onChange({ ...DEFAULT_FILE_CONFIG, accept: [...DEFAULT_FILE_CONFIG.accept] })}>Configure file policy</button></div>
      : <div class="task-template-editor">
        <fieldset class="task-template-fieldset">
          <legend>Accepted file types</legend>
          <div class="task-template-preset-grid">
            {FILE_PRESETS.map((preset) => {
              const selected = preset.extensions.every((extension) => config.accept.includes(extension));
              return <button class={`task-template-preset ${selected ? "is-selected" : ""}`} type="button" aria-pressed={selected} key={preset.id} onClick={() => togglePreset(preset.extensions)}><span>{preset.label}</span><small>{selected ? "Included" : "Add set"}</small></button>;
            })}
          </div>
          <label class="field task-template-custom-field"><span>Custom extensions</span><input value={custom} placeholder="csv, zip, or another extension" onInput={(event) => { const next = extensionDraft(event.currentTarget.value); const presetExtensions = FILE_PRESETS.flatMap((preset) => [...preset.extensions]); onChange({ ...config, accept: [...new Set([...config.accept.filter((extension) => presetExtensions.includes(extension)), ...next])] }); }} /><small>Separate extensions with commas. A leading dot is optional.</small></label>
        </fieldset>
        <div class="task-template-limits">
          <label class="field"><span>Maximum file size</span><span class="unit-input"><input type="number" min="1" max={MAX_FILE_SIZE_MB} step="1" value={fileSizeMb(config)} onInput={(event) => { const megabytes = Math.min(MAX_FILE_SIZE_MB, Math.max(1, Number(event.currentTarget.value) || 1)); onChange({ ...config, maxBytes: megabytes * BYTES_PER_MB }); }} /><small>MB</small></span><small>Up to {MAX_FILE_SIZE_MB} MB per file.</small></label>
          <div class="task-template-effective"><span class="eyebrow">Speaker view</span><strong>Accepted: {acceptedLabel(config.accept) || "Choose at least one type"}</strong><small>Speakers see this list and the same size limit in their portal.</small></div>
        </div>
        {config.accept.length === 0 && <p class="task-template-inline-error" role="alert">Choose at least one accepted file type before saving.</p>}
      </div>}
  </article>;
}

export function TaskTemplatesPage({ eventId = DEFAULT_EVENT_ID }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading", templates: [] });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ kind: "loading", templates: [] });
    void requestJson<{ data: TaskTemplate[] }>(`/api/v1/events/${encodeURIComponent(eventId)}/task-templates`, "/api/v1/events/{eventId}/task-templates")
      .then((response) => { if (active) { setState({ kind: "ready", templates: response.data }); setDirty(false); } })
      .catch((error: unknown) => { if (active) setState({ kind: "error", templates: [], message: errorSummary(error) }); });
    return () => { active = false; };
  }, [eventId, reloadKey]);

  const updateTemplate = (templateId: string, fileConfig: TaskFileConfig | null): void => {
    setState((current) => ({ ...current, templates: current.templates.map((template) => template.id === templateId ? { ...template, file_config: fileConfig } : template) }));
    setDirty(true);
    setNotice(null);
    setSaveError(null);
  };

  const save = async (event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (state.templates.some((template) => template.kind === "file" && template.file_config !== null && template.file_config.accept.length === 0)) {
      setSaveError("Choose at least one accepted file type before saving.");
      return;
    }
    setSaving(true);
    setNotice(null);
    setSaveError(null);
    try {
      for (const template of state.templates.filter((candidate) => candidate.kind === "file")) {
        await requestJson(`/api/v1/events/${encodeURIComponent(eventId)}/task-templates/${encodeURIComponent(template.id)}`, "/api/v1/events/{eventId}/task-templates/{templateId}", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file_config: template.file_config }),
        });
      }
      setDirty(false);
      setNotice("File task settings saved");
      setReloadKey((value) => value + 1);
    } catch (error: unknown) {
      setSaveError(errorSummary(error));
    } finally {
      setSaving(false);
    }
  };

  if (state.kind === "loading") {
    return <div class="settings-page"><PageHeader title="Task templates" copy="Choose what speakers must provide and keep each upload policy visible in one place." /><TaskTemplatesSkeleton /></div>;
  }

  const fileTemplates = state.templates.filter((template) => template.kind === "file");
  return <div class="settings-page">
    <PageHeader title="Task templates" copy="Choose the file types and size limits speakers see for each upload task." actions={<span class={`settings-dirty ${dirty ? "is-dirty" : ""}`}>{dirty ? "Unsaved changes" : "All changes saved"}</span>} />
    {state.kind === "error" && <div class="settings-error" role="alert"><strong>Task templates unavailable</strong><span>{state.message}</span><button class="button small" type="button" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></div>}
    {notice && <div class="settings-banner" role="status">{notice}</div>}
    {saveError && <div class="settings-error" role="alert"><strong>Save failed</strong><span>{saveError}</span></div>}
    <form onSubmit={save}>
      <div class="settings-list">
        {fileTemplates.length > 0
          ? fileTemplates.map((template) => <FileTemplateRow key={template.id} template={template} onChange={(fileConfig) => updateTemplate(template.id, fileConfig)} />)
          : <section class="card settings-list-empty"><strong>No file tasks yet</strong><span>Add a file-kind task template to give speakers an upload policy.</span></section>}
      </div>
      <footer class="settings-savebar"><span class="subtle">Changes apply to speaker portals after saving.</span><button class="button primary" type="submit" disabled={!dirty || saving}>{saving ? "Saving…" : dirty ? "Save file task settings" : "File task settings saved"}</button></footer>
    </form>
  </div>;
}
