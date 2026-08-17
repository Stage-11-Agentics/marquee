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
import { useEffect, useRef, useState } from "preact/hooks";

import { AgentBriefPanel } from "../shell/AgentBrief";
import { errorSummary } from "../shell/api-client";
import { idempotencyKeyForCompose } from "../shell/compose-idempotency";
import { Button } from "../shell/components";
import { attendeeImportBrief, peopleImportBrief } from "./people-brief";
import {
  createList,
  createPerson,
  executePersonMerge,
  fetchPeople,
  fetchPerson,
  importPeople,
  undoImportedPeople,
  previewPersonMerge,
  previewOrgMail,
  sendOrgMail,
  saveControl,
  type PeopleFilters,
  type PeopleImportResult,
  type Person,
  type SavedPersonList,
  type PeopleImportUndoResult,
  type PersonMergeExecuteResult,
  type PersonMergePreview,
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

/**
 * Where an imported file lands.
 *
 * The organization is where a person record lives; it is not where a
 * conference finds its speakers. An import that only wrote the org row
 * reported "3 created" over a roster that had not moved and a CONFS column
 * reading 0 — a success message for a job half done. So the destination is a
 * control the organizer sets, it defaults to the conference they are standing
 * in, and the receipt says which one it wrote.
 */
type ImportDestination = "roster" | "attendees" | "org";

/**
 * What the import did to the conference, in the receipt, or nothing to add.
 *
 * Seated and already-seated are counted apart because they are different acts:
 * only the first wrote a row, and only the first is a row this import's undo
 * will take back.
 */
function importPlacementLine(result: PeopleImportResult, event: { name: string } | null): string {
  if (!event || !result.event) return "";
  const already = result.roster_already_seated > 0 ? ` · ${result.roster_already_seated} already on the roster` : "";
  if (result.roster_placements > 0) return ` · ${result.roster_placements} seated on the ${event.name} roster${already}`;
  if (result.roster_already_seated > 0) return ` · everyone in the file was already on the ${event.name} roster`;
  if (result.attendances > 0) return ` · ${result.attendances} recorded as attending ${event.name}`;
  return "";
}

const IMPORT_DESTINATIONS: Array<[ImportDestination, string]> = [
  ["roster", "Speakers on the roster"],
  ["attendees", "Attendees"],
  ["org", "This organization only"],
];

export function ImportPeopleModal({
  event,
  onClose,
  onImported,
  onUndone,
}: {
  event: { name: string; slug: string } | null;
  onClose: () => void;
  onImported: (result: PeopleImportResult) => void;
  onUndone: (undone: number) => void;
}): JSX.Element {
  const [destination, setDestination] = useState<ImportDestination>(event ? "roster" : "org");
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
      const placed = event && destination !== "org";
      const imported = await importPeople({
        csv: file.text,
        filename: file.name,
        ...(placed ? { event: event.slug } : {}),
        ...(placed && destination === "roster" ? { roster: true } : {}),
      });
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
          ? `${result.created} created · ${result.updated} updated · ${result.skipped} skipped${importPlacementLine(result, event)}. The receipt records overwritten values and remains available until you undo it.`
          : `${undone} ${undone === 1 ? "person was" : "people were"} restored${undoOutcome?.skipped ? ` · ${undoOutcome.skipped} kept` : ""}. The receipt remains available for audit.`}
      </div>
      {undone !== null && undoOutcome?.skipped_rows.length ? <ul class="people-hint people-import-skips">
        {undoOutcome.skipped_rows.map((skip) => <li key={`${skip.target_id}-${skip.reason}`}>{skip.target_id}: {undoSkipCopy(skip)}</li>)}
      </ul> : null}
      <div class="people-hint">Receipt <span class="tabular">{result.import_id}</span></div>
    </div> : <>
      <AgentBriefPanel copy={peopleImportBrief(window.location.origin)} />

      {event ? <label class="people-field">
        <span>Where they land in {event.name}</span>
        <select
          value={destination}
          onChange={(changed) => setDestination((changed.currentTarget as HTMLSelectElement).value as ImportDestination)}
        >
          {IMPORT_DESTINATIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <span class="people-hint">
          {destination === "roster"
            ? `Everyone in the file is seated on the ${event.name} speaker roster, and appears in People CRM. Undo withdraws both.`
            : destination === "attendees"
              ? `Everyone in the file is recorded as attending ${event.name}. They do not join the speaker roster.`
              : `People CRM only — nobody joins ${event.name}.`}
        </span>
      </label> : null}

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
  const composeIdempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);

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
      const idempotencyKey = idempotencyKeyForCompose(
        composeIdempotencyRef,
        JSON.stringify({ personIds, subject, body }),
      );
      onSent(await sendOrgMail({ person_ids: personIds, subject, body }, idempotencyKey));
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

export function PersonMergeModal({
  personIds,
  onClose,
  onMerged,
}: {
  personIds: string[];
  onClose: () => void;
  onMerged: (result: PersonMergeExecuteResult) => void;
}): JSX.Element {
  const [ids, setIds] = useState<string[]>(personIds.filter(Boolean).slice(0, 2));
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<Person[]>([]);
  const [records, setRecords] = useState<Person[]>([]);
  const [preview, setPreview] = useState<PersonMergePreview | null>(null);
  const [survivorId, setSurvivorId] = useState("");
  const [result, setResult] = useState<PersonMergeExecuteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (ids.length === 0) return;
    let live = true;
    Promise.all(ids.map((id) => fetchPerson(id)))
      .then((rows) => { if (live) setRecords(rows.map((row) => row.person)); })
      .catch((caught: unknown) => { if (live) setError(errorSummary(caught)); });
    return () => { live = false; };
  }, [ids.join(",")]);

  useEffect(() => {
    if (ids.length >= 2 || search.trim().length < 2) {
      setCandidates([]);
      return;
    }
    let live = true;
    fetchPeople({ q: search, company: "", title: "", tag: "", listId: "" }, 1, 8)
      .then((payload) => { if (live) setCandidates(payload.data.filter((person) => !ids.includes(person.id))); })
      .catch((caught: unknown) => { if (live) setError(errorSummary(caught)); });
    return () => { live = false; };
  }, [search, ids.join(",")]);

  useEffect(() => {
    if (ids.length !== 2 || busy || result) {
      if (ids.length !== 2) setPreview(null);
      return;
    }
    let live = true;
    setError("");
    const pair = [ids[0]!, ids[1]!] as [string, string];
    previewPersonMerge({
      person_ids: pair,
      ...(survivorId ? { survivor_id: survivorId } : {}),
    })
      .then((payload) => {
        if (!live) return;
        setPreview(payload.preview);
        if (!survivorId) setSurvivorId(payload.preview.default_survivor_id);
      })
      .catch((caught: unknown) => { if (live) setError(errorSummary(caught)); });
    return () => { live = false; };
  }, [ids.join(","), survivorId, result, busy]);

  const addCandidate = (id: string) => {
    if (ids.length >= 2 || ids.includes(id)) return;
    setIds((current) => [...current, id]);
    setSearch("");
    setCandidates([]);
    setSurvivorId("");
  };

  const execute = async () => {
    if (ids.length !== 2 || !survivorId || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await executePersonMerge({ person_ids: [ids[0]!, ids[1]!] as [string, string], survivor_id: survivorId });
      setResult(next);
      onMerged(next);
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setBusy(false);
    }
  };

  const removePerson = (id: string) => {
    if (personIds.length === 1 && id === personIds[0]) return;
    setIds((current) => current.filter((candidate) => candidate !== id));
    setPreview(null);
    setSurvivorId("");
  };
  const personById = new Map(records.map((person) => [person.id, person]));
  const displayPerson = (id: string) => personById.get(id) ?? candidates.find((person) => person.id === id);
  const valueText = (value: unknown): string => {
    if (value === null || value === undefined || value === "") return "Blank";
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  };

  return <Modal
    title="Merge people"
    meta={result ? "Merge receipt recorded — history and Undo remain on the survivor" : "One identity, one history — choose the record that remains"}
    onClose={onClose}
    foot={result
      ? <Button onClick={onClose}>Done</Button>
      : <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || !preview || !survivorId} onClick={() => void execute()}>
          {busy ? "Merging…" : "Merge people"}
        </Button>
      </>}
  >
    {result ? <div class="people-preview" role="status">
      <div class="people-preview-subject">People merged</div>
      <div class="people-preview-body">{result.continuity}</div>
      <div class="people-hint">Receipt <span class="tabular">{result.merge_id}</span> · {result.summary.moved} moved · {result.summary.deduped} deduped · {result.summary.dropped} dropped</div>
      <div class="people-hint">Undo is available from the toast and the survivor activity feed while this receipt is clean.</div>
    </div> : <>
      {ids.length < 2 ? <label class="people-field">
        <span>Find the other person by name, email, or company</span>
        <input autoFocus value={search} onInput={(event) => setSearch((event.currentTarget as HTMLInputElement).value)} />
        {candidates.length > 0 ? <div class="people-preview">
          {candidates.map((candidate) => <button type="button" class="people-rowlink" key={candidate.id} onClick={() => addCandidate(candidate.id)}>
            {candidate.name} · {candidate.email}{candidate.company ? " · " + candidate.company : ""}
          </button>)}
        </div> : null}
      </label> : null}
      <div class="people-preview">
        <div class="people-preview-subject">Selected identities</div>
        {ids.map((id, index) => {
          const person = displayPerson(id);
          return <div class="people-drawer-action-row" key={id}>
            <span><strong>{index === 0 ? "Source" : "Source 2"}</strong> · {person?.name ?? id} · {person?.email ?? "Reading…"}</span>
            {personIds.length !== 1 || id !== personIds[0] ? <Button small onClick={() => removePerson(id)}>Remove</Button> : null}
          </div>;
        })}
      </div>
      {preview ? <>
        <div class="people-preview">
          <div class="people-preview-subject">Choose the survivor</div>
          <div class="people-radio-row">
            {[preview.retired, preview.survivor].map((person) => <label key={person.id}>
              <input type="radio" name="merge-survivor" checked={survivorId === person.id} onChange={() => setSurvivorId(person.id)} />
              Keep {person.name} · {person.email}
            </label>)}
          </div>
          <p class="people-hint">Default: the person with more conference connections. You can override it before writing.</p>
        </div>
        <table class="people-table">
          <thead><tr><th>Identity field</th><th>Survivor</th><th>Retired</th><th>Result</th></tr></thead>
          <tbody>{preview.fields.map((field) => <tr key={field.field}>
            <th scope="row">{field.field}</th>
            <td>{valueText(field.survivor_value)}</td>
            <td>{valueText(field.retired_value)}</td>
            <td class={field.source === "retired" ? "accent" : ""}>{valueText(field.result)}{field.collision ? " · named conflict" : ""}</td>
          </tr>)}</tbody>
        </table>
        <p class="people-hint">{preview.continuity}</p>
        <p class="people-hint tabular">{preview.summary.moved} references move · {preview.summary.deduped} collisions dedupe · {preview.summary.dropped} rows drop · {preview.event_scope.length} conferences touched · receipt id printed after commit</p>
        {preview.collisions.length > 0 ? <ul class="people-hint">
          {preview.collisions.map((collision) => <li key={collision.table + collision.retired_id}>{collision.table} · {collision.reason}</li>)}
        </ul> : null}
        <p class="people-hint">This operation is one durable change and can be undone while the survivor remains clean.</p>
      </> : ids.length === 2 ? <p class="people-state">Comparing the two identities…</p> : null}
    </>}
    {error ? <div class="people-state error" role="alert">{error}</div> : <div />}
  </Modal>;
}
