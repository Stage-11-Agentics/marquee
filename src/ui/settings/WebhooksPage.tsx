import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { EmptyState, PageHeader } from "../shell/components";
import "./settings.css";

const EVENT_TYPES = [
  "submission.created",
  "submission.status_changed",
  "evaluation.completed",
  "speaker_task.completed",
  "agenda.published",
  "speaker.confirmed",
] as const;

type WebhookEvent = (typeof EVENT_TYPES)[number];

const EVENT_LABELS: Record<WebhookEvent, string> = {
  "submission.created": "Submission created",
  "submission.status_changed": "Submission status changed",
  "evaluation.completed": "Evaluation completed",
  "speaker_task.completed": "Speaker task completed",
  "agenda.published": "Agenda published",
  "speaker.confirmed": "Speaker confirmed",
};

interface WebhookEndpoint {
  id: string;
  event_id: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  created_at: number;
  last_delivery_at: number | null;
}

interface WebhookDelivery {
  id: string;
  endpoint_id: string;
  event_type: WebhookEvent;
  payload: string;
  status: "queued" | "delivered" | "failed";
  attempts: number;
  response_code: number | null;
  error: string | null;
  created_at: number;
  delivered_at: number | null;
}

interface Props {
  eventId: string;
  navigate: (target: string) => void;
}

type EndpointState =
  | { kind: "loading"; endpoints: WebhookEndpoint[] }
  | { kind: "ready"; endpoints: WebhookEndpoint[] }
  | { kind: "error"; endpoints: WebhookEndpoint[]; message: string };

type DeliveryState =
  | { kind: "loading"; deliveries: WebhookDelivery[] }
  | { kind: "ready"; deliveries: WebhookDelivery[] }
  | { kind: "error"; deliveries: WebhookDelivery[]; message: string };

async function requestJson<T>(path: string, route: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { credentials: "include", ...init, route });
}

function formatDate(value: number | null): string {
  if (value === null) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function WebhookSkeleton(): JSX.Element {
  return <div class="webhook-skeleton" aria-busy="true" aria-label="Loading webhooks">
    <span class="skeleton-line wide" /><span class="skeleton-line" /><span class="skeleton-line" />
  </div>;
}

function EventPicker({
  selected,
  onChange,
}: {
  selected: WebhookEvent[];
  onChange: (event: WebhookEvent, checked: boolean) => void;
}): JSX.Element {
  return <fieldset class="webhook-event-fieldset">
    <legend>Events</legend>
    <div class="webhook-event-grid">
      {EVENT_TYPES.map((event) => <label class="webhook-event-option" key={event}>
        <input
          type="checkbox"
          checked={selected.includes(event)}
          onChange={(change) => onChange(event, change.currentTarget.checked)}
        />
        <span><strong>{EVENT_LABELS[event]}</strong><code>{event}</code></span>
      </label>)}
    </div>
    <small>Choose the event names this endpoint is intended to receive. Automatic event delivery is not wired yet.</small>
  </fieldset>;
}

function EndpointRow({
  endpoint,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: {
  endpoint: WebhookEndpoint;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  return <article class={`webhook-endpoint-row${selected ? " is-selected" : ""}`}>
    <button class="webhook-endpoint-select" type="button" onClick={onSelect} aria-pressed={selected}>
      <span class="webhook-endpoint-heading"><strong>{endpoint.url}</strong><span class={`chip ${endpoint.enabled ? "success" : "warning"}`}>{endpoint.enabled ? "Enabled" : "Paused"}</span></span>
      <span class="webhook-endpoint-events">{endpoint.events.map((event) => <code key={event}>{event}</code>)}</span>
      <span class="webhook-endpoint-meta">Created {formatDate(endpoint.created_at)} · Last delivery {formatDate(endpoint.last_delivery_at)}</span>
    </button>
    <div class="webhook-endpoint-actions">
      <button class="button small" type="button" onClick={onEdit}>Edit</button>
      <button class="button small danger" type="button" onClick={onDelete}>Delete</button>
    </div>
  </article>;
}

function DeliveryStatus({ status }: { status: WebhookDelivery["status"] }): JSX.Element {
  const tone = status === "delivered" ? "success" : status === "failed" ? "alarm" : "warning";
  return <span class={`chip ${tone}`}>{status}</span>;
}

export function WebhooksPage({ eventId, navigate }: Props): JSX.Element {
  const [state, setState] = useState<EndpointState>({ kind: "loading", endpoints: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryState>({ kind: "ready", deliveries: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createUrl, setCreateUrl] = useState("");
  const [createEvents, setCreateEvents] = useState<WebhookEvent[]>([EVENT_TYPES[0]]);
  const [editUrl, setEditUrl] = useState("");
  const [editEvents, setEditEvents] = useState<WebhookEvent[]>([]);
  const [editEnabled, setEditEnabled] = useState(true);
  const [testSecret, setTestSecret] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setState({ kind: "loading", endpoints: [] });
    void requestJson<{ data: WebhookEndpoint[] }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/webhooks`,
      "/api/v1/events/{eventId}/webhooks",
    ).then((response) => {
      if (!active) return;
      setState({ kind: "ready", endpoints: response.data });
      setSelectedId((current) => response.data.some((endpoint) => endpoint.id === current) ? current : response.data[0]?.id ?? null);
    }).catch((reason: unknown) => {
      if (active) setState({ kind: "error", endpoints: [], message: errorSummary(reason) });
    });
    return () => { active = false; };
  }, [eventId, reloadKey]);

  useEffect(() => {
    let active = true;
    if (!selectedId) {
      setDeliveries({ kind: "ready", deliveries: [] });
      return () => { active = false; };
    }
    setDeliveries({ kind: "loading", deliveries: [] });
    void requestJson<{ data: WebhookDelivery[] }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/webhooks/${encodeURIComponent(selectedId)}/deliveries`,
      "/api/v1/events/{eventId}/webhooks/{webhookId}/deliveries",
    ).then((response) => {
      if (active) setDeliveries({ kind: "ready", deliveries: response.data });
    }).catch((reason: unknown) => {
      if (active) setDeliveries({ kind: "error", deliveries: [], message: errorSummary(reason) });
    });
    return () => { active = false; };
  }, [eventId, selectedId, reloadKey]);

  useEffect(() => {
    setTestSecret("");
    setEditingId(null);
  }, [selectedId]);

  const selected = state.kind === "ready"
    ? state.endpoints.find((endpoint) => endpoint.id === selectedId) ?? null
    : null;

  const toggleEvents = (
    current: WebhookEvent[],
    event: WebhookEvent,
    checked: boolean,
    update: (events: WebhookEvent[]) => void,
  ): void => {
    if (!checked && current.length === 1) {
      setError("Keep at least one event selected for an endpoint.");
      return;
    }
    update(checked ? [...current, event] : current.filter((value) => value !== event));
    setError(null);
  };

  const startCreate = (): void => {
    setShowCreate(true);
    setEditingId(null);
    setCreateUrl("");
    setCreateEvents([EVENT_TYPES[0]]);
    setError(null);
  };

  const createEndpoint = async (event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (createEvents.length === 0) {
      setError("Choose at least one event.");
      return;
    }
    setPendingAction("create");
    setError(null);
    setNotice(null);
    try {
      const response = await requestJson<{ data: WebhookEndpoint; secret: string }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/webhooks`,
        "/api/v1/events/{eventId}/webhooks",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: createUrl, events: createEvents, enabled: true }),
        },
      );
      setSecret(response.secret);
      setTestSecret(response.secret);
      setSelectedId(response.data.id);
      setShowCreate(false);
      setNotice("Endpoint created. Copy the signing secret now; Marquee stores only its hash.");
      setReloadKey((value) => value + 1);
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setPendingAction(null);
    }
  };

  const beginEdit = (endpoint: WebhookEndpoint): void => {
    setShowCreate(false);
    setEditingId(endpoint.id);
    setEditUrl(endpoint.url);
    setEditEvents(endpoint.events);
    setEditEnabled(endpoint.enabled);
    setSelectedId(endpoint.id);
    setError(null);
  };

  const updateEndpoint = async (event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selected || !editingId) return;
    setPendingAction(`edit:${editingId}`);
    setError(null);
    setNotice(null);
    try {
      await requestJson(
        `/api/v1/events/${encodeURIComponent(eventId)}/webhooks/${encodeURIComponent(editingId)}`,
        "/api/v1/events/{eventId}/webhooks/{webhookId}",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: editUrl, events: editEvents, enabled: editEnabled }),
        },
      );
      setEditingId(null);
      setNotice("Endpoint updated.");
      setReloadKey((value) => value + 1);
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setPendingAction(null);
    }
  };

  const deleteEndpoint = async (endpoint: WebhookEndpoint): Promise<void> => {
    if (!window.confirm(`Delete ${endpoint.url}? Its delivery history will be removed.`)) return;
    setPendingAction(`delete:${endpoint.id}`);
    setError(null);
    setNotice(null);
    try {
      await requestJson(
        `/api/v1/events/${encodeURIComponent(eventId)}/webhooks/${encodeURIComponent(endpoint.id)}`,
        "/api/v1/events/{eventId}/webhooks/{webhookId}",
        { method: "DELETE" },
      );
      setSelectedId(null);
      setEditingId(null);
      setNotice("Endpoint deleted.");
      setReloadKey((value) => value + 1);
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setPendingAction(null);
    }
  };

  const testEndpoint = async (): Promise<void> => {
    if (!selected) return;
    if (!testSecret.trim()) {
      setError("Paste the signing secret shown when this endpoint was created before sending a test.");
      return;
    }
    setPendingAction(`test:${selected.id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await requestJson<{ data: WebhookDelivery }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/webhooks/${encodeURIComponent(selected.id)}/test`,
        "/api/v1/events/{eventId}/webhooks/{webhookId}/test",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret: testSecret }),
        },
      );
      setNotice(response.data.status === "delivered"
        ? `Signed test delivered with HTTP ${response.data.response_code ?? "—"}.`
        : `Signed test recorded as failed${response.data.response_code === null ? "" : ` with HTTP ${response.data.response_code}`}.`);
      setReloadKey((value) => value + 1);
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setPendingAction(null);
    }
  };

  const copySecret = async (): Promise<void> => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setNotice("Secret copied. Keep it somewhere safe; Marquee will not show it again.");
    } catch {
      setNotice("Copy was unavailable; select the secret manually before dismissing it.");
    }
  };

  const endpointContent = state.kind === "loading"
    ? <WebhookSkeleton />
    : state.kind === "error"
      ? <div class="settings-error" role="alert"><strong>Webhooks unavailable</strong><span>{state.message}</span><button class="button small" type="button" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></div>
      : state.endpoints.length === 0
        ? <EmptyState class="webhook-empty" title="No webhook endpoints yet" copy="Add an HTTPS endpoint to prepare an integration. Marquee stores only a hash of each signing secret, and the secret is shown once." action={<button class="button primary" type="button" onClick={startCreate}>Add webhook endpoint</button>} />
        : <section class="card webhook-list-card"><header class="card-head"><div><h2>Outbound endpoints</h2><p class="subtle">{state.endpoints.length} configured</p></div><span class="chip">Test send only</span></header><div class="card-body webhook-list">{state.endpoints.map((endpoint) => <EndpointRow key={endpoint.id} endpoint={endpoint} selected={endpoint.id === selectedId} onSelect={() => setSelectedId(endpoint.id)} onEdit={() => beginEdit(endpoint)} onDelete={() => void deleteEndpoint(endpoint)} />)}</div></section>;

  return <div class="settings-page webhooks-page">
    <PageHeader
      title="Webhooks"
      copy="Prepare signed outbound integrations for your conference. Test-send proves the signing path; automatic event-triggered delivery is not connected yet."
      actions={<><a class="button ghost" href="/settings" onClick={(event) => { event.preventDefault(); navigate("/settings"); }}>← Conference settings</a><button class="button primary" type="button" onClick={showCreate ? () => setShowCreate(false) : startCreate}>{showCreate ? "Close form" : "Add endpoint"}</button></>}
    />
    <div class="settings-banner webhook-boundary" role="status"><strong>Delivery boundary</strong><span>Test send signs and POSTs one sample payload and records the outcome. The event-triggered dispatcher and WEBHOOK_QUEUE consumer are a follow-up, so selecting events does not claim live delivery.</span></div>
    {notice && <div class="settings-banner" role="status"><span>{notice}</span></div>}
    {error && <div class="settings-error" role="alert"><strong>Action failed</strong><span>{error}</span></div>}
    {secret && <section class="card webhook-secret-card" aria-live="polite"><header class="card-head"><h2>Copy your signing secret</h2><span class="chip warning">Shown once</span></header><div class="card-body"><p class="webhook-secret-warning">This is the only time Marquee will show this secret. Store it before dismissing this panel. Marquee retains only a hash, so you must paste it again to test an older endpoint.</p><code class="token-secret">{secret}</code><div class="token-secret-actions"><button class="button primary" type="button" onClick={() => void copySecret()}>Copy secret</button><button class="button" type="button" onClick={() => { setSecret(null); setTestSecret(""); }}>I saved it</button></div></div></section>}
    {showCreate && <section class="card webhook-create-card"><header class="card-head"><div><h2>New webhook endpoint</h2><p class="subtle">HTTPS is required. The generated secret is shown exactly once.</p></div></header><form class="card-body stack" onSubmit={(event) => void createEndpoint(event)}><label class="field"><span>Endpoint URL</span><input required type="url" inputMode="url" value={createUrl} placeholder="https://hooks.example.com/marquee" onInput={(event) => setCreateUrl(event.currentTarget.value)} /><small>Use an HTTPS URL you control. Redirects are not a signing contract.</small></label><EventPicker selected={createEvents} onChange={(event, checked) => toggleEvents(createEvents, event, checked, setCreateEvents)} /><div class="webhook-form-actions"><button class="button" type="button" onClick={() => setShowCreate(false)}>Cancel</button><button class="button primary" type="submit" disabled={pendingAction === "create"}>{pendingAction === "create" ? "Creating…" : "Create endpoint"}</button></div></form></section>}
    {endpointContent}
    {selected && <>
      <section class="card webhook-detail-card"><header class="card-head"><div><h2>Endpoint details</h2><p class="subtle">{selected.url}</p></div><span class={`chip ${selected.enabled ? "success" : "warning"}`}>{selected.enabled ? "Enabled" : "Paused"}</span></header>{editingId === selected.id ? <form class="card-body stack" onSubmit={(event) => void updateEndpoint(event)}><label class="field"><span>Endpoint URL</span><input required type="url" inputMode="url" value={editUrl} onInput={(event) => setEditUrl(event.currentTarget.value)} /></label><EventPicker selected={editEvents} onChange={(event, checked) => toggleEvents(editEvents, event, checked, setEditEvents)} /><label class="webhook-enabled-option"><input type="checkbox" checked={editEnabled} onChange={(event) => setEditEnabled(event.currentTarget.checked)} /><span>Keep endpoint enabled</span></label><div class="webhook-form-actions"><button class="button" type="button" onClick={() => setEditingId(null)}>Cancel</button><button class="button primary" type="submit" disabled={pendingAction === `edit:${selected.id}`}>{pendingAction === `edit:${selected.id}` ? "Saving…" : "Save endpoint"}</button></div></form> : <div class="card-body"><div class="webhook-detail-grid"><div><span class="eyebrow">Selected events</span><div class="webhook-event-summary">{selected.events.map((event) => <code key={event}>{event}</code>)}</div></div><div><span class="eyebrow">Created</span><strong class="tabular">{formatDate(selected.created_at)}</strong></div><div><span class="eyebrow">Last delivery</span><strong class="tabular">{formatDate(selected.last_delivery_at)}</strong></div></div><div class="webhook-test-panel"><div><span class="eyebrow">Signed test</span><p>Paste the endpoint secret to sign one sample payload. The secret is not stored and cannot be recovered from this screen.</p></div><label class="field"><span>Signing secret</span><input type="password" autoComplete="off" value={testSecret} placeholder="whsec_…" onInput={(event) => setTestSecret(event.currentTarget.value)} /></label><div class="webhook-test-actions"><button class="button" type="button" onClick={() => beginEdit(selected)}>Edit endpoint</button><button class="button primary" type="button" onClick={() => void testEndpoint()} disabled={pendingAction === `test:${selected.id}`}>{pendingAction === `test:${selected.id}` ? "Sending…" : "Send signed test"}</button></div></div></div>}</section>
      <section class="card webhook-delivery-card"><header class="card-head"><div><h2>Delivery log</h2><p class="subtle">The latest 100 test outcomes for this endpoint</p></div><span class="chip">{deliveries.kind === "ready" ? deliveries.deliveries.length : "—"}</span></header>{deliveries.kind === "loading" ? <div class="card-body"><WebhookSkeleton /></div> : deliveries.kind === "error" ? <div class="card-body"><div class="settings-error" role="alert"><strong>Delivery log unavailable</strong><span>{deliveries.message}</span></div></div> : deliveries.deliveries.length === 0 ? <div class="card-body webhook-log-empty"><strong>No deliveries yet</strong><span>Send a signed test to create the first delivery row.</span></div> : <div class="table-scroll"><table class="webhook-delivery-table"><thead><tr><th scope="col">Status</th><th scope="col">Event</th><th scope="col">Response</th><th scope="col">Attempts</th><th scope="col">Created</th><th scope="col">Error</th></tr></thead><tbody>{deliveries.deliveries.map((delivery) => <tr key={delivery.id}><td><DeliveryStatus status={delivery.status} /></td><td><strong>{EVENT_LABELS[delivery.event_type]}</strong><code>{delivery.event_type}</code></td><td class="tabular">{delivery.response_code ?? "—"}</td><td class="tabular">{delivery.attempts}</td><td class="tabular">{formatDate(delivery.created_at)}</td><td>{delivery.error ?? "—"}</td></tr>)}</tbody></table></div>}</section>
    </>}
  </div>;
}
