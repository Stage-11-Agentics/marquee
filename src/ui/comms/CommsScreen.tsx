import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import "./comms.css";

interface Template {
  id: string;
  key: string;
  name: string;
  subject: string;
  body_md: string;
  enabled: number;
}
interface Message {
  id: string;
  person_id: string | null;
  to_email: string;
  template_key: string;
  subject: string;
  text: string;
  status: string;
  send_policy: string;
  suppressed_reason: string | null;
  created_at: number;
  sent_at: number | null;
}

const EVENT_ID = "evt_demo";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Communications request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function CommsScreen({ eventId = EVENT_ID }: { eventId?: string }): JSX.Element {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedKey, setSelectedKey] = useState("reminder_generic");
  const [body, setBody] = useState("Hi {{speaker.first_name}},\n\nA quick reminder about your next conference task.");
  const [subject, setSubject] = useState("A quick Marquee reminder");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getJson<{ data: Template[] }>(`/api/v1/events/${eventId}/templates`),
      getJson<{ data: Message[] }>(`/api/v1/events/${eventId}/outbox`),
    ])
      .then(([templateResult, messageResult]) => {
        if (cancelled) return;
        setTemplates(templateResult.data);
        setMessages(messageResult.data);
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Communications is unavailable"); });
    return () => { cancelled = true; };
  }, [eventId]);

  const activeTemplate = useMemo(() => templates.find((template) => template.key === selectedKey), [selectedKey, templates]);
  const preview = (activeTemplate?.body_md ?? body).replaceAll(/{{\s*speaker\.first_name\s*}}/g, "Maya");

  return <section class="comms-screen" aria-label="Communications">
    <div class="comms-banner">
      <span class="status-dot" aria-hidden="true" />
      <div><strong>Demo-safe outbox</strong><span>Messages render and log here. Non-allowlisted addresses are never delivered.</span></div>
      <span class="comms-policy">default: demo_safe</span>
    </div>
    {error && <div class="inline-error" role="status">{error}</div>}
    <div class="comms-grid">
      <div class="comms-compose panel">
        <div class="panel-kicker">Compose</div>
        <h2>Send a message</h2>
        <label>Template<select value={selectedKey} onChange={(event) => setSelectedKey((event.currentTarget as HTMLSelectElement).value)}>{templates.map((template) => <option value={template.key} key={template.key}>{template.name}{template.enabled ? "" : " · off"}</option>)}{templates.length === 0 && <option value="reminder_generic">Generic reminder</option>}</select></label>
        <label>Subject<input value={activeTemplate?.subject ?? subject} onInput={(event) => setSubject((event.currentTarget as HTMLInputElement).value)} /></label>
        <label>Body<textarea rows={8} value={activeTemplate?.body_md ?? body} onInput={(event) => setBody((event.currentTarget as HTMLTextAreaElement).value)} /></label>
        <div class="recipient-count"><span>Recipients</span><strong>—</strong><small>Choose a filter on the onboarding board before queueing.</small></div>
        <button class="button-primary" type="button" disabled>Queue reminder</button>
      </div>
      <div class="comms-preview panel">
        <div class="panel-kicker">Preview</div>
        <h2>One real recipient</h2>
        <div class="preview-card"><div class="preview-meta">TO · demo recipient</div><h3>{activeTemplate?.subject ?? subject}</h3><p>{preview}</p></div>
        <p class="muted">Merge fields render at enqueue time and remain inspectable in the outbox.</p>
      </div>
    </div>
    <div class="comms-history panel">
      <div class="history-heading"><div><div class="panel-kicker">Message log</div><h2>Rendered outbox</h2></div><span class="history-count">{messages.length} messages</span></div>
      {messages.length === 0 ? <div class="empty-log">No messages yet. The first queued message will appear here with its delivery outcome.</div> : <div class="message-list">{messages.map((message) => <article class="message-row" key={message.id}><div><strong>{message.subject}</strong><span>{message.to_email} · {message.template_key}</span></div><span class={`message-status status-${message.status}`}>{message.status === "suppressed" ? "suppressed · demo mode" : message.status}</span></article>)}</div>}
    </div>
  </section>;
}
