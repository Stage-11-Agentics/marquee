/**
 * The four things People does to a selection: import, email, save as a List,
 * and add someone by hand.
 *
 * The import panel is instructions-first and then a working drop zone. Both
 * halves hit the same endpoint, which is the point being made: there is no
 * capability on this screen the API lacks, so an organizer can hand the job to
 * an agent or do it themselves and get the same result.
 */
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { AgentBriefPanel } from "../shell/AgentBrief";
import { errorSummary } from "../shell/api-client";
import { Button } from "../shell/components";
import { attendeeImportBrief, peopleImportBrief } from "./people-brief";
import {
  createList,
  createPerson,
  importPeople,
  undoImportedPeople,
  previewOrgMail,
  sendOrgMail,
  saveControl,
  type PeopleFilters,
  type PeopleImportResult,
  type Person,
  type SavedPersonList,
  type PeopleImportUndoResult,
} from "./people-api";

function undoSkipCopy(skip: PeopleImportUndoResult["skipped_rows"][number]): string {
  if (skip.reason === "changed_after_import") {
    return `${skip.fields.join(", ")} kept — changed after the import.`;
  }
  if (skip.reason === "has_references") {
    return `Kept — still referenced by ${skip.references.join(", ")}.`;
  }
  return "Kept — the import receipt has no imported value for this row.";
}

function Modal({
  title,
  meta,
  children,
  foot,
  onClose,
}: {
  title: string;
  meta: string;
  children: JSX.Element | JSX.Element[] | null;
  foot: JSX.Element;
  onClose: () => void;
}): JSX.Element {
  return <>
    <button type="button" class="people-scrim" aria-label="Close" onClick={onClose} />
    <div class="people-modal" role="dialog" aria-label={title}>
      <div class="people-modal-head"><h2>{title}</h2><p>{meta}</p></div>
      <div class="people-modal-body">{children}</div>
      <div class="people-modal-foot">{foot}</div>
    </div>
  </>;
}

export function ImportPeopleModal({
  onClose,
  onImported,
  onUndone,
}: {
  onClose: () => void;
  onImported: (result: PeopleImportResult) => void;
  onUndone: (undone: number) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [result, setResult] = useState<PeopleImportResult | null>(null);
  const [undone, setUndone] = useState<number | null>(null);
  const [undoOutcome, setUndoOutcome] = useState<PeopleImportUndoResult | null>(null);
  const [hot, setHot] = useState(false);

  const read = async (picked: File | undefined) => {
    if (!picked) return;
    setError("");
    setFile({ name: picked.name, text: await picked.text() });
  };

  const run = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const imported = await importPeople({ csv: file.text, filename: file.name });
      setResult(imported);
      onImported(imported);
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!result || undoBusy || undone !== null) return;
    setUndoBusy(true);
    setError("");
    try {
      const outcome = await undoImportedPeople(result.import_id);
      setUndoOutcome(outcome);
      setUndone(outcome.undone);
      onUndone(outcome.undone);
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setUndoBusy(false);
    }
  };

  return <Modal
    title="Import people"
    meta={result ? "Receipt retained — the last import can be undone as one change" : "Matched on email — an existing person is updated, never duplicated"}
    onClose={onClose}
    foot={result ? <>
      <Button onClick={onClose}>Done</Button>
      <Button
        class="people-import-undo"
        variant={undone === null ? "danger" : ""}
        disabled={undoBusy || undone !== null}
        onClick={() => void undo()}
      >{undone === null ? (undoBusy ? "Undoing…" : "Undo import") : "Import undone"}</Button>
    </> : <>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!file || busy} onClick={() => void run()}>
        {busy ? "Importing…" : file ? `Import ${file.name}` : "Choose a file first"}
      </Button>
    </>}
  >
    {result ? <div class="people-preview" role="status">
      <div class="people-preview-subject">{undone === null ? "Import applied" : "Import undone"}</div>
      <div class="people-preview-body">
        {undone === null
          ? `${result.created} created · ${result.updated} updated · ${result.skipped} skipped. The receipt records overwritten values and remains available until you undo it.`
          : `${undone} ${undone === 1 ? "person was" : "people were"} restored${undoOutcome?.skipped ? ` · ${undoOutcome.skipped} kept` : ""}. The receipt remains available for audit.`}
      </div>
      {undone !== null && undoOutcome?.skipped_rows.length ? <ul class="people-hint people-import-skips">
        {undoOutcome.skipped_rows.map((skip) => <li key={`${skip.target_id}-${skip.reason}`}>{skip.target_id}: {undoSkipCopy(skip)}</li>)}
      </ul> : null}
      <div class="people-hint">Receipt <span class="tabular">{result.import_id}</span></div>
    </div> : <>
      <AgentBriefPanel copy={peopleImportBrief(window.location.origin)} />

      <div class="people-field">
        <span>Or just drop a file</span>
        <div
          class={`people-dropzone ${hot ? "hot" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setHot(true); }}
          onDragLeave={() => setHot(false)}
          onDrop={(event) => {
            event.preventDefault();
            setHot(false);
            void read(event.dataTransfer?.files?.[0]);
          }}
        >
          <span class="people-kpi-name">{file ? file.name : "speakers.csv"}</span>
          <div class="people-hint">
            Drop a CSV here, or choose one. Columns are mapped by their headers — the same endpoint your
            agent would call.
          </div>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Choose a CSV of people"
            onChange={(event) => void read((event.currentTarget as HTMLInputElement).files?.[0])}
          />
        </div>
      </div>
    </>}

    {error ? <div class="people-state error" role="alert">{error}</div> : <div />}
  </Modal>;
}

export function ComposeModal({
  people,
  onClose,
  onSent,
}: {
  people: Array<Pick<Person, "id" | "name" | "do_not_contact">>;
  onClose: () => void;
  onSent: (result: { selected: number; queued: number; duplicate: number; excluded_people: string[] }) => void;
}): JSX.Element {
  const personIds = people.map((person) => person.id);
  const excludedPeople = people.filter((person) => person.do_not_contact).map((person) => person.name);
  const eligibleCount = people.length - excludedPeople.length;
  const [subject, setSubject] = useState("Speak at our next conference?");
  const [body, setBody] = useState(
    "Hi {{speaker.first_name}},\n\nWe're building the next program and would like you on it.\n\nWould you submit a talk?\n\n— The program team",
  );
  const [preview, setPreview] = useState<{ to_email: string; subject: string; text: string; excluded_people: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const showPreview = async () => {
    setError("");
    try {
      setPreview(await previewOrgMail({ person_ids: personIds, subject, body }));
    } catch (caught) {
      setError(errorSummary(caught));
    }
  };

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onSent(await sendOrgMail({ person_ids: personIds, subject, body }));
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setBusy(false);
    }
  };

  return <Modal
    title="Email these people"
    meta={`${eligibleCount} recipient${eligibleCount === 1 ? "" : "s"} ready · sends through the outbox and is logged`}
    onClose={onClose}
    foot={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button onClick={() => void showPreview()}>Preview</Button>
      <Button variant="primary" disabled={busy || eligibleCount === 0} onClick={() => void send()}>
        {busy ? "Queueing…" : `Send ${eligibleCount} email${eligibleCount === 1 ? "" : "s"}`}
      </Button>
    </>}
  >
    <>
    {(preview?.excluded_people ?? excludedPeople).length > 0 ? <p class="people-exclusion-notice" role="alert">
      {(preview?.excluded_people ?? excludedPeople).length} excluded — marked do-not-contact: {(preview?.excluded_people ?? excludedPeople).join(", ")}
    </p> : null}
    <label class="people-field">
      <span>Subject</span>
      <input value={subject} onInput={(event) => setSubject((event.currentTarget as HTMLInputElement).value)} />
    </label>
    <label class="people-field">
      <span>Body — merge tags {"{{speaker.first_name}}"} {"{{speaker.name}}"}</span>
      <textarea value={body} onInput={(event) => setBody((event.currentTarget as HTMLTextAreaElement).value)} />
    </label>
    {preview ? <div class="people-field">
      <span>Preview — personalization resolved</span>
      <div class="people-preview">
        <div class="people-preview-to">To: {preview.to_email}</div>
        <div class="people-preview-subject">{preview.subject}</div>
        <div class="people-preview-body">{preview.text}</div>
      </div>
      <p class="people-hint">Merge tags resolve per recipient — this is recipient 1 of {eligibleCount}.</p>
    </div> : <p class="people-hint">Preview renders recipient 1 with their merge tags filled in, exactly as it will send.</p>}
    {error ? <div class="people-state error" role="alert">{error}</div> : <div />}
    </>
  </Modal>;
}

export function SaveListModal({
  selectedIds,
  matching,
  filters,
  onClose,
  onSaved,
}: {
  selectedIds: string[];
  matching: number;
  filters: PeopleFilters;
  onClose: () => void;
  onSaved: (list: SavedPersonList) => void;
}): JSX.Element {
  const control = saveControl(selectedIds.length);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"live" | "fixed">(control.kind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (busy || name.trim().length === 0) return;
    setBusy(true);
    setError("");
    try {
      const { list } = await createList({
        name: name.trim(),
        kind,
        config: {
          q: filters.q.trim(),
          ...(filters.company ? { company: filters.company } : {}),
          ...(filters.title ? { title: filters.title } : {}),
          ...(filters.tag ? { tag: filters.tag } : {}),
        },
        ...(kind === "fixed" ? { person_ids: selectedIds } : {}),
      });
      onSaved(list);
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setBusy(false);
    }
  };

  return <Modal
    title={selectedIds.length > 0 ? "Save selected as a list" : "Save this filter as a list"}
    meta={selectedIds.length > 0
      ? `The ${selectedIds.length} people you ticked`
      : `Everyone matching right now — ${matching.toLocaleString()} people`}
    onClose={onClose}
    foot={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={busy || name.trim().length === 0} onClick={() => void save()}>
        {busy ? "Saving…" : "Save list"}
      </Button>
    </>}
  >
    <label class="people-field">
      <span>Name it the way you would say it</span>
      <input
        value={name}
        placeholder="e.g. Keynote shortlist"
        onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)}
      />
    </label>
    <div class="people-field">
      <span>Keep it up to date?</span>
      <div class="people-radio-row">
        <label>
          <input type="radio" name="people-list-kind" checked={kind === "live"} onChange={() => setKind("live")} />
          Live — anyone who newly matches joins
        </label>
        <label>
          <input
            type="radio"
            name="people-list-kind"
            checked={kind === "fixed"}
            disabled={selectedIds.length === 0}
            onChange={() => setKind("fixed")}
          />
          Fixed — just these {(selectedIds.length || matching).toLocaleString()}
        </label>
      </div>
    </div>
    <p class="people-hint">
      A list is reusable as an email audience and as a pipeline source.{" "}
      {selectedIds.length > 0
        ? "You picked these by hand, so Fixed is the default."
        : "A saved filter is usually meant to stay current, so Live is the default."}
    </p>
    {error ? <div class="people-state error" role="alert">{error}</div> : <div />}
  </Modal>;
}

export function AddPersonModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (person: Person) => void;
}): JSX.Element {
  const [draft, setDraft] = useState({ name: "", email: "", title: "", company: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { person } = await createPerson({
        name: draft.name.trim(),
        email: draft.email.trim(),
        ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
        ...(draft.company.trim() ? { company: draft.company.trim() } : {}),
      });
      onAdded(person);
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof draft, label: string, required = false) => <label class="people-field" key={key}>
    <span>{label}</span>
    <input
      required={required}
      value={draft[key]}
      onInput={(event) => setDraft({ ...draft, [key]: (event.currentTarget as HTMLInputElement).value })}
    />
  </label>;

  return <Modal
    title="Add a person"
    meta="Matched on email — if this address is already here, their record is updated rather than duplicated"
    onClose={onClose}
    foot={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button
        variant="primary"
        disabled={busy || draft.name.trim().length === 0 || !draft.email.includes("@")}
        onClick={() => void save()}
      >{busy ? "Saving…" : "Add person"}</Button>
    </>}
  >
    {field("name", "Name", true)}
    {field("email", "Email", true)}
    {field("title", "Job title")}
    {field("company", "Company")}
    {error ? <div class="people-state error" role="alert">{error}</div> : <div />}
  </Modal>;
}

/**
 * Attendees, brought in by an agent.
 *
 * Deliberately its own door rather than a second panel inside the speaker
 * import: it is a different job — a ticketing export, scoped to one conference,
 * writing attendance rows — and stacking two briefs in one modal would make
 * both of them scenery.
 */
export function ImportAttendeesModal({
  event,
  onClose,
}: {
  event: { name: string; slug: string } | null;
  onClose: () => void;
}): JSX.Element {
  return <Modal
    title="Bring in attendees"
    meta={event
      ? `Attendees of ${event.name} become people in this record — the same table as your speakers`
      : "Attendees become people in this record — the same table as your speakers"}
    onClose={onClose}
    foot={<Button onClick={onClose}>Done</Button>}
  >
    <AgentBriefPanel copy={attendeeImportBrief(window.location.origin, event)} />
    <p class="people-hint">
      No per-platform integrations, and none planned. The rails are a documented endpoint and an
      email-keyed upsert; the bridge from whichever site sold your tickets is a job your agent can
      do in one pass, and re-running it never duplicates anyone. This year's attendee is next
      year's speaker prospect, so they arrive with notes, tags and lists already working.
    </p>
  </Modal>;
}
