import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, PageHeader } from "../shell/components";
import "./record.css";

const DEFAULT_EVENT_ID = "evt_aie-ny-2026";
const SUBMISSIONS_ROUTE = "/api/v1/events/{eventId}/submissions";

interface Props {
  eventId?: string;
  navigate: (target: string) => void;
}

export function CreateSubmissionPage({ eventId = DEFAULT_EVENT_ID, navigate }: Props): JSX.Element {
  const [kind, setKind] = useState<"abstract" | "session">("session");
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [submitter, setSubmitter] = useState("");
  const [trackIds, setTrackIds] = useState("");
  const [formatId, setFormatId] = useState("");
  const [bypass, setBypass] = useState(true);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");

  const submit = async (event: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState("saving");
    setError("");
    try {
      const record = await apiFetch<{ id: string }>(`/api/v1/events/${encodeURIComponent(eventId)}/submissions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          abstract: abstract.trim() || null,
          submitter_person_id: submitter.trim() || undefined,
          track_ids: trackIds.split(",").map((value) => value.trim()).filter(Boolean),
          format_id: formatId.trim() || undefined,
          bypass_evaluation: kind === "session" ? bypass : false,
        }),
        route: SUBMISSIONS_ROUTE,
      });
      navigate(`/submissions/${record.id}`);
    } catch (caught: unknown) {
      setState("error");
      setError(errorSummary(caught));
    }
  };

  return <div class="submission-record-page">
    <PageHeader title="Create a submission" copy="Add an Abstract or Session directly to the conference program record. Origin is recorded as admin." actions={<Button onClick={() => navigate("/submissions")}>Cancel</Button>} />
    <form onSubmit={submit} class="record-create-form">
      <Card><CardBody><div class="record-form-grid">
        <div class="field"><label for="submission-kind">Type</label><select id="submission-kind" value={kind} onChange={(event) => { const next = event.currentTarget.value as "abstract" | "session"; setKind(next); if (next === "abstract") setBypass(false); }}>{<><option value="session">Session</option><option value="abstract">Abstract</option></>}</select></div>
        <div class="field"><label for="submission-title">Title</label><input id="submission-title" required value={title} onInput={(event) => setTitle(event.currentTarget.value)} placeholder="A clear program title" /></div>
        <div class="field record-form-wide"><label for="submission-abstract">Abstract / description</label><textarea id="submission-abstract" rows={8} value={abstract} onInput={(event) => setAbstract(event.currentTarget.value)} placeholder="What should the program team know?" /></div>
        <div class="field"><label for="submission-submitter">Submitter person ID</label><input id="submission-submitter" value={submitter} onInput={(event) => setSubmitter(event.currentTarget.value)} placeholder="Defaults to the current admin" /><span class="field-note">Use an existing person ID for the speaker of record.</span></div>
        <div class="field"><label for="submission-tracks">Track IDs</label><input id="submission-tracks" value={trackIds} onInput={(event) => setTrackIds(event.currentTarget.value)} placeholder="track_agents, track_evals" /><span class="field-note">Comma-separated carried tracks.</span></div>
        <div class="field"><label for="submission-format">Format ID</label><input id="submission-format" value={formatId} onInput={(event) => setFormatId(event.currentTarget.value)} placeholder="format_talk" /></div>
        {kind === "session" && <label class="record-bypass-toggle"><input type="checkbox" checked={bypass} onChange={(event) => setBypass(event.currentTarget.checked)} /><span><strong>Bypass evaluation</strong><small>Ready for the working agenda after creation.</small></span></label>}
      </div></CardBody></Card>
      <div class="record-form-actions"><span class={`field-error ${state === "error" ? "visible" : ""}`} role="alert">{error || " "}</span><Button variant="primary" type="submit" disabled={state === "saving"}>{state === "saving" ? "Creating…" : "Create record"}</Button></div>
    </form>
  </div>;
}
