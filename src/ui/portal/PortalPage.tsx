/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { PUBLIC_DRAFT_RESUME_EMAIL_SUBJECT } from "../../lib/auth/draft-resume-copy";
import { portalStatusProjection, type PortalStatusTone } from "../../lib/portal-status";
import { participationRoleLabel } from "../shell/identity-format";
import { seedId } from "../../lib/ids";
import type { VenueBuildingInput } from "../../lib/venues";
import { MAP_HEIGHT, VenueMap } from "../venues/VenueMap";
import { FileComments } from "./FileComments";
import {
  CancelledTaskRow,
  GenericTaskSurface,
  requestJson,
  TaskRow,
  uploadFile,
  type ApiFailure,
  type PortalTask,
} from "./task-machinery";
import { SocialBadges, SocialMark } from "../social/SocialBadges";
import { composeSocialLinks, normalizeHandle, socialPlatform, splitSocialLinks, SOCIAL_PLATFORM_IDS, type SocialPlatformId } from "../../lib/social-links";
import "./portal.css";

// These are deterministic seed IDs, not new task kinds. The template identity
// lets the two subject-bearing acknowledgement tasks opt into their subject
// surface while every other acknowledgement keeps the generic checkbox.
const FINALIZE_TALK_TEMPLATE_ID = seedId("tpl", "finalize-talk-description");
const FINALIZE_BIO_TEMPLATE_ID = seedId("tpl", "finalize-bio-and-photos");
type SubjectTaskKind = "talk" | "profile";

function subjectTaskKind(task: PortalTask): SubjectTaskKind | null {
  if (task.kind !== "acknowledge") return null;
  if (task.template_id === FINALIZE_TALK_TEMPLATE_ID && task.submission_id !== null) return "talk";
  if (task.template_id === FINALIZE_BIO_TEMPLATE_ID) return "profile";
  return null;
}

type PortalSubmission = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  status_label: string;
  status_tone?: PortalStatusTone;
  format: string;
  wave: string | null;
  wave_decision_on: string | null;
  slot: {
    day: string;
    date: string;
    time: string;
    starts_at: number;
    duration_min: number | null;
    room: string;
    location: {
      room: string | null;
      building: string | null;
      address: string | null;
      access_note: string | null;
      access_minutes: number;
      lat: number | null;
      lng: number | null;
    };
    show_building_comparison: boolean;
    arrival: {
      status: "ready" | "unscheduled" | "unassigned" | "unavailable";
      origin: { id: string; name: string; address: string } | null;
      previous_session: { id: string; room: string | null; building: string | null; starts_at: number | null; duration_min: number | null } | null;
      walk_minutes: number | null;
      access_minutes: number;
      leave_by: number | null;
    } | null;
    is_published: boolean;
  } | null;
  decision_feedback: { id: string | null; markdown: string; decided_at: number | null } | null;
  co_presenters: Array<{ id: string; name: string; role: string }>;
  participations: Array<{
    id: string;
    role: string;
    confirmation_status: "pending" | "confirmed" | "declined";
    confirmed_at: number | null;
  }>;
  talk_editable: boolean;
  public_link?: string | null;
  history?: Array<{
    id: string;
    actor_name: string | null;
    created_at: number;
    before: { title?: string; description?: string | null } | null;
    after: { title?: string; description?: string | null } | null;
  }>;
};

type PortalPerson = {
  id: string;
  name: string;
  email: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  social_links: string[];
  headshot_attachment_id: string | null;
  updated_at: number;
};

type PortalSnapshot = {
  seat: "speaker";
  event: { id: string; name: string; slug: string; timezone: string; status: string; social_platforms?: SocialPlatformId[] };
  venue: { pinned_building_count: number };
  person: PortalPerson;
  submissions: PortalSubmission[];
  tasks: PortalTask[];
  handbook: { markdown: string };
};

type SubmitterSubmission = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  format: string | null;
  submitted_at: number | null;
  updated_at: number;
  wave_name: string | null;
  wave_decision_on: string | null;
  role: string;
  form_slug: string | null;
  edit?: { enabled: boolean; reason: string | null };
};

/**
 * The seat of someone who submitted an abstract and holds no speaker role — the
 * person the public CFP creates. SPEC §10 keeps the submitter and the speaker
 * distinct on purpose, so this surface carries their submissions and nothing a
 * speaker seat owns: no tasks, no handbook, no schedule.
 */
type SubmitterSnapshot = {
  seat: "submitter";
  event: { id: string; name: string; slug: string; timezone: string; status: string };
  available_events: Array<{ id: string; name: string }>;
  person: { id: string; name: string; email: string };
  submissions: SubmitterSubmission[];
};

type AnyPortalSnapshot = PortalSnapshot | SubmitterSnapshot;

/**
 * The way back out of an organizer preview.
 *
 * A browser holds one session cookie, so opening a speaker's portal necessarily
 * unseats the organizer from every tab they had open. Their own session is not
 * revoked, only displaced, and this hands it back. Without a control here the
 * preview is a one-way door: the organizer reaches the portal — the thing the
 * button promised — and then has to sign in again to get back to their roster.
 */
function ViewingAsBanner(): JSX.Element {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leave = async () => {
    setLeaving(true);
    setError(null);
    try {
      await requestJson("/api/v1/auth/exit-preview", { method: "POST", body: "{}" });
      window.location.assign("/roster");
    } catch {
      // Their own session can expire while they look around. Say so, rather
      // than leaving a button that silently does nothing.
      setLeaving(false);
      setError("Your organizer session has ended. Sign in again to return to the roster.");
    }
  };
  return <div class="portal-viewing-as" role="status">
    <span>Viewing as speaker · organizer preview</span>
    {/* Fixed width so the label swap cannot move the banner's contents. */}
    <button type="button" class="portal-viewing-as-exit" disabled={leaving} onClick={() => void leave()}>
      {leaving ? "Returning…" : "Return to your seat"}
    </button>
    <span class="portal-viewing-as-note">{error ?? ""}</span>
  </div>;
}

function headshotUrl(eventId: string, personId: string, attachmentId: string | null): string | null {
  if (!attachmentId) return null;
  const event = encodeURIComponent(eventId);
  const person = encodeURIComponent(personId);
  // The query only busts the browser cache after a replacement. The server
  // authorizes against the people pointer, never against this client value.
  return `/api/v1/events/${event}/people/${person}/headshot?v=${encodeURIComponent(attachmentId)}`;
}

const AVATAR_PIXELS: Record<"regular" | "compact" | "large", number> = { regular: 64, compact: 44, large: 96 };

/**
 * The placeholder a speaker sees when no headshot is on file. It is a silhouette
 * rather than initials on purpose: initials look like a finished avatar, and the
 * one thing this state has to say is that a photo is missing and only they can
 * supply it.
 */
function HeadshotSilhouette(): JSX.Element {
  return <svg class="portal-avatar-silhouette" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <circle cx="24" cy="17.5" r="8.5" />
    <path d="M7.5 44.5c0-9.1 7.4-16.5 16.5-16.5s16.5 7.4 16.5 16.5" />
  </svg>;
}

function HeadshotAvatar({ eventId, person, size = "regular" }: { eventId: string; person: Pick<PortalPerson, "id" | "name" | "headshot_attachment_id">; size?: "regular" | "compact" | "large" }): JSX.Element {
  const src = headshotUrl(eventId, person.id, person.headshot_attachment_id);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const shown = Boolean(src) && !failed;
  const pixels = AVATAR_PIXELS[size];
  return <div class={`portal-avatar portal-avatar-${size}${shown ? " has-photo" : " is-missing"}`} aria-label={shown ? `${person.name} headshot` : `${person.name} has no headshot on file`} role="img">
    {shown ? <img src={src!} alt={`${person.name} headshot`} width={pixels} height={pixels} onError={() => setFailed(true)} /> : <HeadshotSilhouette />}
  </div>;
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatDay(value: string): string {
  return value || "—";
}

function formatPortalTime(value: number | null, timezone: string): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}

/** The stage credit, in the organizer's words — shared with every other surface. */
function roleLabel(value: string): string {
  return participationRoleLabel(value);
}

function markdownInline(text: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push(<span key={`text-${cursor}`}>{text.slice(cursor, match.index)}</span>);
    parts.push(<a key={`link-${match.index}`} href={match[2]} target="_blank" rel="noreferrer">{match[1]}</a>);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push(<span key={`text-${cursor}`}>{text.slice(cursor)}</span>);
  return parts;
}

function Markdown({ markdown }: { markdown: string }): JSX.Element {
  const blocks: JSX.Element[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(<ul key={`list-${blocks.length}`}>{list.map((item, index) => <li key={`${index}-${item}`}>{markdownInline(item)}</li>)}</ul>);
    list = [];
  };
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (line.startsWith("- ")) {
      list.push(line.slice(2));
      return;
    }
    flushList();
    if (line.startsWith("## ")) blocks.push(<h2 key={index}>{markdownInline(line.slice(3))}</h2>);
    else if (line.startsWith("### ")) blocks.push(<h3 key={index}>{markdownInline(line.slice(4))}</h3>);
    else if (line.trim()) blocks.push(<p key={index}>{markdownInline(line)}</p>);
  });
  flushList();
  return <div class="portal-markdown">{blocks}</div>;
}

type TaskSurfaceProps = {
  eventId: string;
  task: PortalTask;
  submission: PortalSubmission | null;
  person: PortalPerson;
  onComplete: () => Promise<void>;
};

export function TaskSurface({ eventId, task, submission, person, onComplete }: TaskSurfaceProps): JSX.Element {
  const subject = subjectTaskKind(task);
  if (subject === "talk" && submission) return <TalkTaskSurface task={task} submission={submission} onComplete={onComplete} />;
  if (subject === "profile" && person) return <ProfileTaskSurface eventId={eventId} task={task} person={person} onComplete={onComplete} />;
  return <GenericTaskSurface task={task} onComplete={onComplete} />;
}

function TalkEditor({ submission, onSaved, compact = false }: { submission: PortalSubmission; onSaved: () => Promise<void>; compact?: boolean }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(submission.title);
  const [description, setDescription] = useState(submission.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(submission.title);
    setDescription(submission.description ?? "");
    if (!submission.talk_editable) setEditing(false);
  }, [submission.id, submission.title, submission.description, submission.talk_editable]);

  const save = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/v1/me/submissions/${submission.id}/talk`, {
        method: "PATCH",
        body: JSON.stringify({ title, description }),
      });
      setEditing(false);
      await onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <div class={`portal-talk-editor${compact ? " portal-talk-editor-compact" : ""}`}>
    <div class="portal-payload-actions"><h3 title={submission.title}>{submission.title}</h3><button class="portal-task-action" type="button" disabled={!submission.talk_editable} onClick={() => setEditing((current) => !current)}>{!submission.talk_editable ? "Closed" : editing ? "Close" : "Edit talk"}</button></div>
    {editing ? <form onSubmit={save}>
      <div class="portal-field"><label for={`${compact ? "task-" : ""}talk-title-${submission.id}`}>Talk title</label><input id={`${compact ? "task-" : ""}talk-title-${submission.id}`} value={title} onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)} /></div>
      <div class="portal-field"><label for={`${compact ? "task-" : ""}talk-description-${submission.id}`}>Description</label><textarea id={`${compact ? "task-" : ""}talk-description-${submission.id}`} value={description} onInput={(event) => setDescription((event.currentTarget as HTMLTextAreaElement).value)} /></div>
      <div class="portal-payload-actions"><span class="portal-payload-error">{error ?? "Editing closes when the conference call for proposals closes."}</span><button class="portal-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save talk"}</button></div>
    </form> : <><p class="portal-talk-description">{submission.description || "—"}</p>{!submission.talk_editable ? <p class="portal-subject-note">Talk editing is closed because the conference call for proposals is closed.</p> : null}</>}
  </div>;
}

function TalkTaskSurface({ task, submission, onComplete }: { task: PortalTask; submission: PortalSubmission; onComplete: () => Promise<void> }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(task.payload.acknowledged === true);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/v1/me/tasks/${task.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ acknowledged }),
      });
      await onComplete();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <div class="portal-subject-task portal-talk-task">
    <TalkEditor submission={submission} onSaved={onComplete} compact />
    <form class="portal-subject-confirm" onSubmit={submit}>
      <label class="portal-check"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged((event.currentTarget as HTMLInputElement).checked)} /> <span>I have reviewed this talk title and abstract.</span></label>
      <div class="portal-payload-actions"><span class="portal-payload-error">{error ?? ""}</span><button class="portal-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Confirm abstract"}</button></div>
    </form>
  </div>;
}

/**
 * A speaker's handle on one platform. The prefix is fixed chrome rather than
 * placeholder text, so what the speaker types is a handle and what the record
 * stores is a canonical URL — and pasting a whole profile link still works,
 * because that is what people actually do.
 */
function SocialHandleField({ platformId, value, error, onChange }: { platformId: SocialPlatformId; value: string; error: string | null; onChange: (value: string) => void }): JSX.Element | null {
  const platform = socialPlatform(platformId);
  if (!platform) return null;
  const id = `profile-social-${platform.id}`;
  return <div class="social-field">
    <label for={id}><SocialMark platform={platform} />{platform.label}{platform.alsoKnownAs ? ` (${platform.alsoKnownAs})` : ""}</label>
    <div class="social-field-input">
      <span class="social-field-prefix" aria-hidden="true">{platform.inputPrefix}</span>
      <input id={id} type="text" autocomplete="off" spellcheck={false} placeholder={platform.placeholder} value={value} aria-invalid={error ? "true" : undefined} aria-describedby={`${id}-note`} onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)} />
    </div>
    <small id={`${id}-note`} class="social-field-error" aria-live="polite">{error ?? ""}</small>
  </div>;
}

function initialSocialDraft(links: readonly string[]): { handles: Record<string, string>; other: string } {
  const { profiles, other } = splitSocialLinks(links);
  return {
    handles: Object.fromEntries(profiles.map(({ platform, handle }) => [platform.id, handle])),
    other: other.join("\n"),
  };
}

export function ProfileForm({ eventId, person, platforms, onSaved, compact = false }: { eventId: string; person: PortalPerson; platforms: SocialPlatformId[]; onSaved: (person: PortalPerson) => Promise<void>; compact?: boolean }): JSX.Element {
  const [draft, setDraft] = useState({ title: person.title ?? "", company: person.company ?? "", bio: person.bio ?? "", ...initialSocialDraft(person.social_links) });
  const [socialErrors, setSocialErrors] = useState<Record<string, string>>({});
  const [headshot, setHeadshot] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headshotInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    setDraft({ title: person.title ?? "", company: person.company ?? "", bio: person.bio ?? "", ...initialSocialDraft(person.social_links) });
    setSocialErrors({});
    setHeadshot(null);
    setPreview(null);
  }, [person.id, person.title, person.company, person.bio, person.social_links.join("\n"), person.headshot_attachment_id]);

  const chooseHeadshot = (event: JSX.TargetedEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    if (!file) return;
    if (!/[.](?:jpe?g|png|webp)$/i.test(file.name)) { setError("Choose a JPEG, PNG, or WebP headshot."); return; }
    const url = URL.createObjectURL(file);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(url);
    setHeadshot(file);
    setError(null);
  };

  const save = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let headshotAttachmentId = person.headshot_attachment_id;
      if (headshot) {
        const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
          image.onerror = () => reject(new Error("The headshot preview could not be read."));
          image.src = preview ?? "";
        });
        if (dimensions.width < 256 || dimensions.height < 256) throw new Error("Headshots must be at least 256 × 256 pixels.");
        headshotAttachmentId = await uploadFile(headshot, "person_headshot", person.id);
      }
      let body: Record<string, unknown>;
      if (compact) {
        body = { bio: draft.bio || null, headshot_attachment_id: headshotAttachmentId };
      } else {
        // Handles are read as generously as possible, but a handle we cannot
        // read is never silently dropped: the speaker is told which one and why.
        const handles = new Map<SocialPlatformId, string>();
        const errors: Record<string, string> = {};
        for (const id of SOCIAL_PLATFORM_IDS) {
          const platform = socialPlatform(id);
          if (!platform) continue;
          const stored = draft.handles[id] ?? "";
          // A platform the conference stopped asking about still has a field's
          // worth of the speaker's data behind it. It is carried through
          // untouched rather than validated against a form nobody rendered —
          // and never dropped, which is what turning a setting off would
          // otherwise quietly do to someone else's profile.
          if (!platforms.includes(id)) {
            if (stored) handles.set(id, stored);
            continue;
          }
          const result = normalizeHandle(platform, stored);
          if (result.error) errors[id] = result.error;
          else if (result.handle) handles.set(id, result.handle);
        }
        setSocialErrors(errors);
        if (Object.keys(errors).length > 0) throw new Error("Check the social profiles marked below.");
        const other = draft.other.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
        body = { title: draft.title || null, company: draft.company || null, bio: draft.bio || null, social_links: composeSocialLinks(handles, other), headshot_attachment_id: headshotAttachmentId };
      }
      const response = await requestJson<{ person: PortalPerson }>("/api/v1/me/profile", { method: "PATCH", body: JSON.stringify(body) });
      setHeadshot(null);
      setPreview(null);
      await onSaved(response.person);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const bioId = compact ? `task-profile-bio-${person.id}` : "profile-bio";
  const headshotId = compact ? `task-profile-headshot-${person.id}` : "profile-headshot";
  return <form class={`portal-profile${compact ? " portal-profile-compact" : ""}`} onSubmit={save}>
    {/* What the conference will publish, drawn by the same component the public
        page uses — so the speaker approves the badges they will actually get. */}
    {!compact ? <div class="portal-avatar-line"><HeadshotAvatar eventId={eventId} person={person} /><div class="portal-avatar-copy"><strong title={person.name}>{person.name}</strong><span>{person.email}</span><SocialBadges links={person.social_links} ownerName={person.name} size="compact" /></div></div> : null}
    <div class="portal-profile-grid">
      {!compact ? <><div class="portal-field"><label for="profile-title">Title</label><input id="profile-title" value={draft.title} onInput={(event) => setDraft({ ...draft, title: (event.currentTarget as HTMLInputElement).value })} /></div><div class="portal-field"><label for="profile-company">Company</label><input id="profile-company" value={draft.company} onInput={(event) => setDraft({ ...draft, company: (event.currentTarget as HTMLInputElement).value })} /></div></> : null}
      <div class="portal-field full"><label for={bioId}>Bio</label><textarea id={bioId} value={draft.bio} onInput={(event) => setDraft({ ...draft, bio: (event.currentTarget as HTMLTextAreaElement).value })} /></div>
      {!compact ? <div class="portal-field full portal-social-field">
        <label>Social profiles</label>
        {/* The conference chooses which platforms it asks for. Links a speaker
            already gave on a platform it no longer asks about are still kept
            and still shown — the setting governs the question, not the record. */}
        <div class="social-fields">
          {platforms.map((id) => <SocialHandleField key={id} platformId={id} value={draft.handles[id] ?? ""} error={socialErrors[id] ?? null} onChange={(value) => { setDraft({ ...draft, handles: { ...draft.handles, [id]: value } }); if (socialErrors[id]) setSocialErrors({ ...socialErrors, [id]: "" }); }} />)}
          {platforms.length === 0
            ? <p class="portal-subject-note">This conference does not collect speaker social profiles.</p>
            : <p class="social-fields-note">Leave any blank you would rather not share. Pasting the full profile link works too.</p>}
        </div>
        {draft.other.trim() !== "" ? <div class="portal-field portal-other-links"><label for="profile-other-links">Other links</label><textarea id="profile-other-links" value={draft.other} onInput={(event) => setDraft({ ...draft, other: (event.currentTarget as HTMLTextAreaElement).value })} /><small class="portal-crop-note">One link per line. These were on your record already and are kept as they are.</small></div> : null}
      </div> : null}
      <div class="portal-field full portal-headshot-field">
        <label for={headshotId}>Headshot</label>
        {/* A missing headshot is the gap speakers most often leave behind, and
            the only one nobody else can fill for them. It gets a picture of its
            own absence and a named button rather than a bare file input. */}
        <div class={`portal-headshot-control${preview ? " is-staged" : person.headshot_attachment_id ? " has-photo" : " is-missing"}`}>
          <div class="portal-headshot-frame">
            {preview
              ? <img src={preview} alt="Headshot preview" />
              : <HeadshotAvatar eventId={eventId} person={person} size="large" />}
          </div>
          <div class="portal-headshot-copy">
            <strong>{preview ? "New photo ready — save to keep it" : person.headshot_attachment_id ? "A headshot is on file" : "No headshot yet"}</strong>
            <p>{preview
              ? "This is the crop the conference will publish."
              : person.headshot_attachment_id
                ? "This photo appears in the speaker gallery and on your session page."
                : "The conference publishes a photo beside your name. Only you can add it."}</p>
            <input ref={headshotInput} id={headshotId} class="portal-visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseHeadshot} />
            <button class={`portal-button${person.headshot_attachment_id || preview ? " secondary" : ""}`} type="button" onClick={() => headshotInput.current?.click()}>{person.headshot_attachment_id || preview ? "Choose a different photo" : "Choose your headshot"}</button>
            <small class="portal-crop-note">JPEG, PNG, or WebP · minimum 256 × 256 pixels.</small>
          </div>
        </div>
      </div>
    </div>
    <div class="portal-payload-actions"><span class="portal-payload-error" aria-live="polite">{error ?? ""}</span><button class="portal-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button></div>
  </form>;
}

function ProfileTaskSurface({ eventId, task, person, onComplete }: { eventId: string; task: PortalTask; person: PortalPerson; onComplete: () => Promise<void> }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(task.payload.acknowledged === true);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/v1/me/tasks/${task.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ acknowledged }),
      });
      await onComplete();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <div class="portal-subject-task portal-profile-task">
    <div class="portal-subject-card">
      <div class="portal-subject-head"><div class="portal-subject-title"><HeadshotAvatar eventId={eventId} person={person} size="compact" /><div><span class="portal-subject-kicker">Speaker profile</span><h3>Bio and headshot</h3></div></div><button class="portal-task-action" type="button" onClick={() => setEditing((current) => !current)}>{editing ? "Close" : "Edit bio & photos"}</button></div>
      <p class="portal-talk-description">{person.bio || "No bio added yet."}</p>
      <SocialBadges links={person.social_links} ownerName={person.name} size="compact" />
      <p class={`portal-subject-note${person.headshot_attachment_id ? "" : " needs-action"}`}>{person.headshot_attachment_id ? "A headshot is on file for the speaker gallery." : "No headshot yet — the gallery will publish your name without a photo until you add one."}</p>
    </div>
    {editing ? <div class="portal-subject-editor"><ProfileForm eventId={eventId} compact person={person} platforms={[]} onSaved={async () => { setEditing(false); await onComplete(); }} /></div> : null}
    <form class="portal-subject-confirm" onSubmit={submit}>
      <label class="portal-check"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged((event.currentTarget as HTMLInputElement).checked)} /> <span>I have reviewed my speaker bio and headshot.</span></label>
      <div class="portal-payload-actions"><span class="portal-payload-error">{error ?? ""}</span><button class="portal-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Confirm profile"}</button></div>
    </form>
  </div>;
}

function TasksPanel({ eventId, tasks, submissions, person, onRefresh }: { eventId: string; tasks: PortalTask[]; submissions: PortalSubmission[]; person: PortalPerson; onRefresh: () => Promise<void> }): JSX.Element {
  const activeTasks = tasks.filter((task) => task.cancelled_at === null);
  const cancelledTasks = tasks.filter((task) => task.cancelled_at !== null);
  const complete = activeTasks.length > 0 && activeTasks.every((task) => task.status === "done");
  const cancelledSets = [...cancelledTasks.reduce((groups, task) => {
    const key = task.submission_id ?? "unassigned";
    const current = groups.get(key) ?? { key, title: task.submission_title ?? "Cancelled talk", reason: task.cancelled_reason ?? "This work is no longer needed by the conference.", tasks: [] as PortalTask[] };
    current.tasks.push(task);
    groups.set(key, current);
    return groups;
  }, new Map<string, { key: string; title: string; reason: string; tasks: PortalTask[] }>()).values()];
  const doneCount = activeTasks.filter((task) => task.status === "done").length;
  const openCount = activeTasks.length - doneCount;
  return <section class="portal-panel" aria-labelledby="tasks-heading"><header class="portal-panel-head"><h2 id="tasks-heading">Your tasks</h2><div class="portal-panel-meta">{openCount > 0 ? <span class="portal-panel-flag needs-action">{openCount} need{openCount === 1 ? "s" : ""} action</span> : null}<span>{doneCount}/{activeTasks.length} complete</span></div></header><div class="portal-panel-body"><div class="portal-task-list">{activeTasks.length === 0 ? <div class="portal-empty">No tasks are assigned to you right now.</div> : activeTasks.map((task) => <TaskRow
                key={task.id}
                task={task}
                renderSurface={(current) => <TaskSurface eventId={eventId} task={current} submission={current.submission_id ? submissions.find((item) => item.id === current.submission_id) ?? null : null} person={person} onComplete={onRefresh} />}
                renderPayloadExtras={(current) => current.kind === "file" ? <FileComments taskId={current.id} attachmentId={current.payload.attachment_id ?? null} /> : null}
              />)}</div>{complete ? <p class="portal-empty">All speaker tasks are complete. Nothing is waiting on you.</p> : null}{cancelledTasks.length > 0 ? <div class="portal-cancelled-task-list" data-cancelled-task-count={cancelledTasks.length}><div class="portal-cancelled-divider"><span>Cancelled · {cancelledTasks.length}</span></div>{cancelledSets.map((group) => <section class="portal-cancelled-set" key={group.key}><div class="portal-cancelled-set-head"><strong>{group.title}</strong><p>{group.reason}</p></div><div class="portal-task-list">{group.tasks.map((task) => <CancelledTaskRow key={task.id} task={task} />)}</div></section>)}</div> : null}</div></section>;
}

function ProfileEditor({ eventId, person, platforms, onSaved }: { eventId: string; person: PortalPerson; platforms: SocialPlatformId[]; onSaved: () => Promise<void> }): JSX.Element {
  // The profile is the one panel whose gaps are invisible from the task list —
  // nothing chases a missing headshot — so the panel head carries the flag.
  const missing = [person.headshot_attachment_id ? null : "headshot", person.bio?.trim() ? null : "bio"].filter((item): item is string => item !== null);
  return <section class="portal-panel" aria-labelledby="profile-heading"><header class="portal-panel-head"><h2 id="profile-heading">Your profile</h2><div class="portal-panel-meta">{missing.length > 0 ? <span class="portal-panel-flag needs-action">{missing.join(" and ")} needed</span> : <span>public speaker record</span>}</div></header><div class="portal-panel-body"><ProfileForm eventId={eventId} person={person} platforms={platforms} onSaved={onSaved} /></div></section>;
}

function AnnounceYourTalk({ event, submissions }: { event: PortalSnapshot["event"]; submissions: PortalSubmission[] }): JSX.Element | null {
  const accepted = submissions.filter((submission) => submission.status === "accepted");
  const link = accepted.map((submission) => submission.public_link).find((value): value is string => Boolean(value)) ?? null;
  const talkTitle = accepted[0]?.title ?? "your talk";
  const post = link
    ? `I’m speaking at ${event.name} about “${talkTitle}”. See the public program: ${link}`
    : `I’m speaking at ${event.name} about “${talkTitle}”. My public speaker page will be ready when the schedule is published.`;
  const [copied, setCopied] = useState(false);
  const copyPost = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(post);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  if (accepted.length === 0) return null;
  return <section class="portal-panel portal-announce" aria-labelledby="announce-heading">
    <header class="portal-panel-head"><h2 id="announce-heading">Announce your talk</h2><span>{link ? "public link live" : "awaiting publish"}</span></header>
    <div class="portal-panel-body">
      <p class="portal-announce-copy">{post}</p>
      <p class="portal-announce-note">Paste your speaker link into a post or message and it will unfurl with the conference share card.</p>
      <div class="portal-announce-link-row">
        {link ? <a class="portal-announce-link" href={link}>{link}</a> : <span class="portal-announce-link disabled">Your link goes live when the organizer publishes the schedule</span>}
        <div class="portal-announce-actions">
          <button class="portal-button" type="button" disabled={!link} onClick={() => void copyPost()}>{copied ? "Copied" : "Copy the post"}</button>
          {link ? <a class="portal-button secondary" href={link}>View page</a> : null}
        </div>
      </div>
    </div>
  </section>;
}

function TalkCard({ submission, onSaved }: { submission: PortalSubmission; onSaved: () => Promise<void> }): JSX.Element {
  /* A speaker should be able to confirm from their own portal that the people
     sharing their session are on the record — and see it when nobody is. */
  return <article class="portal-talk"><TalkEditor submission={submission} onSaved={onSaved} /><div class="portal-copresenters"><span class="portal-copresenters-label">On this session with you</span>{submission.co_presenters.length === 0 ? <span class="portal-copresenters-empty">Nobody else is on this record. Ask the conference team to add a co-speaker.</span> : <ul>{submission.co_presenters.map((person) => <li key={`${person.id}-${person.role}`}><strong>{person.name}</strong><span>{roleLabel(person.role)}</span></li>)}</ul>}</div>{submission.history && submission.history.length > 0 ? <div class="portal-history" aria-label="Talk edit history">{submission.history.map((item) => <div class="portal-history-item" key={item.id}><strong>{item.actor_name ?? "Conference team"}</strong> · {formatDate(item.created_at)} · updated title or description</div>)}</div> : null}</article>;
}

function ParticipationActions({ submission, onRefresh }: { submission: PortalSubmission; onRefresh: () => Promise<void> }): JSX.Element {
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const respond = async (participationId: string, response: "confirm" | "decline") => {
    setBusyId(participationId);
    setError(null);
    try {
      await requestJson(`/api/v1/me/participations/${encodeURIComponent(participationId)}/${response}`, {
        method: "POST",
        ...(response === "decline" ? { body: JSON.stringify({ note: note.trim() || null }) } : {}),
      });
      setDecliningId(null);
      setNote("");
      await onRefresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusyId(null);
    }
  };
  const isAccepted = submission.status === "accepted";
  return <div class="portal-role-responses" aria-label="Role responses">
    <div class="portal-role-responses-head"><span>Role response</span><small>{isAccepted ? "Each role is confirmed separately" : "Available after acceptance"}</small></div>
    {submission.participations.map((participation) => {
      const isDeclining = decliningId === participation.id;
      const isBusy = busyId === participation.id;
      const statusText = participation.confirmation_status === "confirmed" ? "Role confirmed ✓" : participation.confirmation_status === "declined" ? "Role declined" : "Response needed";
      return <div class="portal-role-response" key={participation.id}>
        <div class="portal-role-copy"><strong>{roleLabel(participation.role)}</strong><span>{statusText}</span></div>
        <div class="portal-role-actions">
          {participation.confirmation_status !== "pending" ? <span class={`portal-role-status ${participation.confirmation_status}`}>{statusText}</span> : isAccepted && !isDeclining ? <><button class="portal-button" type="button" disabled={Boolean(busyId)} onClick={() => void respond(participation.id, "confirm")}>{isBusy ? "Saving…" : "Confirm role"}</button><button class="portal-role-decline" type="button" disabled={Boolean(busyId)} onClick={() => { setDecliningId(participation.id); setNote(""); setError(null); }}>Decline</button></> : isAccepted ? <div class="portal-decline-panel"><label for={`decline-note-${participation.id}`}>Optional note to the program team</label><textarea id={`decline-note-${participation.id}`} value={note} onInput={(event) => setNote((event.currentTarget as HTMLTextAreaElement).value)} placeholder="Add context for the conference team" /><div class="portal-role-action-buttons"><button class="portal-button" type="button" disabled={isBusy} onClick={() => void respond(participation.id, "decline")}>{isBusy ? "Saving…" : "Confirm decline"}</button><button class="portal-role-cancel" type="button" disabled={isBusy} onClick={() => { setDecliningId(null); setNote(""); }}>Cancel</button></div></div> : <span class="portal-role-pending">Waiting for the conference decision</span>}
        </div>
      </div>;
    })}
    <div class="portal-role-error" aria-live="polite">{error ?? ""}</div>
  </div>;
}

function arrivalVenueBuilding(slot: NonNullable<PortalSubmission["slot"]>): VenueBuildingInput {
  const { location } = slot;
  const name = location.building?.trim() || location.address?.trim() || "The conference team has not named this building.";
  return {
    id: `portal-arrival-${slot.starts_at}`,
    name,
    address: location.address?.trim() ?? "",
    position: 0,
    lat: location.lat,
    lng: location.lng,
    access_minutes: location.access_minutes,
    access_note: location.access_note,
  };
}

function ArrivalMap({ slot }: { slot: NonNullable<PortalSubmission["slot"]> }): JSX.Element {
  const { location } = slot;
  const lat = location.lat;
  const lng = location.lng;
  const hasPin = lat !== null && lng !== null;
  const mapHeight = `${MAP_HEIGHT}px`;
  const mapStyle = { height: mapHeight, minHeight: mapHeight };
  if (!hasPin) return <div class="portal-arrival-map empty" role="group" aria-label="Venue map unavailable" style={mapStyle}><span>The conference team has not pinned this building.</span></div>;
  const directions = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const building = arrivalVenueBuilding(slot);
  const venueLabel = building.name;
  return <div class="portal-arrival-map" role="group" aria-label={`Venue map for ${venueLabel}`} style={mapStyle}>
    <VenueMap ariaLabel={`Map of ${venueLabel}`} buildings={[building]} />
    <a class="portal-button portal-arrival-map-directions" href={directions} target="_blank" rel="noreferrer">Directions ↗</a>
  </div>;
}

function ArrivalCard({ slot, timezone }: { slot: NonNullable<PortalSubmission["slot"]>; timezone: string }): JSX.Element {
  const { location, arrival } = slot;
  const showBuildingComparison = slot.show_building_comparison;
  let arrivalCopy = "Arrival timing will appear when this session is placed.";
  if (arrival?.status === "ready" && arrival.leave_by !== null) {
    const movement = [
      showBuildingComparison && arrival.walk_minutes !== null ? `${arrival.walk_minutes} min walk` : null,
      arrival.access_minutes > 0 ? `${arrival.access_minutes} min to get in` : null,
    ].filter(Boolean).join(" · ");
    const from = showBuildingComparison ? arrival.previous_session?.building ?? arrival.origin?.name : null;
    arrivalCopy = showBuildingComparison
      ? `${from ? `From ${from}${movement ? ` · ${movement}` : ""}. ` : ""}Leave by ${formatPortalTime(arrival.leave_by, timezone)}.`
      : `${arrival.access_minutes > 0 ? `Allow ${arrival.access_minutes} min to get in. ` : ""}Leave by ${formatPortalTime(arrival.leave_by, timezone)}.`;
  } else if (arrival?.status === "unavailable") {
    arrivalCopy = "Arrival timing is not available until this building and your starting building have map pins.";
  } else if (arrival?.status === "unassigned") {
    arrivalCopy = "Your room is scheduled, but its building has not been assigned yet.";
  } else if (arrival?.status === "unscheduled") {
    arrivalCopy = "Your arrival instructions will appear when the session time is set.";
  }
  return <section class="portal-arrival-card" aria-labelledby={`arrival-heading-${slot.starts_at}`}>
    <header class="portal-arrival-head"><div><h2 id={`arrival-heading-${slot.starts_at}`}>Where you are speaking</h2><span>{slot.day} · {slot.date} · {slot.time}</span></div></header>
    <div class="portal-arrival-body"><dl class="portal-arrival-details">
      <div><dt>Room</dt><dd>{location.room ?? "—"}</dd></div>
      <div><dt>Building</dt><dd>{location.building ?? "No building assigned yet"}</dd></div>
      <div><dt>Address</dt><dd>{location.address ?? "—"}</dd></div>
      <div><dt>Getting in</dt><dd>{location.access_note ?? "—"}</dd></div>
      <div><dt>Entry time</dt><dd>{location.access_minutes > 0 ? `${location.access_minutes} min` : "No additional time recorded"}</dd></div>
      <div class="portal-arrival-leave"><dt>Arrival plan</dt><dd>{arrivalCopy}</dd></div>
    </dl><ArrivalMap slot={slot} /></div>
  </section>;
}

function StatusHero({ submission, index, timezone, onRefresh }: { submission: PortalSubmission; index: number; timezone: string; onRefresh: () => Promise<void> }): JSX.Element {
  const statusText = `${submission.status_label}${submission.wave ? ` · ${submission.wave}` : ""}`;
  const titleId = `portal-status-heading-${submission.id}`;
  return <section class={`portal-status-hero ${index > 0 ? "secondary" : ""}`} data-status-tone={submission.status_tone ?? ""} aria-labelledby={titleId}><span class="eyebrow">{index === 0 ? "Current status" : "Submission status"}</span>{index === 0 ? <h1 id={titleId}>{statusText}</h1> : <h2 id={titleId}>{statusText}</h2>}<div class="portal-status-meta"><div class="portal-status-copy"><strong title={submission.title}>{submission.title}</strong><br />{submission.format} · {submission.wave_decision_on ? `next decision ${submission.wave_decision_on}` : "status is current"}</div>{submission.slot ? <div class="portal-slot"><small>Schedule</small><span>{formatDay(submission.slot.day)} · {submission.slot.date} · {submission.slot.time}</span><span>{submission.slot.room}</span>{!submission.slot.is_published ? <span class="portal-slot-note">Not yet public</span> : null}</div> : <div class="portal-slot"><small>Schedule</small><span>—</span></div>}</div>{submission.slot ? <ArrivalCard slot={submission.slot} timezone={timezone} /> : null}<ParticipationActions submission={submission} onRefresh={onRefresh} /></section>;
}

/** A `YYYY-MM-DD` decision date, read as a calendar day rather than an instant. */
function formatCalendarDay(value: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return value;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))));
}

/** What is true of this abstract right now, said the way its author would say it. */
function submitterHeadline(status: string): string {
  if (status === "draft") return "Your draft is saved, not yet submitted";
  if (status === "accepted") return "Your abstract was accepted";
  if (status === "waitlisted") return "Your abstract is a Maybe";
  if (status === "rejected") return "Your abstract was not selected";
  if (status === "withdrawn") return "You withdrew this abstract";
  if (status === "in_review") return "Your abstract is under review";
  return "Your abstract is in";
}

function submitterStatusLabel(status: string): string {
  return portalStatusProjection("speaker", status).label;
}

function isSubmitterAwaitingReview(status: string): boolean {
  return status === "submitted" || status === "in_review";
}

function submitterOutcomeCopy(status: string): string {
  if (status === "accepted") return "The program team accepted this abstract for the conference.";
  if (status === "waitlisted") return "The program team marked this abstract as Maybe.";
  if (status === "rejected") return "The program team did not select this abstract for the conference.";
  if (status === "withdrawn") return "This abstract is no longer in consideration.";
  return "The program team has not shared a more specific update for this abstract yet.";
}

function submitterOutcomeDetail(status: string): string {
  if (status === "accepted") return "The program team accepted this abstract for the conference.";
  if (status === "rejected") return "The program team has finished reviewing this abstract.";
  if (status === "withdrawn") return "You withdrew this abstract. No further review will happen.";
  return submitterOutcomeCopy(status);
}

function submitterProgressCopy(status: string, draftCallOpen: boolean): string {
  if (status === "draft") return draftCallOpen ? "Finish and submit your abstract" : "Draft saved · call closed";
  if (status === "waitlisted") return "Maybe · still in consideration";
  if (isSubmitterAwaitingReview(status)) return "Nothing is waiting on you";
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return "Not selected";
  if (status === "withdrawn") return "Withdrawn";
  return "Status current";
}

function SubmissionRow({ submission }: { submission: SubmitterSubmission }): JSX.Element {
  const [title, setTitle] = useState(submission.title);
  const [description, setDescription] = useState(submission.description ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edit = submission.edit ?? { enabled: false, reason: "Editing availability is not available for this abstract." };
  const decisionDetails = isSubmitterAwaitingReview(submission.status)
    ? [
      submission.wave_name,
      submission.wave_decision_on ? `decision by ${formatCalendarDay(submission.wave_decision_on)}` : null,
    ].filter((value): value is string => Boolean(value)).join(" · ")
    : null;
  const decisionLabel = decisionDetails ? `Next decision · ${decisionDetails}` : null;
  useEffect(() => {
    setTitle(submission.title);
    setDescription(submission.description ?? "");
    if (!edit.enabled) setEditing(false);
  }, [submission.id, submission.title, submission.description, edit.enabled]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await requestJson<{ submission: { title: string; abstract?: string | null; description?: string | null } }>(`/api/v1/me/submissions/${encodeURIComponent(submission.id)}/talk`, {
        method: "PATCH",
        body: JSON.stringify({ title, description }),
      });
      setTitle(response.submission.title);
      setDescription(response.submission.description ?? response.submission.abstract ?? "");
      setEditing(false);
    } catch (caught) {
      setError((caught as ApiFailure).message || "The conference could not save this abstract. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return <article class="portal-submitted-row" data-submission-id={submission.id} data-submission-status={submission.status}>
    <div class="portal-submitted-copy">
      <strong title={title}>{title}</strong>
      <span>{submission.format ?? "Format not set"} · {submission.submitted_at === null ? "Not yet submitted" : `Submitted ${formatDate(submission.submitted_at)}`}</span>
      {decisionLabel ? <span class="portal-submitted-wave">{decisionLabel}</span> : null}
      <p class="portal-submitted-abstract">{description || "No abstract text recorded."}</p>
      <form class={`portal-submitter-editor${editing ? "" : " is-hidden"}`} aria-hidden={!editing} onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label><span>Title</span><input disabled={!editing || busy} value={title} onInput={(event) => setTitle(event.currentTarget.value)} /></label>
        <label><span>Abstract</span><textarea disabled={!editing || busy} rows={6} value={description} onInput={(event) => setDescription(event.currentTarget.value)} /></label>
        <div class="portal-submitter-editor-actions"><span class="portal-submitter-edit-error" role={error ? "alert" : undefined}>{error ?? " "}</span><button class="portal-button secondary" type="button" disabled={!editing || busy} onClick={() => setEditing(false)}>Cancel</button><button class="portal-button" type="submit" disabled={!editing || busy}>{busy ? "Saving…" : "Save changes"}</button></div>
      </form>
    </div>
    <div class="portal-submitted-actions"><span class="portal-submitted-status">{submitterStatusLabel(submission.status)}</span><button class="portal-task-action" type="button" disabled={!edit.enabled || busy} aria-describedby={`submitter-edit-reason-${submission.id}`} onClick={() => { setError(null); setEditing((current) => !current); }}>{editing ? "Close editor" : "Edit abstract"}</button><span class="portal-submitter-edit-reason" id={`submitter-edit-reason-${submission.id}`}>{edit.reason ?? "You can edit this abstract while the call for speakers is open."}</span></div>
  </article>;
}

/**
 * The portal a submitter sees. It exists because the public CFP's confirmation
 * page invites them here, and a person who has just handed over their work
 * deserves an answer rather than an error. Every claim on it is one the record
 * can support: what they sent, where it stands, and what to do next when a
 * draft still needs work.
 */
function SubmitterPortal({ snapshot, onSignOut, viewingAsSpeaker = false }: { snapshot: SubmitterSnapshot; onSignOut: () => void; viewingAsSpeaker?: boolean }): JSX.Element {
  // The resolver only returns this seat through a participation on a
  // submission. Keep that invariant explicit: the hero and its date always
  // describe the same lead abstract.
  const lead = snapshot.submissions[0]!;
  const decisionOn = lead.wave_decision_on;
  const waveName = lead.wave_name;
  const isDraft = lead.status === "draft";
  const draftCallOpen = isDraft && Boolean(lead.form_slug);
  const isWaitlisted = lead.status === "waitlisted";
  const isAwaitingReview = isSubmitterAwaitingReview(lead.status);
  const decisionCopy = decisionOn
    ? `Decisions for ${waveName ?? "this round"} go out by ${formatCalendarDay(decisionOn)}.`
    : "The program team has not set a decision date for this round yet.";
  // Only offered while the call is genuinely still open; the server sends null otherwise.
  const openForm = snapshot.submissions
    .filter((submission) => submission.status !== "draft")
    .map((submission) => submission.form_slug)
    .find((value): value is string => Boolean(value)) ?? null;
  const conferenceLinks = snapshot.available_events.map((event) => (
    <a
      class="portal-button secondary"
      href={`/portal?eventId=${encodeURIComponent(event.id)}`}
      aria-current={event.id === snapshot.event.id ? "page" : undefined}
    >
      {event.name}
    </a>
  ));
  const heroCopy = isDraft
    ? "This abstract is saved as a draft, not yet submitted."
    : isWaitlisted
      ? "The program team marked this abstract as Maybe. It is still in consideration."
      : isAwaitingReview
      ? decisionCopy
      : submitterOutcomeCopy(lead.status);
  const progressCopy = submitterProgressCopy(lead.status, draftCallOpen);
  return <div class="portal-shell portal-submitter-seat">
    <header class="portal-top">
      <span class="portal-brand">Marquee · Your submission</span>
      <button type="button" onClick={onSignOut}>Sign out</button>
    </header>
    <main class="portal-main">
      {viewingAsSpeaker ? <ViewingAsBanner /> : null}
      <section class="portal-status-hero" aria-labelledby="portal-status-heading" data-portal-seat="submitter">
        <span class="eyebrow">Current status</span>
        <h1 id="portal-status-heading">{submitterHeadline(lead.status)}</h1>
        <div class="portal-status-meta">
          <div class="portal-status-copy">
            <strong title={lead.title}>{lead.title}</strong><br />
            {snapshot.event.name} · {heroCopy}
          </div>
        </div>
      </section>
      <div class="portal-welcome">
        <div>
          <h2>Thank you, {snapshot.person.name}</h2>
          <p>{snapshot.event.name} · {snapshot.submissions.length} abstract{snapshot.submissions.length === 1 ? "" : "s"} on file</p>
        </div>
        <div class="portal-progress portal-progress-text">{progressCopy}</div>
      </div>
      <div class="portal-grid">
        {isDraft ? <section class="portal-panel portal-submitter-flow" aria-labelledby="next-heading">
          <header class="portal-panel-head"><h2 id="next-heading">Your next step</h2><span>{draftCallOpen ? "action needed" : "call closed"}</span></header>
          <div class="portal-panel-body">
            <div class="portal-submitter-action"><strong>{draftCallOpen ? "Finish and submit your abstract." : "Keep your draft link."}</strong><p>{draftCallOpen
              ? <>If you saved this draft through the public call, the email titled “{PUBLIC_DRAFT_RESUME_EMAIL_SUBJECT}” includes a link that reopens it. You can finish and submit while the call is open.</>
              : <>The call for speakers is closed. If you saved this draft through the public call, keep the email titled “{PUBLIC_DRAFT_RESUME_EMAIL_SUBJECT}” — its link will reopen the draft if the call opens again.</>}</p></div>
          </div>
        </section> : isWaitlisted ? <section class="portal-panel portal-submitter-flow" aria-labelledby="maybe-heading">
          <header class="portal-panel-head"><h2 id="maybe-heading">What happens next</h2><span>Maybe status</span></header>
          <div class="portal-panel-body"><p class="portal-submitter-status-note">This abstract remains in consideration. Any further update will appear here.</p></div>
        </section> : isAwaitingReview ? <section class="portal-panel portal-submitter-flow" aria-labelledby="next-heading">
          <header class="portal-panel-head"><h2 id="next-heading">What happens next</h2><span>three steps</span></header>
          <div class="portal-panel-body">
            <ol class="portal-next-steps">
              <li><strong>Review.</strong><span>The program team reads every abstract. Yours is in the queue — there is no further step for you here.</span></li>
              <li><strong>Decision.</strong><span>{decisionCopy} We write to <strong>{snapshot.person.email}</strong> either way.</span></li>
              <li><strong>If it is accepted.</strong><span>This page becomes your speaker portal — your tasks, profile, headshot, and session time all arrive here.</span></li>
            </ol>
          </div>
        </section> : <section class="portal-panel portal-submitter-flow" aria-labelledby="status-update-heading">
          <header class="portal-panel-head"><h2 id="status-update-heading">Submission update</h2><span>current outcome</span></header>
          <div class="portal-panel-body"><p class="portal-submitter-status-note">{submitterOutcomeDetail(lead.status)}</p></div>
        </section>}
        <section class="portal-panel" aria-labelledby="reach-heading">
          <header class="portal-panel-head"><h2 id="reach-heading">Getting back here</h2><span>{snapshot.person.email}</span></header>
          <div class="portal-panel-body">
            <p class="portal-empty">Bookmark this page. If the link expires, sign in with <strong>{snapshot.person.email}</strong> and you will land right back here.</p>
            <div class="portal-seat-actions">
              <a class="portal-button secondary" href="/signin?next=/portal">Sign in with your email</a>
              {openForm ? <a class="portal-button secondary" href={`/f/${encodeURIComponent(openForm)}`}>Open the call for speakers</a> : null}
            </div>
          </div>
        </section>
      </div>
      <section class="portal-panel portal-talks" aria-labelledby="submitted-heading">
        <header class="portal-panel-head">
          <h2 id="submitted-heading">What you sent</h2>
          <span>{snapshot.submissions.length} abstract{snapshot.submissions.length === 1 ? "" : "s"}</span>
        </header>
        <div class="portal-panel-body">
          {snapshot.submissions.map((submission) => <SubmissionRow key={submission.id} submission={submission} />)}
        </div>
      </section>
      <section class="portal-panel" aria-labelledby="conference-heading">
        <header class="portal-panel-head"><h2 id="conference-heading">Conferences on file</h2><span>{snapshot.available_events.length} conference{snapshot.available_events.length === 1 ? "" : "s"}</span></header>
        <div class="portal-panel-body">
          <p class="portal-empty">{snapshot.available_events.length > 1
            ? `You have submissions in ${snapshot.available_events.length} conferences. Choose one to view its abstracts.`
            : "This is the only conference with a submission on file."}</p>
          <nav class="portal-seat-actions" aria-label="Conferences with submissions">{conferenceLinks}</nav>
          <div class="portal-seat-actions">
            <a class="portal-button secondary" href="/">Return to conference</a>
            <a class="portal-button secondary" href="/agenda">View the agenda</a>
          </div>
        </div>
      </section>
    </main>
  </div>;
}

/**
 * What the portal says to an account that has no seat in it. An organizer
 * reaches this from the sidebar's own "Speaker portal" entry, and the generic
 * failure state told them the site was broken — "We could not load your
 * portal · conference not found" — when the server had answered correctly.
 * The truth is short, and every route out of it is one they can use.
 */
function NoSeatNotice(): JSX.Element {
  return <div class="portal-shell">
    <header class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span><a href="/">Return to conference</a></header>
    <main class="portal-main"><div class="portal-error portal-answer"><div>
      <strong>You have no speaker record at this conference.</strong>
      <p>The speaker portal opens one speaker's own workspace — their tasks, profile, and session times. Nothing here failed: this account is not a speaker or a submitter at this conference.</p>
      <p>If you organize this conference, open any speaker's portal from their record on the Speakers page.</p>
      <div class="portal-seat-actions">
        <a class="portal-button" href="/roster">Speakers</a>
        <a class="portal-button secondary" href="/dashboard">Program home</a>
        <a class="portal-button secondary" href="/">Return to conference</a>
      </div>
    </div></div></main>
  </div>;
}

function PortalPage(): JSX.Element {
  const query = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const viewingAsSpeaker = query?.get("viewing_as") === "speaker";
  const requestedEventId = query?.get("eventId");
  const [snapshot, setSnapshot] = useState<AnyPortalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiFailure | null>(null);
  const refresh = async () => {
    const path = requestedEventId ? `/api/v1/me/portal?eventId=${encodeURIComponent(requestedEventId)}` : "/api/v1/me/portal";
    try { setLoading(true); setError(null); const next = await requestJson<AnyPortalSnapshot>(path); setSnapshot(next); }
    catch (caught) { setError(caught as ApiFailure); } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const signOut = async () => {
    await requestJson("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/");
  };
  // Everything below this line belongs to the speaker seat. A submitter reaches
  // its own surface before any of it is read.
  const speaker = snapshot?.seat === "submitter" ? null : snapshot ?? null;
  const activeTasks = speaker?.tasks.filter((task) => task.cancelled_at === null) ?? [];
  const completedTasks = activeTasks.filter((task) => task.status === "done").length;
  const handbook = useMemo(() => speaker?.handbook.markdown ?? "", [speaker?.handbook.markdown]);
  if (loading && !snapshot) return <div class="portal-shell"><div class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span></div><main class="portal-main"><div class="portal-loading">Loading your conference portal…</div></main></div>;
  if (error && !snapshot && error.status === 401) return <div class="portal-shell"><div class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span><a href="/">Return to conference</a></div><main class="portal-main"><div class="portal-error"><div><strong>Sign in to open your speaker portal.</strong><p>Your session is missing or has expired.</p><a class="portal-signin" href="/signin?next=/portal">Sign in</a></div></div></main></div>;
  /* A 404 here is not a failure to load — it is a true answer: this account
     has no speaker or submitter record at this conference. Organizers reach
     it constantly from the sidebar, and "We could not load your portal ·
     conference not found" told them the site was broken when nothing was.
     Every route out of it is a route they can actually use. */
  if (error && !snapshot && error.status === 404) return <NoSeatNotice />;
  if (error && !snapshot) return <div class="portal-shell"><div class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span></div><main class="portal-main"><div class="portal-error"><div><strong>We could not load your portal.</strong><p>{error.message}</p><button class="portal-button" type="button" onClick={() => void refresh()}>Try again</button></div></div></main></div>;
  if (snapshot && snapshot.seat === "submitter") return <SubmitterPortal snapshot={snapshot} onSignOut={() => void signOut()} viewingAsSpeaker={viewingAsSpeaker} />;
  if (!speaker) return <div class="portal-shell"><header class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span><a href="/">Return to conference</a></header><main class="portal-main"><div class="portal-error"><div><strong>No portal data is available.</strong><p>Try loading the speaker workspace again.</p><button class="portal-button" type="button" onClick={() => void refresh()}>Try again</button></div></div></main></div>;
  return <div class="portal-shell"><header class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span><button type="button" onClick={() => void signOut()}>Sign out</button></header><main class="portal-main">{viewingAsSpeaker ? <ViewingAsBanner /> : null}{speaker.submissions.length === 0 ? <section class="portal-status-hero" aria-labelledby="portal-status-heading"><span class="eyebrow">Current status</span><h1 id="portal-status-heading">Speaker portal</h1><div class="portal-status-copy">Your conference submissions and speaker tasks will appear here.</div><a class="portal-button secondary" href="/">Return to conference</a></section> : speaker.submissions.map((submission, index) => <StatusHero key={submission.id} submission={submission} index={index} timezone={speaker.event.timezone} onRefresh={refresh} />)}<div class="portal-welcome"><div><h2>Welcome back, {speaker.person.name}</h2><p>{speaker.event.name} · your speaker workspace</p></div><div class={`portal-progress${activeTasks.length > completedTasks ? " needs-action" : " is-complete"}`}><strong>{completedTasks} of {activeTasks.length}</strong><span class="portal-progress-label">tasks complete</span><span class="portal-progress-note">{activeTasks.length > completedTasks ? `${activeTasks.length - completedTasks} still need${activeTasks.length - completedTasks === 1 ? "s" : ""} you` : "nothing is waiting on you"}</span></div></div><div class="portal-grid"><TasksPanel eventId={speaker.event.id} tasks={speaker.tasks} submissions={speaker.submissions} person={speaker.person} onRefresh={refresh} /><ProfileEditor eventId={speaker.event.id} person={speaker.person} platforms={speaker.event.social_platforms ?? [...SOCIAL_PLATFORM_IDS]} onSaved={refresh} /></div><AnnounceYourTalk event={speaker.event} submissions={speaker.submissions} /><section class="portal-panel portal-talks" aria-labelledby="talks-heading"><header class="portal-panel-head"><h2 id="talks-heading">Your talks</h2><span>{speaker.submissions.length} record{speaker.submissions.length === 1 ? "" : "s"}</span></header><div class="portal-panel-body">{speaker.submissions.length === 0 ? <div class="portal-empty">No submissions are attached to this speaker record. The conference team will attach one when it is ready.</div> : speaker.submissions.map((submission) => <TalkCard key={submission.id} submission={submission} onSaved={refresh} />)}</div></section>{speaker.submissions.some((submission) => submission.decision_feedback) ? <section class="portal-panel portal-talks" aria-labelledby="feedback-heading"><header class="portal-panel-head"><h2 id="feedback-heading">Conference update</h2><span>latest note</span></header><div class="portal-panel-body">{speaker.submissions.filter((submission) => submission.decision_feedback).map((submission) => <div class="portal-feedback" key={submission.id}><h3>{submission.title}</h3><p>{submission.decision_feedback?.markdown}</p></div>)}</div></section> : null}<section class="portal-panel portal-handbook" aria-labelledby="handbook-heading"><header class="portal-panel-head"><h2 id="handbook-heading">Speaker handbook</h2><span>{speaker.event.name}</span></header><div class="portal-panel-body"><Markdown markdown={handbook} /></div></section></main></div>;
}

export { NoSeatNotice, PortalPage, SubmitterPortal };
export type { PortalPerson, PortalSubmission, PortalTask, SubmitterSnapshot, SubmitterSubmission };
