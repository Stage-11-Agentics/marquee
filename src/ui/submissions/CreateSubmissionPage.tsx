import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { apiFetch, errorSummary, fieldError, MarqueeApiError } from "../shell/api-client";
import { Button, Card, CardBody, PageHeader } from "../shell/components";
import "./record.css";

const SUBMISSIONS_ROUTE = "/api/v1/events/{eventId}/submissions";
const FORMATS_ROUTE = "/api/v1/events/{eventId}/formats";
const TRACKS_ROUTE = "/api/v1/events/{eventId}/tracks";
const SEARCH_ROUTE = "/api/v1/events/{eventId}/search";

interface Format {
  id: string;
  event_id: string;
  name: string;
}

interface Track {
  id: string;
  event_id: string;
  name: string;
  color: string;
}

interface SettingsModel {
  formats: Format[];
  tracks: Track[];
}

interface SearchResult {
  type: string;
  id: string;
  title: string;
  subtitle: string;
}

type LoadState =
  | { kind: "loading"; model: null }
  | { kind: "ready"; model: SettingsModel }
  | { kind: "error"; model: null; message: string };

interface Props {
  eventId: string;
  navigate: (target: string) => void;
}

function InlineError({ message, id }: { message?: string; id: string }): JSX.Element {
  return <span id={id} class={`create-field-error${message ? " visible" : ""}`} role={message ? "alert" : undefined}>{message || " "}</span>;
}

function CreateSettings({ state }: { state: LoadState }): JSX.Element {
  if (state.kind === "loading") return <div class="record-picker-state" aria-busy="true">Reading conference formats and tracks…</div>;
  if (state.kind === "error") return <div class="record-picker-state error" role="alert">{state.message}</div>;
  return <></>;
}

export function CreateSubmissionPage({ eventId, navigate }: Props): JSX.Element {
  const [settings, setSettings] = useState<LoadState>({ kind: "loading", model: null });
  const [kind, setKind] = useState<"abstract" | "session">("session");
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [selectedSubmitter, setSelectedSubmitter] = useState<SearchResult | null>(null);
  const [submitterMode, setSubmitterMode] = useState<"existing" | "new">("existing");
  const [submitterQuery, setSubmitterQuery] = useState("");
  const [submitterResults, setSubmitterResults] = useState<SearchResult[]>([]);
  const [submitterSearchState, setSubmitterSearchState] = useState<"idle" | "loading" | "error">("idle");
  const [newSubmitterName, setNewSubmitterName] = useState("");
  const [newSubmitterEmail, setNewSubmitterEmail] = useState("");
  const [trackIds, setTrackIds] = useState<string[]>([]);
  const [formatId, setFormatId] = useState("");
  const [bypass, setBypass] = useState(true);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    setSettings({ kind: "loading", model: null });
    const encodedEventId = encodeURIComponent(eventId);
    void Promise.all([
      apiFetch<{ data: Format[] }>(`/api/v1/events/${encodedEventId}/formats`, { signal: controller.signal, credentials: "include", route: FORMATS_ROUTE }),
      apiFetch<{ data: Track[] }>(`/api/v1/events/${encodedEventId}/tracks`, { signal: controller.signal, credentials: "include", route: TRACKS_ROUTE }),
    ]).then(([formats, tracks]) => {
      if (!controller.signal.aborted) setSettings({ kind: "ready", model: { formats: formats.data, tracks: tracks.data } });
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setSettings({ kind: "error", model: null, message: errorSummary(caught) });
    });
    return () => controller.abort();
  }, [eventId]);

  useEffect(() => {
    const query = submitterQuery.trim();
    if (submitterMode !== "existing" || selectedSubmitter || query.length < 2) {
      setSubmitterResults([]);
      setSubmitterSearchState("idle");
      return;
    }
    const controller = new AbortController();
    setSubmitterSearchState("loading");
    const timer = window.setTimeout(() => {
      void apiFetch<{ data: SearchResult[] }>(`/api/v1/events/${encodeURIComponent(eventId)}/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
        credentials: "include",
        route: SEARCH_ROUTE,
      }).then((payload) => {
        if (controller.signal.aborted) return;
        setSubmitterResults(payload.data.filter((result) => result.type === "Speaker"));
        setSubmitterSearchState("idle");
      }).catch((caught: unknown) => {
        if (!controller.signal.aborted) setSubmitterSearchState("error");
      });
    }, 160);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [eventId, selectedSubmitter, submitterMode, submitterQuery]);

  const submit = async (event: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState("saving");
    setError("");
    const nextFieldErrors: Record<string, string> = {};
    if (submitterMode === "existing" && !selectedSubmitter) nextFieldErrors.submitter = "Choose a person from the list, or create a new person.";
    if (submitterMode === "new" && !newSubmitterName.trim()) nextFieldErrors.submitterName = "Enter the submitter's name.";
    if (submitterMode === "new" && !newSubmitterEmail.trim()) nextFieldErrors.submitterEmail = "Enter the submitter's email address.";
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setState("error");
      setError("Choose the submitter before creating the record.");
      return;
    }
    setFieldErrors({});
    try {
      const record = await apiFetch<{ id: string }>(`/api/v1/events/${encodeURIComponent(eventId)}/submissions`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          abstract: abstract.trim() || null,
          ...(submitterMode === "existing"
            ? { submitter_person_id: selectedSubmitter!.id }
            : { submitter: { name: newSubmitterName.trim(), email: newSubmitterEmail.trim() } }),
          track_ids: trackIds,
          format_id: formatId || undefined,
          bypass_evaluation: kind === "session" ? bypass : false,
        }),
        route: SUBMISSIONS_ROUTE,
      });
      navigate(`/submissions/${record.id}`);
    } catch (caught: unknown) {
      const mapped: Record<string, string> = {};
      const assign = (control: string, apiFields: readonly string[]) => {
        const message = fieldError(caught, apiFields);
        if (message) mapped[control] = message;
      };
      assign("title", ["title"]);
      assign("abstract", ["abstract"]);
      assign("submitter", ["person_id", "submitter_person_id", "participants", "submitter"]);
      assign("submitterEmail", ["submitter.email"]);
      assign("tracks", ["track_ids", "primary_track_id"]);
      assign("format", ["format_id"]);
      setFieldErrors(mapped);
      setState("error");
      setError(caught instanceof MarqueeApiError && ["unprocessable", "malformed_request"].includes(caught.code)
        ? `${caught.message} · ref ${caught.reference}`
        : errorSummary(caught));
    }
  };

  const model = settings.kind === "ready" ? settings.model : null;
  const submitterFieldError = fieldErrors.submitter;
  return <div class="submission-record-page">
    <PageHeader title="Create a submission" copy="Add an Abstract or Session directly to the conference program record. Choose the real person and conference options so the record is truthful." />
    <form onSubmit={submit} class="record-create-form">
      <Card><CardBody>
        <CreateSettings state={settings} />
        {model && <div class="record-form-grid">
          <div class="field"><label for="submission-kind">Type</label><select id="submission-kind" value={kind} onChange={(event) => { const next = event.currentTarget.value as "abstract" | "session"; setKind(next); if (next === "abstract") setBypass(false); }}><option value="session">Session</option><option value="abstract">Abstract</option></select></div>
          <div class="field"><label for="submission-title">Title</label><input id="submission-title" required value={title} onInput={(event) => { setTitle(event.currentTarget.value); setFieldErrors((current) => ({ ...current, title: "" })); }} placeholder="A clear program title" aria-describedby="submission-title-error" />{<InlineError id="submission-title-error" message={fieldErrors.title} />}</div>
          <div class="field record-form-wide"><label for="submission-abstract">Abstract / description</label><textarea id="submission-abstract" rows={8} value={abstract} onInput={(event) => { setAbstract(event.currentTarget.value); setFieldErrors((current) => ({ ...current, abstract: "" })); }} placeholder="What should the program team know?" aria-describedby="submission-abstract-error" />{<InlineError id="submission-abstract-error" message={fieldErrors.abstract} />}</div>
          <fieldset class="record-person-picker record-form-wide" aria-describedby="submission-submitter-error">
            <legend>Submitter <span class="required-mark">Required</span></legend>
            <p class="field-note">Search by the person's name. This person is recorded as the submitter and speaker-of-record context for the new submission.</p>
            <div class="record-picker-tabs" role="tablist" aria-label="Submitter choice">
              <button type="button" role="tab" aria-selected={submitterMode === "existing"} class={submitterMode === "existing" ? "active" : ""} onClick={() => { setSubmitterMode("existing"); setFieldErrors((current) => ({ ...current, submitter: "" })); }}>Choose existing person</button>
              <button type="button" role="tab" aria-selected={submitterMode === "new"} class={submitterMode === "new" ? "active" : ""} onClick={() => { setSubmitterMode("new"); setSelectedSubmitter(null); setSubmitterResults([]); setFieldErrors((current) => ({ ...current, submitter: "" })); }}>Create new person</button>
            </div>
            {submitterMode === "existing" && <div class="record-picker-body">
              {selectedSubmitter ? <div class="record-selected-person"><span><strong>{selectedSubmitter.title}</strong><small>{selectedSubmitter.subtitle}</small></span><Button type="button" small onClick={() => { setSelectedSubmitter(null); setSubmitterQuery(""); }}>Change person</Button></div> : <>
                <label class="sr-only" for="submission-submitter-search">Search people</label><input id="submission-submitter-search" value={submitterQuery} onInput={(event) => { setSubmitterQuery(event.currentTarget.value); setSelectedSubmitter(null); setFieldErrors((current) => ({ ...current, submitter: "" })); }} placeholder="Search people by name…" autoComplete="off" aria-controls="submission-submitter-results" />
                <div id="submission-submitter-results" class="record-person-suggestions" role="listbox" aria-label="People search results">
                  {submitterSearchState === "loading" && <span class="record-picker-placeholder">Searching people…</span>}
                  {submitterSearchState === "error" && <span class="record-picker-placeholder error">People search unavailable. Try again.</span>}
                  {submitterSearchState === "idle" && submitterQuery.trim().length < 2 && <span class="record-picker-placeholder">Type at least 2 characters to search.</span>}
                  {submitterSearchState === "idle" && submitterQuery.trim().length >= 2 && submitterResults.length === 0 && <span class="record-picker-placeholder">No matching people. Create a new person if this is a new contact.</span>}
                  {submitterResults.map((person) => <button type="button" role="option" class="record-person-suggestion" key={person.id} onClick={() => { setSelectedSubmitter(person); setSubmitterQuery(person.title); setSubmitterResults([]); setFieldErrors((current) => ({ ...current, submitter: "" })); }}><strong>{person.title}</strong><small>{person.subtitle}</small></button>)}
                </div>
              </>}
            </div>}
            {submitterMode === "new" && <div class="record-new-person-grid">
              <label class="field"><span>Name</span><input required value={newSubmitterName} onInput={(event) => { setNewSubmitterName(event.currentTarget.value); setFieldErrors((current) => ({ ...current, submitterName: "" })); }} placeholder="Full name" aria-describedby="submission-submitter-name-error" />{<InlineError id="submission-submitter-name-error" message={fieldErrors.submitterName} />}</label>
              <label class="field"><span>Email</span><input required type="email" value={newSubmitterEmail} onInput={(event) => { setNewSubmitterEmail(event.currentTarget.value); setFieldErrors((current) => ({ ...current, submitterEmail: "" })); }} placeholder="name@example.com" aria-describedby="submission-submitter-email-error" />{<InlineError id="submission-submitter-email-error" message={fieldErrors.submitterEmail} />}</label>
            </div>}
            <InlineError id="submission-submitter-error" message={submitterFieldError} />
          </fieldset>
          <div class="field"><label for="submission-tracks">Tracks</label><select id="submission-tracks" multiple size={Math.min(Math.max(model.tracks.length, 3), 7)} onChange={(event) => { setTrackIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value)); setFieldErrors((current) => ({ ...current, tracks: "" })); }} aria-describedby="submission-tracks-error">{model.tracks.map((track) => <option value={track.id} key={track.id} selected={trackIds.includes(track.id)}>{track.name}</option>)}</select><span class="field-note">Optional · hold ⌘ or Ctrl to choose more than one.</span><InlineError id="submission-tracks-error" message={fieldErrors.tracks} /></div>
          <div class="field"><label for="submission-format">Format</label><select id="submission-format" value={formatId} onChange={(event) => { setFormatId(event.currentTarget.value); setFieldErrors((current) => ({ ...current, format: "" })); }} aria-describedby="submission-format-error"><option value="">No format selected</option>{model.formats.map((format) => <option value={format.id} key={format.id}>{format.name}</option>)}</select><span class="field-note">Live from Conference settings · Formats.</span><InlineError id="submission-format-error" message={fieldErrors.format} /></div>
          {kind === "session" && <label class="record-bypass-toggle"><input type="checkbox" checked={bypass} onChange={(event) => setBypass(event.currentTarget.checked)} /><span><strong>Bypass evaluation</strong><small>Ready for the working agenda after creation.</small></span></label>}
        </div>}
      </CardBody></Card>
      <div class="record-form-actions"><span class={`field-error ${state === "error" ? "visible" : ""}`} role="alert">{error || " "}</span><Button type="button" onClick={() => navigate("/submissions")} disabled={state === "saving"}>Cancel</Button><Button variant="primary" type="submit" disabled={state === "saving" || !model}>{state === "saving" ? "Creating…" : "Create record"}</Button></div>
    </form>
  </div>;
}
