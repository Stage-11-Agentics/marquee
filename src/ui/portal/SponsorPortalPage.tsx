/** @jsxImportSource preact */

/**
 * The sponsor portal.
 *
 * The speaker portal's sibling: same shell, same task machinery, same Flight Deck
 * day treatment. What moves is the centre of gravity — this page orbits the
 * SPONSORSHIP, the company's deal with this conference. Page order reproduces
 * `prototypes/sponsor-portal/index.html`: head → sponsorship hero → booth →
 * deliverables · Sessions · company · handbook.
 *
 * Two rulings shape almost everything here (`sequence/sponsors-design.md` §5.2):
 *
 *   Whole sponsorship, anyone completes. Every deliverable is visible to every
 *   contact with its assignee named, any contact can complete any open one, and
 *   who did it is recorded and shown. A blocked task in front of the right human
 *   is exactly the dead end PHILOSOPHY forbids.
 *
 *   Sessions are read-only; the task machinery is the single write path. There is
 *   no edit control on a Session card anywhere on this page. "Speaker not named
 *   yet" links to the deliverable that fills it, and completing that deliverable
 *   is what changes the card.
 */

import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { SPONSOR_WRITEBACK_TEMPLATE_IDS } from "../../lib/sponsors/deliverable-templates";
import type { VenueBuildingInput } from "../../lib/venues";
import { MAP_HEIGHT, VenueMap } from "../venues/VenueMap";
import {
  CancelledTaskRow,
  GenericTaskSurface,
  requestJson,
  TaskRow,
  type ApiFailure,
  type PortalTask,
} from "./task-machinery";
import "./sponsor-portal.css";

type SponsorContact = {
  person_id: string;
  name: string;
  title: string | null;
  is_primary: boolean;
  is_you: boolean;
};

type SponsorSession = {
  id: string;
  title: string;
  description: string | null;
  format: string | null;
  speakers: Array<{ id: string; name: string }>;
  slot: {
    starts_at: number;
    duration_min: number | null;
    day: string;
    date: string;
    time: string;
    room: string;
    is_published: boolean;
  } | null;
};

type SponsorBooth = {
  number: string | null;
  size: string | null;
  hall: string | null;
  load_in: string | null;
  access_note: string | null;
  leave_note: string | null;
  building: { id: string; name: string | null; address: string | null; lat: number | null; lng: number | null } | null;
};

type SponsorSnapshot = {
  seat: "sponsor_contact";
  event: { id: string; name: string; slug: string; starts_on: string; ends_on: string; timezone: string; venue: string | null };
  viewer: { id: string; name: string; email: string; title: string | null };
  sponsorship: {
    id: string;
    status: string;
    status_label: string;
    tier: string | null;
    passes: number;
    company: { id: string; name: string; website: string | null; blurb: string | null };
    booth: SponsorBooth | null;
    deal_line: string[];
    organizer_contact: { person_id: string; name: string; email: string; role: string } | null;
  };
  contacts: SponsorContact[];
  tasks: PortalTask[];
  sessions: SponsorSession[];
  handbook: Array<{ id: string; label: string; markdown: string }>;
  available_sponsorships: Array<{ id: string; company_name: string; event_name: string }>;
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((word) => [...word][0] ?? "").slice(0, 2).join("").toUpperCase();
}

function conferenceDates(startsOn: string, endsOn: string): string {
  const format = (value: string) => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!parts) return value;
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))));
  };
  const year = startsOn.slice(0, 4);
  return `${format(startsOn)} – ${format(endsOn)}, ${year}`;
}

/**
 * Who owes this deliverable, said in the second person where that is true.
 *
 * "yours" rather than the viewer's own name: a list of eight rows where three say
 * "Dana Okafor" and five say somebody else is harder to scan than one where three
 * say "yours".
 */
function ownerLabel(task: PortalTask, viewerPersonId: string): string {
  if (!task.assignee) return "";
  return task.assignee.person_id === viewerPersonId ? "yours" : `assigned to ${task.assignee.name}`;
}

function markdownInline(text: string): Array<JSX.Element | string> {
  const parts: Array<JSX.Element | string> = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    parts.push(<strong key={`bold-${match.index}`}>{match[1]}</strong>);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

/** The handbook's own small markdown: headings, paragraphs, and bold. */
function HandbookMarkdown({ markdown }: { markdown: string }): JSX.Element {
  const blocks: JSX.Element[] = [];
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (line.startsWith("## ")) blocks.push(<h3 key={index}>{markdownInline(line.slice(3))}</h3>);
    else if (line.trim()) blocks.push(<p key={index}>{markdownInline(line)}</p>);
  });
  return <div class="portal-markdown">{blocks}</div>;
}

function BoothCard({ booth }: { booth: SponsorBooth }): JSX.Element {
  const building = booth.building;
  const hasPin = building?.lat !== null && building?.lat !== undefined && building?.lng !== null && building?.lng !== undefined;
  const directions = hasPin
    ? `https://www.google.com/maps/search/?api=1&query=${building!.lat},${building!.lng}`
    : null;
  const mapBuilding: VenueBuildingInput | null = building
    ? {
        id: building.id,
        name: building.name ?? building.address ?? "The conference team has not named this building.",
        address: building.address ?? "",
        position: 0,
        lat: building.lat,
        lng: building.lng,
        access_minutes: 0,
        access_note: booth.access_note,
      }
    : null;
  const mapStyle = { height: `${MAP_HEIGHT}px`, minHeight: `${MAP_HEIGHT}px` };
  return <section class="sponsor-booth" aria-labelledby="booth-heading">
    <header class="sponsor-booth-head">
      <div>
        <h2 id="booth-heading">Your booth</h2>
        <span>{booth.hall ?? "The exhibit hall is not assigned yet"}</span>
      </div>
      {directions ? <a class="portal-button secondary" href={directions} target="_blank" rel="noreferrer">Directions ↗</a> : null}
    </header>
    <div class="sponsor-booth-body">
      <div>
        <div class="sponsor-loc-line">
          <span class="sponsor-loc-label">Booth</span>
          <span class="sponsor-loc-value"><strong class="tabular">{booth.number ?? "—"}</strong>{booth.size ? ` · ${booth.size}` : ""}</span>
        </div>
        <div class="sponsor-loc-line">
          <span class="sponsor-loc-label">Hall</span>
          <span class="sponsor-loc-value">{booth.hall ?? "Not assigned yet"}</span>
        </div>
        <div class="sponsor-loc-line">
          <span class="sponsor-loc-label">Building</span>
          <span class="sponsor-loc-value">
            <strong>{building?.name ?? "No building assigned yet"}</strong>
            {building?.address ? <span class="sponsor-loc-sub">{building.address}</span> : null}
          </span>
        </div>
        <div class="sponsor-loc-line">
          <span class="sponsor-loc-label">Load-in</span>
          <span class="sponsor-loc-value">{booth.load_in ?? "Load-in times are not published yet."}</span>
        </div>
        <div class="sponsor-loc-line">
          <span class="sponsor-loc-label">Getting in</span>
          <span class="sponsor-loc-value">{booth.access_note ?? "The conference team has not published dock instructions yet."}</span>
        </div>
        {/* The speaker card's leave-by box, repurposed for load-in timing. */}
        {booth.leave_note ? <p class="sponsor-loc-leave">{booth.leave_note}</p> : null}
      </div>
      <div class="sponsor-booth-map" style={mapStyle}>
        {mapBuilding && hasPin
          ? <VenueMap buildings={[mapBuilding]} ariaLabel={`Map of ${mapBuilding.name}`} />
          : <div class="sponsor-booth-map-empty" style={mapStyle}>The conference team has not pinned this building.</div>}
      </div>
    </div>
  </section>;
}

/**
 * A Session, read-only.
 *
 * The one action here is not an edit: when nobody is named yet it opens the
 * deliverable that names them. Everything else is a statement of what the
 * conference currently knows, including when the honest answer is "not yet".
 */
function SessionCard({ session, namingTask, onOpenTask }: {
  session: SponsorSession;
  namingTask: PortalTask | null;
  onOpenTask: (taskId: string) => void;
}): JSX.Element {
  const named = session.speakers.length > 0;
  return <article class="sponsor-session">
    <span class="sponsor-chip session">Session</span>
    <h3>{session.title}</h3>
    <span class="sponsor-session-meta">
      {session.format ?? "Format not set"} · {named ? session.speakers.map((speaker) => speaker.name).join(" · ") : "Speaker not named yet"}
    </span>
    <div class="sponsor-session-slot">
      {session.slot
        ? <>
            <span class="sponsor-slot-chip">{session.slot.day} · {session.slot.date} · {session.slot.time} · {session.slot.room}</span>
            {session.slot.is_published ? null : <span class="sponsor-not-public">Not yet public</span>}
          </>
        : <span class="sponsor-session-unscheduled">Not scheduled yet — the agenda team places Sessions once the program locks.</span>}
    </div>
    <div class="sponsor-session-actions">
      {!named && namingTask
        /* Not an edit control — the one write path is the deliverable, and this
           opens it. An anchor as well as a handler, so it works before hydration
           and reads as navigation, which is what it is. */
        ? <a class="portal-button" href={`#deliverable-${namingTask.id}`} onClick={() => onOpenTask(namingTask.id)}>Name your speaker</a>
        : !named
          ? <span class="portal-empty">Your organizer will add the deliverable that names your speaker.</span>
          : <span class="portal-empty">{session.slot ? "Everything this Session needs is on file." : "Scheduling follows once the program locks."}</span>}
    </div>
  </article>;
}

function CompanyPanel({ snapshot, onSaved }: { snapshot: SponsorSnapshot; onSaved: () => Promise<void> }): JSX.Element {
  const { company } = snapshot.sponsorship;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(company.name);
  const [website, setWebsite] = useState(company.website ?? "");
  const [blurb, setBlurb] = useState(company.blurb ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(company.name);
    setWebsite(company.website ?? "");
    setBlurb(company.blurb ?? "");
  }, [company.id, company.name, company.website, company.blurb]);

  const save = async (event: Event) => {
    event.preventDefault();
    if (!name.trim()) { setError("A company name is required."); return; }
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/v1/me/sponsorships/${encodeURIComponent(snapshot.sponsorship.id)}/company`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), website: website.trim() || null, blurb: blurb.trim() || null }),
      });
      setEditing(false);
      await onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <section class="portal-panel" aria-labelledby="company-heading">
    <header class="portal-panel-head">
      <h2 id="company-heading">Company profile</h2>
      <button class="portal-task-action" type="button" onClick={() => setEditing((current) => !current)}>{editing ? "Close" : "Edit"}</button>
    </header>
    <div class="portal-panel-body">
      <div class="sponsor-company-mark">
        <div class="sponsor-company-avatar" aria-hidden="true">{initials(company.name)}</div>
        <strong>{company.name}</strong>
        {company.website ? <a href={company.website} target="_blank" rel="noreferrer">{company.website.replace(/^https?:\/\//, "")}</a> : null}
      </div>
      <p class="sponsor-company-blurb">{company.blurb || "No public blurb yet. The conference publishes this beside your name."}</p>
      {editing ? <form class="sponsor-company-editor" onSubmit={save}>
        {/* Org-level, and the form says so: these facts carry to every conference
            this company sponsors. */}
        <p class="portal-subject-note">These facts are your company's, not this conference's — they carry to every conference {company.name} sponsors.</p>
        <div class="portal-field"><label for="sponsor-company-name">Company name</label><input id="sponsor-company-name" value={name} onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)} /></div>
        <div class="portal-field"><label for="sponsor-company-website">Website</label><input id="sponsor-company-website" type="url" value={website} onInput={(event) => setWebsite((event.currentTarget as HTMLInputElement).value)} /></div>
        <div class="portal-field"><label for="sponsor-company-blurb">Public blurb</label><textarea id="sponsor-company-blurb" value={blurb} onInput={(event) => setBlurb((event.currentTarget as HTMLTextAreaElement).value)} /></div>
        <div class="portal-payload-actions"><span class="portal-payload-error" aria-live="polite">{error ?? ""}</span><button class="portal-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button></div>
      </form> : null}
      <div class="sponsor-divider" />
      <div class="sponsor-contact-list">
        {snapshot.contacts.map((contact) => <div class="sponsor-contact-row" key={contact.person_id}>
          <span class="sponsor-contact-initials" aria-hidden="true">{initials(contact.name)}</span>
          <div>
            <strong>{contact.name}</strong>
            <small>{contact.title ?? "No title on file"}</small>
          </div>
          <span class="sponsor-contact-chips">
            {contact.is_primary ? <span class="sponsor-chip">Primary</span> : null}
            {contact.is_you ? <span class="sponsor-chip you">You</span> : null}
          </span>
        </div>)}
      </div>
      {/* Contacts are read-only here on purpose: access to a sponsorship is the
          organizer's to grant, and a portal that could add its own contacts could
          invite anybody into the deal. */}
      <p class="sponsor-roster-note">To add or change a contact, email {snapshot.sponsorship.organizer_contact
        ? <a href={`mailto:${snapshot.sponsorship.organizer_contact.email}`}>{snapshot.sponsorship.organizer_contact.email}</a>
        : "your organizer"} — your organizer manages access.</p>
    </div>
  </section>;
}

function HandbookPanel({ chapters }: { chapters: SponsorSnapshot["handbook"] }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  return <section class="portal-panel portal-handbook" aria-labelledby="handbook-heading">
    <header class="portal-panel-head"><h2 id="handbook-heading">Sponsor handbook</h2><span>{chapters.length} chapter{chapters.length === 1 ? "" : "s"}</span></header>
    <div class="portal-panel-body">
      {chapters.map((chapter) => <div class="sponsor-handbook-chapter" key={chapter.id}>
        <button class="sponsor-handbook-toggle" type="button" aria-expanded={open === chapter.id} onClick={() => setOpen((current) => current === chapter.id ? null : chapter.id)}>
          <span>{chapter.label}</span>
          {/* Fixed-width glyph column: the swap cannot move the label. */}
          <span aria-hidden="true">{open === chapter.id ? "−" : "+"}</span>
        </button>
        {open === chapter.id ? <div class="sponsor-handbook-body"><HandbookMarkdown markdown={chapter.markdown} /></div> : null}
      </div>)}
    </div>
  </section>;
}

function SponsorShell({ children }: { children: JSX.Element | JSX.Element[] }): JSX.Element {
  return <div class="portal-shell">
    <header class="portal-top">
      <span class="portal-brand">Marquee · Sponsor portal</span>
      <a href="/">Return to conference</a>
    </header>
    <main class="portal-main">{children}</main>
  </div>;
}

/**
 * What the portal says to an account that holds no sponsorship. It is a true
 * answer rather than a failure — an organizer reaching this from a guessed URL
 * has not broken anything — and every route out of it is one they can use.
 */
function NoSponsorshipNotice(): JSX.Element {
  return <SponsorShell><div class="portal-error portal-answer"><div>
    <strong>You have no sponsorship at this conference.</strong>
    <p>The sponsor portal opens one sponsorship's workspace — its deliverables, its Sessions, and its company profile. Nothing here failed: this account is not a contact on a sponsorship.</p>
    <p>If your company sponsors this conference and you should have access, ask whoever holds the sponsorship to have the organizer add you. Sponsors are set up by the conference team, not by a public form.</p>
    <div class="portal-seat-actions">
      <a class="portal-button secondary" href="/portal">Speaker portal</a>
      <a class="portal-button secondary" href="/">Return to conference</a>
    </div>
  </div></div></SponsorShell>;
}

function SponsorPortalPage(): JSX.Element {
  const query = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const requestedSponsorshipId = query?.get("sponsorshipId");
  const [snapshot, setSnapshot] = useState<SponsorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const refresh = async () => {
    const path = requestedSponsorshipId
      ? `/api/v1/me/sponsor-portal?sponsorshipId=${encodeURIComponent(requestedSponsorshipId)}`
      : "/api/v1/me/sponsor-portal";
    try {
      setLoading(true);
      setError(null);
      setSnapshot(await requestJson<SponsorSnapshot>(path));
    } catch (caught) {
      setError(caught as ApiFailure);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  const live = useMemo(() => snapshot?.tasks.filter((task) => task.cancelled_at === null) ?? [], [snapshot]);
  const cancelled = useMemo(() => snapshot?.tasks.filter((task) => task.cancelled_at !== null) ?? [], [snapshot]);
  const done = live.filter((task) => task.status === "done").length;
  const overdue = live.filter((task) => task.overdue && task.status === "open").length;

  if (loading && !snapshot) {
    return <SponsorShell><div class="portal-loading">Loading your sponsorship…</div></SponsorShell>;
  }
  if (error && !snapshot && error.status === 401) {
    return <SponsorShell><div class="portal-error"><div>
      <strong>Sign in to open your sponsor portal.</strong>
      <p>Your session is missing or has expired.</p>
      <a class="portal-signin" href="/signin?next=/sponsor-portal">Sign in</a>
    </div></div></SponsorShell>;
  }
  // A 404 here is a true answer, not a failure to load.
  if (error && !snapshot && error.status === 404) return <NoSponsorshipNotice />;
  if (error && !snapshot) {
    return <SponsorShell><div class="portal-error"><div>
      <strong>We could not load your sponsorship.</strong>
      <p>{error.message}</p>
      <button class="portal-button" type="button" onClick={() => void refresh()}>Try again</button>
    </div></div></SponsorShell>;
  }
  if (!snapshot) {
    return <SponsorShell><div class="portal-error"><div>
      <strong>No sponsorship data is available.</strong>
      <p>Try loading your sponsorship again.</p>
      <button class="portal-button" type="button" onClick={() => void refresh()}>Try again</button>
    </div></div></SponsorShell>;
  }

  const { sponsorship, event } = snapshot;
  const namingTaskFor = (sessionId: string): PortalTask | null =>
    live.find((task) =>
      task.submission_id === sessionId
      && task.template_id === SPONSOR_WRITEBACK_TEMPLATE_IDS.nameYourSpeaker
      && task.status === "open") ?? null;

  return <div class="portal-shell">
    <header class="portal-top">
      <span class="portal-brand">Marquee · Sponsor portal</span>
      <button type="button" onClick={() => { void requestJson("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined).then(() => window.location.assign("/")); }}>Sign out</button>
    </header>
    <main class="portal-main">
      {/* Only drawn when this contact genuinely holds more than one deal. */}
      {snapshot.available_sponsorships.length > 1 ? <div class="sponsor-switcher">
        <label for="sponsor-switcher">Sponsorship</label>
        <select id="sponsor-switcher" value={sponsorship.id} onChange={(changed) => {
          const next = (changed.currentTarget as HTMLSelectElement).value;
          window.location.assign(`/sponsor-portal?sponsorshipId=${encodeURIComponent(next)}`);
        }}>
          {snapshot.available_sponsorships.map((option) => <option key={option.id} value={option.id}>{option.company_name} · {option.event_name}</option>)}
        </select>
      </div> : null}

      <div class="portal-welcome">
        <div>
          <h2>Welcome back, {snapshot.viewer.name}</h2>
          <p>{sponsorship.company.name}'s {sponsorship.booth ? "deliverables, Sessions, and booth details" : "deliverables and Sessions"} — everything {event.name} needs from you, in one place.</p>
        </div>
        <div class={`portal-progress${live.length > done ? " needs-action" : " is-complete"}`}>
          <strong class="tabular">{done} of {live.length}</strong>
          <span class="portal-progress-label">deliverables done</span>
          <span class="portal-progress-note">{live.length > done ? `${live.length - done} still need${live.length - done === 1 ? "s" : ""} you` : "nothing is waiting on you"}</span>
        </div>
      </div>

      <section class="sponsor-hero" aria-labelledby="sponsor-hero-heading">
        <div>
          <div class="sponsor-hero-eyebrow">{sponsorship.tier ? `${sponsorship.tier} sponsor` : "Sponsor"} · {sponsorship.status_label}</div>
          <h1 id="sponsor-hero-heading">{sponsorship.company.name}</h1>
          <p class="sponsor-hero-conference">{event.name} · {conferenceDates(event.starts_on, event.ends_on)}{event.venue ? ` · ${event.venue}` : ""}</p>
          {/* Derived from what is attached — Sessions, booth, passes — never a
              per-tier blurb. */}
          <div class="sponsor-deal-line">
            {sponsorship.deal_line.map((chip) => <span class="sponsor-deal-chip" key={chip}>{chip}</span>)}
          </div>
        </div>
        <div class="sponsor-hero-side">
          <span class="sponsor-hero-eyebrow">Your organizer contact</span>
          {sponsorship.organizer_contact
            ? <>
                <strong>{sponsorship.organizer_contact.name}</strong>
                <span class="sponsor-hero-side-line">{sponsorship.organizer_contact.role} · <a href={`mailto:${sponsorship.organizer_contact.email}`}>{sponsorship.organizer_contact.email}</a></span>
              </>
            : <span class="sponsor-hero-side-line">The conference has not named a sponsorship contact yet.</span>}
        </div>
      </section>

      {/* Present only when booth data exists. Its absence is ordinary
          composition, not a special case. */}
      {sponsorship.booth ? <BoothCard booth={sponsorship.booth} /> : null}

      <div class="portal-grid">
        <section class="portal-panel" aria-labelledby="deliverables-heading">
          <header class="portal-panel-head">
            <h2 id="deliverables-heading">Deliverables</h2>
            <div class="portal-panel-meta">
              {overdue > 0 ? <span class="portal-panel-flag needs-action">{overdue} overdue</span> : null}
              <span class="tabular">{done}/{live.length} complete</span>
            </div>
          </header>
          <div class="portal-panel-body">
            <p class="sponsor-anyone-note">{overdue > 0 ? "Complete the overdue item first. " : "Nothing is overdue right now. "}Anyone at {sponsorship.company.name} can complete any item, and whoever does is recorded on it.</p>
            <div class="portal-task-list">
              {live.length === 0
                ? <div class="portal-empty">No deliverables are on this sponsorship yet. Your organizer adds them as the conference approaches.</div>
                : live.map((task) => <TaskRow
                    key={task.id}
                    task={task}
                    ownerLabel={ownerLabel(task, snapshot.viewer.id)}
                    expanded={openTaskId === task.id}
                    onExpandedChange={(next) => setOpenTaskId(next ? task.id : null)}
                    renderSurface={(current) => <GenericTaskSurface task={current} onComplete={async () => { setOpenTaskId(null); await refresh(); }} />}
                  />)}
            </div>
            {/* Cancelled work sits below a dashed divider with its reason stated
                ONCE, and is out of the progress figure entirely. */}
            {cancelled.length > 0 ? <div class="portal-cancelled-task-list" data-cancelled-task-count={cancelled.length}>
              <div class="portal-cancelled-divider"><span>Cancelled · {cancelled.length}</span></div>
              <div class="portal-cancelled-set">
                <div class="portal-cancelled-set-head">
                  <p>{cancelled[0]?.cancelled_reason ?? "These are no longer needed by the conference."} You do not need to do anything with them.</p>
                </div>
                <div class="portal-task-list">
                  {cancelled.map((task) => <CancelledTaskRow key={task.id} task={task} ownerLabel={task.assignee ? `was assigned to ${task.assignee.name}` : ""} />)}
                </div>
              </div>
            </div> : null}
          </div>
        </section>

        <div class="portal-talks">
          <section class="portal-panel" aria-labelledby="sessions-heading">
            <header class="portal-panel-head">
              <div><h2 id="sessions-heading">Your Sessions</h2><span>{sponsorship.tier ? `Guaranteed with ${sponsorship.tier}` : "Guaranteed with your sponsorship"}</span></div>
              <span class="sponsor-chip session tabular">{snapshot.sessions.length}</span>
            </header>
            <div class="portal-panel-body">
              {snapshot.sessions.length === 0
                ? <div class="portal-empty">No Sessions are attached to this sponsorship yet.</div>
                : snapshot.sessions.map((session) => <SessionCard
                    key={session.id}
                    session={session}
                    namingTask={namingTaskFor(session.id)}
                    onOpenTask={setOpenTaskId}
                  />)}
            </div>
          </section>
          <CompanyPanel snapshot={snapshot} onSaved={refresh} />
          <HandbookPanel chapters={snapshot.handbook} />
        </div>
      </div>
    </main>
  </div>;
}

export { NoSponsorshipNotice, SponsorPortalPage };
export type { SponsorSnapshot };
