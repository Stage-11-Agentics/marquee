import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { AgentBriefLauncher } from "../shell/AgentBrief";
import { apiFetch, errorSummary } from "../shell/api-client";
import "./comms.css";

interface Template {
  id: string;
  key: string;
  name: string;
  subject: string;
  body_md: string;
  enabled: number;
  updated_at?: number;
}

interface Message {
  id: string;
  person_id: string | null;
  to_email: string;
  template_key: string;
  subject: string;
  html: string;
  text: string;
  status: string;
  send_policy: string;
  suppressed_reason: string | null;
  created_at: number;
  sent_at: number | null;
}

interface AudienceRow {
  person_id: string;
  submission_id: string;
  email: string;
  name: string;
  role: string;
  submission_title: string;
  format: string | null;
  room: string | null;
  starts_at: number | null;
  task_title: string | null;
  task_due_at: number | null;
}

interface AudienceResult {
  data: AudienceRow[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

interface Preview {
  subject: string;
  html: string;
  text: string;
  to_email: string;
}

interface SendResult {
  selected: number;
  queued: number;
  duplicate: number;
  outbox_ids: string[];
}

interface Filters {
  status: string;
  track: string;
  format: string;
  task_state: "" | "open" | "done";
}

const TRIGGER_KEYS = [
  "submission_confirmation",
  "form_closing_reminder",
  "added_to_submission",
  "acceptance",
  "rejection",
  "task_assigned",
  "task_overdue",
] as const;
const MERGE_FIELDS = [
  "speaker.first_name",
  "submission.title",
  "session.room",
  "session.building",
  "session.address",
  "session.accessNote",
  "session.leaveBy",
  "room.name",
  "session.time",
  "task.title",
] as const;

async function request<T>(path: string, route: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    route,
  });
}

function isTrigger(template: Template): boolean {
  return (TRIGGER_KEYS as readonly string[]).includes(template.key);
}

function selectorFor(filters: Filters): Record<string, string> {
  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.track.trim() ? { track_id: filters.track.trim() } : {}),
    ...(filters.format.trim() ? { format_id: filters.format.trim() } : {}),
    ...(filters.task_state ? { task_state: filters.task_state } : {}),
  };
}

function audiencePath(eventId: string, filters: Filters): string {
  const query = new URLSearchParams({ page: "1", per_page: "100", sort: "name" });
  if (filters.status) query.set("status", filters.status);
  if (filters.track.trim()) query.set("track", filters.track.trim());
  if (filters.format.trim()) query.set("format", filters.format.trim());
  if (filters.task_state) query.set("task_state", filters.task_state);
  return `/api/v1/events/${eventId}/comms/audience?${query.toString()}`;
}

function formatDate(value: number): string {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function CommsScreen({ eventId }: { eventId: string }): JSX.Element {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [audience, setAudience] = useState<AudienceResult>({ data: [], page: 1, per_page: 100, total: 0, total_pages: 0 });
  const [filters, setFilters] = useState<Filters>({ status: "accepted", track: "", format: "", task_state: "" });
  const [selectedKey, setSelectedKey] = useState("reminder_generic");
  const [mode, setMode] = useState<"template" | "adhoc">("template");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  const activeTemplate = useMemo(
    () => templates.find((template) => template.key === selectedKey) ?? null,
    [selectedKey, templates],
  );
  const templateDirty = mode === "template" && activeTemplate !== null
    && (subject !== activeTemplate.subject || body !== activeTemplate.body_md);
  const selectedRecipient = audience.data[0] ?? null;
  const selector = useMemo(() => selectorFor(filters), [filters]);

  useEffect(() => {
    let cancelled = false;
    setTemplatesLoading(true);
    setMessagesLoading(true);
    Promise.all([
      request<{ data: Template[] }>(`/api/v1/events/${eventId}/templates`, "/api/v1/events/{eventId}/templates"),
      request<{ data: Message[] }>(`/api/v1/events/${eventId}/outbox`, "/api/v1/events/{eventId}/outbox"),
    ])
      .then(([templateResult, messageResult]) => {
        if (cancelled) return;
        setTemplates(templateResult.data);
        setMessages(messageResult.data);
        if (!templateResult.data.some((template) => template.key === selectedKey)) {
          setSelectedKey(templateResult.data.find((template) => isTrigger(template))?.key ?? templateResult.data[0]?.key ?? "reminder_generic");
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorSummary(reason));
      })
      .finally(() => {
        if (cancelled) return;
        setTemplatesLoading(false);
        setMessagesLoading(false);
      });
    return () => { cancelled = true; };
  }, [eventId, reloadKey]);

  useEffect(() => {
    if (!activeTemplate) return;
    setSubject(activeTemplate.subject);
    setBody(activeTemplate.body_md);
  }, [activeTemplate]);

  useEffect(() => {
    let cancelled = false;
    setAudienceLoading(true);
    request<AudienceResult>(audiencePath(eventId, filters), "/api/v1/events/{eventId}/comms/audience")
      .then((result) => { if (!cancelled) setAudience(result); })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorSummary(reason));
      })
      .finally(() => { if (!cancelled) setAudienceLoading(false); });
    return () => { cancelled = true; };
  }, [eventId, filters.format, filters.status, filters.task_state, filters.track]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedRecipient || (mode === "template" && !activeTemplate) || !subject.trim() || !body.trim()) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    const previewPayload = mode === "template" && !templateDirty
      ? { person_id: selectedRecipient.person_id, submission_id: selectedRecipient.submission_id, template_key: selectedKey }
      : { person_id: selectedRecipient.person_id, submission_id: selectedRecipient.submission_id, subject, body };
    request<Preview>(`/api/v1/events/${eventId}/comms/preview`, "/api/v1/events/{eventId}/comms/preview", {
      method: "POST",
      body: JSON.stringify(previewPayload),
    })
      .then((result) => { if (!cancelled) setPreview(result); })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(errorSummary(reason));
        }
      })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [activeTemplate, body, eventId, mode, selectedKey, selectedRecipient, subject, templateDirty]);

  async function saveTemplate(): Promise<void> {
    if (!activeTemplate) return;
    setBusy(`save:${activeTemplate.id}`);
    try {
      const saved = await request<Template>(`/api/v1/events/${eventId}/templates/${activeTemplate.id}`, "/api/v1/events/{eventId}/templates/{templateId}", {
        method: "PATCH",
        body: JSON.stringify({ subject, body_md: body }),
      });
      setTemplates((current) => current.map((template) => template.id === activeTemplate.id ? { ...template, ...saved } : template));
      setError(null);
    } catch (reason) {
      setError(errorSummary(reason));
    } finally {
      setBusy(null);
    }
  }

  async function toggleTemplate(template: Template): Promise<void> {
    setBusy(`toggle:${template.id}`);
    try {
      const saved = await request<Template>(`/api/v1/events/${eventId}/templates/${template.id}`, "/api/v1/events/{eventId}/templates/{templateId}", {
        method: "PATCH",
        body: JSON.stringify({ enabled: template.enabled !== 1 }),
      });
      setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, ...saved } : item));
      setError(null);
    } catch (reason) {
      setError(errorSummary(reason));
    } finally {
      setBusy(null);
    }
  }

  async function refreshMessages(): Promise<void> {
    const result = await request<{ data: Message[] }>(`/api/v1/events/${eventId}/outbox`, "/api/v1/events/{eventId}/outbox");
    setMessages(result.data);
  }

  async function queueMessage(): Promise<void> {
    if (!preview || audience.total === 0 || (mode === "template" && (!activeTemplate || activeTemplate.enabled !== 1 || templateDirty)) || !subject.trim() || !body.trim()) return;
    setBusy("send");
    try {
      const payload = mode === "template"
        ? { selector, template_key: selectedKey }
        : { selector, subject, body };
      const result = await request<SendResult>(`/api/v1/events/${eventId}/comms/send`, "/api/v1/events/{eventId}/comms/send", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setSendResult(result);
      await refreshMessages();
      setError(null);
    } catch (reason) {
      setError(errorSummary(reason));
    } finally {
      setBusy(null);
    }
  }

  const canQueue = Boolean(
    preview
      && audience.total > 0
      && subject.trim()
      && body.trim()
      && (mode === "adhoc" || (activeTemplate?.enabled === 1 && !templateDirty)),
  );
  const triggers = templates.filter(isTrigger);

  return <section class="comms-screen" aria-label="Communications">
    <div class="comms-banner">
      <span class="status-dot" aria-hidden="true" />
      <div><strong>Demo-safe outbox</strong><span>Messages render and log here. Non-allowlisted addresses are never delivered.</span></div>
      <span class="comms-policy">default: demo_safe</span>
      <AgentBriefLauncher surface="chase" eventId={eventId} small />
    </div>
    {error && <div class="inline-error" role="alert"><span>{error}</span><button class="button small" type="button" onClick={() => { setError(null); setReloadKey((value) => value + 1); }}>Retry communications</button></div>}

    <section class="comms-section panel" aria-labelledby="comms-templates-heading">
      <div class="section-heading"><div><div class="panel-kicker">Templates</div><h2 id="comms-templates-heading">Conference messages</h2></div><span class="section-count">{templates.length || "—"} available</span></div>
      <div class="template-grid">
        {templates.map((template) => <div class={`template-card${template.key === selectedKey && mode === "template" ? " is-selected" : ""}`} key={template.id}>
          <button class="template-select" type="button" onClick={() => { setMode("template"); setSelectedKey(template.key); }} aria-pressed={template.key === selectedKey && mode === "template"}>
            <strong>{template.name}</strong><span>{template.key}</span>
          </button>
          <label class="toggle-control"><input type="checkbox" checked={template.enabled === 1} disabled={busy !== null} onChange={() => void toggleTemplate(template)} /><span>{template.enabled === 1 ? "on" : "off"}</span></label>
        </div>)}
        {templates.length === 0 && <div class="reserved-copy comms-empty-copy"><span>{templatesLoading ? "Loading the conference template catalog…" : error ? "Templates are unavailable. Retry communications above to try again." : "No conference templates yet. Write a one-off message from Ad-hoc mode."}</span>{!templatesLoading && !error && <button class="button-secondary comms-empty-action" type="button" onClick={() => setMode("adhoc")}>Write an ad-hoc message</button>}</div>}
      </div>
    </section>

    <div class="comms-grid">
      <section class="comms-compose panel" aria-labelledby="comms-compose-heading">
        <div class="panel-kicker">Compose</div>
        <div class="section-heading section-heading-compose"><h2 id="comms-compose-heading">Queue a message</h2><div class="mode-switch" role="group" aria-label="Message type"><button class={mode === "template" ? "is-active" : ""} type="button" onClick={() => setMode("template")}>Template</button><button class={mode === "adhoc" ? "is-active" : ""} type="button" onClick={() => setMode("adhoc")}>Ad-hoc</button></div></div>
        {mode === "template" && activeTemplate?.enabled !== 1 && <div class="inline-warning">This template is off. Turn it on in Templates before queueing.</div>}
        {mode === "template" && templateDirty && <div class="inline-warning">Unsaved edits are preview-only. Save the template before queueing.</div>}
        <label>Subject<input value={subject} onInput={(event) => setSubject((event.currentTarget as HTMLInputElement).value)} placeholder="Message subject" /></label>
        <label>Body<textarea rows={7} value={body} onInput={(event) => setBody((event.currentTarget as HTMLTextAreaElement).value)} placeholder="Write the message body with {{merge.fields}}" /></label>
        <div class="merge-fields" aria-label="Available merge fields"><span>Merge fields</span>{MERGE_FIELDS.map((field) => <code key={field}>{`{{${field}}}`}</code>)}</div>
        {mode === "template" && <button class="button-secondary" type="button" onClick={() => void saveTemplate()} disabled={!activeTemplate || !templateDirty || busy !== null}>{busy?.startsWith("save:") ? "Saving…" : "Save template edits"}</button>}
        <div class="comms-recipient-box" aria-live="polite">
          <div><span class="panel-kicker">Counted selector</span><strong>{audienceLoading ? "…" : audience.total}</strong><span>recipient{audience.total === 1 ? "" : "s"}</span></div>
          <small>{selectedRecipient ? `${selectedRecipient.name} · ${selectedRecipient.submission_title}` : "No matching recipient in this conference."}</small>
        </div>
        {sendResult && <div class="send-result" role="status">Queued {sendResult.queued} · duplicates {sendResult.duplicate} · selected {sendResult.selected}</div>}
        <button class="button-primary" type="button" onClick={() => void queueMessage()} disabled={!canQueue || busy !== null}>{busy === "send" ? "Queueing…" : "Queue message"}</button>
      </section>

      <section class="comms-preview panel" aria-labelledby="comms-preview-heading">
        <div class="panel-kicker">Preview</div>
        <div class="section-heading section-heading-compose"><h2 id="comms-preview-heading">One real recipient</h2><span class="preview-state">{previewLoading ? "rendering…" : preview ? "ready" : "waiting"}</span></div>
        <div class="preview-card">
          <div class="preview-meta">TO · {preview?.to_email ?? selectedRecipient?.email ?? "no recipient selected"}</div>
          <h3>{preview?.subject ?? "Preview reserves this space"}</h3>
          {preview?.html ? <div class="preview-html" dangerouslySetInnerHTML={{ __html: preview.html }} /> : <p class="reserved-copy">{previewError ?? "Choose a filter and a message to render a real recipient preview."}</p>}
        </div>
        <details class="preview-source"><summary>Rendered text</summary><pre>{preview?.text ?? "No rendered text yet."}</pre></details>
        <p class="muted">The preview and queued row use the same server-side merge and HTML rendering contract.</p>
      </section>
    </div>

    <section class="comms-section panel" aria-labelledby="comms-triggers-heading">
      <div class="section-heading"><div><div class="panel-kicker">Triggers</div><h2 id="comms-triggers-heading">Automated schedule</h2></div><span class="section-count">{triggers.filter((template) => template.enabled === 1).length}/{TRIGGER_KEYS.length} enabled</span></div>
      <div class="trigger-grid">{triggers.map((template) => <button class={`trigger-row${template.enabled === 1 ? "" : " is-off"}`} type="button" key={template.id} onClick={() => { setMode("template"); setSelectedKey(template.key); }}><span class="trigger-glyph" aria-hidden="true">{template.enabled === 1 ? "●" : "○"}</span><span><strong>{template.name}</strong><small>{template.key}</small></span><span class="trigger-state">{template.enabled === 1 ? "enabled" : "off"}</span></button>)}</div>
      <div class="schedule-card"><div><span class="panel-kicker">Pre-close cron</span><strong>Hourly · 0 * * * *</strong></div><p>Each open form keeps its own configurable reminder offset. The scheduler only selects eligible recipients; every later send remains in the demo-safe outbox.</p></div>
    </section>

    <section class="comms-section panel" aria-labelledby="comms-filters-heading">
      <div class="section-heading"><div><div class="panel-kicker">Audience</div><h2 id="comms-filters-heading">Filter the conference recipients</h2></div><span class="section-count">Server-side list contract</span></div>
      <div class="filter-grid">
        <label>Status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: (event.currentTarget as HTMLSelectElement).value })}><option value="">Any status</option><option value="submitted">Submitted</option><option value="in_review">In review</option><option value="accepted">Accepted</option><option value="waitlisted">Waitlisted</option><option value="rejected">Rejected</option></select></label>
        <label>Track<input value={filters.track} placeholder="Track ID" onInput={(event) => setFilters({ ...filters, track: (event.currentTarget as HTMLInputElement).value })} /></label>
        <label>Format<input value={filters.format} placeholder="Format ID" onInput={(event) => setFilters({ ...filters, format: (event.currentTarget as HTMLInputElement).value })} /></label>
        <label>Task state<select value={filters.task_state} onChange={(event) => setFilters({ ...filters, task_state: (event.currentTarget as HTMLSelectElement).value as Filters["task_state"] })}><option value="">Any task state</option><option value="open">Open task</option><option value="done">Completed task</option></select></label>
      </div>
      <p class="filter-note">Clearing every filter still resolves through the server; an explicit empty selection remains a deliberate no-op.</p>
    </section>

    <section class="comms-section panel" aria-labelledby="comms-outbox-heading">
      <div class="section-heading"><div><div class="panel-kicker">Outbox</div><h2 id="comms-outbox-heading">Rendered delivery log</h2></div><span class="section-count">{messages.length} message{messages.length === 1 ? "" : "s"}</span></div>
      <div class="message-list">
        {messages.length === 0 && <div class="empty-log comms-empty-copy"><span>{messagesLoading ? "Loading the delivery log…" : error ? "The delivery log is unavailable. Retry communications above to try again." : "No messages queued yet. The first queued message will appear here with its rendered body and honest delivery outcome."}</span>{!messagesLoading && !error && <a class="button-secondary comms-empty-action" href="#comms-compose-heading">Compose the first message</a>}</div>}
        {messages.map((message) => <details class="message-row" key={message.id}>
          <summary><div><strong>{message.subject}</strong><span>{message.to_email} · {message.template_key}{message.person_id ? ` · ${message.person_id}` : ""}</span></div><span class={`message-status status-${message.status}`}>{message.status === "suppressed" ? "held in demo outbox · would send in production" : message.status}</span></summary>
          <div class="message-detail"><p>{message.text}</p><small>{message.send_policy} · queued {formatDate(message.created_at)}{message.suppressed_reason ? ` · ${message.suppressed_reason}` : ""}</small></div>
        </details>)}
      </div>
    </section>
  </section>;
}
