/**
 * The run of show: one conference, one day, joined the way a person holding a
 * radio at 08:40 needs it.
 *
 * Every fact here already exists somewhere in this product — the schedule, the
 * rooms and their AV, the speakers on each session, the deliverable each
 * speaker owes — and that is exactly the problem this module solves. On the
 * morning of the show nobody can open four screens to answer "who is next in
 * Broadway, are they here, are their slides in?". So the join happens once,
 * server-side, and every day-of surface reads the same snapshot: the phone in
 * the green room, the volunteer's check-in link, the organizer's slides board,
 * and the API an agent calls.
 *
 * Arrival is per (session, person) — see migration 0039. A person is not "here
 * today"; they are here for the 10:40 in Broadway, and the panel beside them
 * may still be missing two.
 */
import { calendarDateInTimezone, conferenceDays, type ConferenceDay } from "../conference-dates";
import { participantListSql } from "../participants";
import { zonedStart } from "../event-time";
import { isTaskOverdue } from "../task-due";

export interface RunOfShowEvent {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  starts_on: string;
  ends_on: string;
}

/** What the deliverable for one session is doing. Never an internal enum on screen. */
export type SlidesState = "received" | "missing" | "overdue" | "done_without_file" | "not_requested";

export interface SlidesOwed {
  person_id: string;
  name: string;
  email: string;
  /** The deliverable slot — a `speaker_tasks` id, which is what "ask again" nudges. */
  task_id: string;
  due_at: number;
}

export interface SessionSlides {
  state: SlidesState;
  /** The most recent upload across the session's deliverables, when there is one. */
  filename: string | null;
  uploaded_at: number | null;
  /** Every deliverable this session is still waiting on; empty once they are all in. */
  owed: SlidesOwed[];
  expected: number;
  received: number;
}

export interface RunOfShowSpeaker {
  person_id: string;
  name: string;
  role: string;
  /** From the person's custom fields when the conference keeps one there. */
  phone: string | null;
  arrived_at: number | null;
  /** The link's name, or the organizer's — whoever said this person is here. */
  marked_by_name: string | null;
}

export interface RunOfShowSession {
  id: string;
  title: string;
  submission_id: string | null;
  room_id: string;
  starts_at: number;
  ends_at: number;
  /** Breaks are on the run of show and own no speakers, slides, or arrivals. */
  is_break: boolean;
  speakers: RunOfShowSpeaker[];
  arrived_count: number;
  slides: SessionSlides;
}

export interface RunOfShowRoom {
  id: string;
  name: string;
  building_name: string;
  capacity: number;
  av_capabilities: string[];
  notes: string | null;
  sessions: RunOfShowSession[];
  /** The session running at `generated_at`, and the one after it. */
  current_session_id: string | null;
  next_session_id: string | null;
}

export interface RunOfShow {
  event: RunOfShowEvent;
  /** The conference-local calendar day this snapshot describes. */
  day: string;
  days: ConferenceDay[];
  /** True when the wall clock outside is that day — the "now" marker only means something then. */
  is_today: boolean;
  generated_at: number;
  rooms: RunOfShowRoom[];
  counts: {
    sessions: number;
    speakers: number;
    arrived: number;
    slides_received: number;
    slides_missing: number;
    slides_overdue: number;
  };
}

interface RoomQueryRow {
  id: string;
  name: string;
  capacity: number;
  av_capabilities: string;
  notes: string | null;
  building_name: string;
}

interface SessionQueryRow {
  id: string;
  kind: "session" | "break";
  starts_at: number;
  duration_min: number;
  room_id: string;
  submission_id: string | null;
  item_title: string | null;
  submission_title: string | null;
  speakers_json: string;
}

interface SpeakerJson {
  person_id: string;
  name: string;
  role: string;
  custom_fields: string | null;
}

interface CheckinQueryRow {
  agenda_item_id: string;
  person_id: string;
  marked_at: number;
  marked_by_name: string;
}

interface SlidesTaskRow {
  task_id: string;
  submission_id: string;
  person_id: string;
  person_name: string;
  person_email: string;
  status: "open" | "done";
  due_at: number;
  template_due_at: number | null;
  filename: string | null;
  uploaded_at: number | null;
  ready_count: number;
}

/**
 * The phone number, if the conference keeps one.
 *
 * There is no `people.phone` column: a conference that collects phone numbers
 * keeps them in the person's custom fields under whatever it calls them, so the
 * lookup is by meaning rather than by key. Finding nothing is an ordinary
 * answer — the card then shows a name with no `tel:` link rather than a dead
 * one.
 */
const PHONE_KEY = /(phone|mobile|cell)/i;

export function phoneFromCustomFields(value: string | null): string | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!PHONE_KEY.test(key)) continue;
    const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
    if (text.length > 0) return text;
  }
  return null;
}

/** `tel:` wants digits, a leading plus, and nothing else a dialer would choke on. */
export function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  return `tel:${cleaned.startsWith("+") ? "+" : ""}${cleaned.replace(/\+/g, "")}`;
}

/**
 * Which day the surface opens on.
 *
 * The conference's own today, when the show is running — that is the whole
 * point of the surface. Outside the conference dates there is no honest
 * "today", so it opens on day one and the switcher does the rest; a green room
 * that renders an empty Tuesday in March reads as broken rather than as early.
 */
export function defaultRunOfShowDay(event: RunOfShowEvent, now: number): string {
  const today = calendarDateInTimezone(now, event.timezone);
  if (today < event.starts_on) return event.starts_on;
  if (today > event.ends_on) return event.ends_on;
  return today;
}

export function isRunOfShowDay(event: RunOfShowEvent, day: string): boolean {
  return day >= event.starts_on && day <= event.ends_on;
}

/** The event-local window `[start, end)` for one calendar day. */
export function dayWindow(day: string, timezone: string): { start: number; end: number } {
  const start = zonedStart(day, "00:00", timezone);
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, date! + 1)).toISOString().slice(0, 10);
  return { start, end: zonedStart(next, "00:00", timezone) };
}

export async function readRunOfShowEvent(
  db: D1Database,
  eventId: string,
): Promise<RunOfShowEvent | null> {
  const row = await db
    .prepare("SELECT id, name, slug, timezone, starts_on, ends_on FROM events WHERE id = ?")
    .bind(eventId)
    .first<RunOfShowEvent>();
  return row ?? null;
}

function slidesFor(
  tasks: readonly SlidesTaskRow[],
  timezone: string,
  now: number,
): SessionSlides {
  if (tasks.length === 0) {
    return { state: "not_requested", filename: null, uploaded_at: null, owed: [], expected: 0, received: 0 };
  }
  const received = tasks.filter((task) => task.ready_count > 0);
  const outstanding = tasks.filter((task) => task.ready_count === 0);
  const newest = received.reduce<SlidesTaskRow | null>(
    (latest, task) => (latest === null || (task.uploaded_at ?? 0) > (latest.uploaded_at ?? 0) ? task : latest),
    null,
  );
  const overdue = outstanding.some((task) =>
    isTaskOverdue({ dueAt: task.due_at, templateDueAt: task.template_due_at, timezone }, now));
  // "Marked done, no file" is its own answer rather than a kind of missing: the
  // speaker says the work is finished and the AV team has nothing to project,
  // and telling those two apart at 08:40 is the difference between chasing a
  // person and chasing a file.
  const doneWithoutFile = outstanding.length > 0 && outstanding.every((task) => task.status === "done");
  const state: SlidesState = outstanding.length === 0
    ? "received"
    : doneWithoutFile
      ? "done_without_file"
      : overdue
        ? "overdue"
        : "missing";
  return {
    state,
    filename: newest?.filename ?? null,
    uploaded_at: newest?.uploaded_at ?? null,
    owed: outstanding.map((task) => ({
      person_id: task.person_id,
      name: task.person_name,
      email: task.person_email,
      task_id: task.task_id,
      due_at: task.due_at,
    })),
    expected: tasks.length,
    received: received.length,
  };
}

export interface RunOfShowQuery {
  /** A conference-local calendar day; defaults to the conference's own today. */
  day?: string;
  now?: number;
}

export async function readRunOfShow(
  db: D1Database,
  event: RunOfShowEvent,
  query: RunOfShowQuery = {},
): Promise<RunOfShow> {
  const now = query.now ?? Date.now();
  const requested = query.day && /^\d{4}-\d{2}-\d{2}$/.test(query.day) ? query.day : null;
  const day = requested ?? defaultRunOfShowDay(event, now);
  const window = dayWindow(day, event.timezone);

  const speakers = participantListSql({
    submissionId: "item.submission_id",
    audience: "program",
    fields: {
      person_id: "speaker.id",
      name: "speaker.name",
      role: "participation.role",
      custom_fields: "speaker.custom_fields",
    },
  });

  const [rooms, sessions, checkins] = await Promise.all([
    db
      .prepare(
        `SELECT room.id, room.name, room.capacity, room.av_capabilities, room.notes,
                building.name AS building_name
           FROM rooms room
           JOIN buildings building ON building.id = room.building_id AND building.event_id = room.event_id
          WHERE room.event_id = ?
          ORDER BY room.position ASC, room.name COLLATE NOCASE ASC`,
      )
      .bind(event.id)
      .all<RoomQueryRow>(),
    db
      .prepare(
        `SELECT item.id, item.kind, item.starts_at, item.duration_min, item.room_id, item.submission_id,
                item.title AS item_title, submission.title AS submission_title,
                ${speakers} AS speakers_json
           FROM agenda_items item
           LEFT JOIN submissions submission
             ON submission.id = item.submission_id AND submission.event_id = item.event_id
          WHERE item.event_id = ? AND item.starts_at >= ? AND item.starts_at < ?
          ORDER BY item.starts_at ASC, item.id ASC`,
      )
      .bind(event.id, window.start, window.end)
      .all<SessionQueryRow>(),
    db
      .prepare(
        `SELECT checkin.agenda_item_id, checkin.person_id, checkin.marked_at, checkin.marked_by_name
           FROM checkins checkin
           JOIN agenda_items item ON item.id = checkin.agenda_item_id
          WHERE checkin.event_id = ? AND item.starts_at >= ? AND item.starts_at < ?`,
      )
      .bind(event.id, window.start, window.end)
      .all<CheckinQueryRow>(),
  ]);

  const submissionIds = [
    ...new Set(sessions.results.map((row) => row.submission_id).filter((id): id is string => id !== null)),
  ];
  // The deliverable is read straight from the ledger's own definition of
  // current — the owner pointer first, the newest ready upload behind it — and
  // never from a `pending` row, which is a presign whose upload never landed
  // and would claim a file that is not in the bucket.
  const slidesTasks = submissionIds.length === 0
    ? { results: [] as SlidesTaskRow[] }
    : await db
      .prepare(
        `SELECT task.id AS task_id, task.submission_id, task.person_id,
                person.name AS person_name, person.email AS person_email,
                task.status, task.due_at, template.due_at AS template_due_at,
                COALESCE(pointer.filename, (
                  SELECT fallback.filename FROM attachments fallback
                   WHERE fallback.owner_type = 'task_upload' AND fallback.owner_id = task.id
                     AND fallback.status = 'ready'
                   ORDER BY fallback.created_at DESC, fallback.id DESC LIMIT 1
                )) AS filename,
                COALESCE(pointer.created_at, (
                  SELECT fallback.created_at FROM attachments fallback
                   WHERE fallback.owner_type = 'task_upload' AND fallback.owner_id = task.id
                     AND fallback.status = 'ready'
                   ORDER BY fallback.created_at DESC, fallback.id DESC LIMIT 1
                )) AS uploaded_at,
                (SELECT COUNT(*) FROM attachments counted
                  WHERE counted.owner_type = 'task_upload' AND counted.owner_id = task.id
                    AND counted.status = 'ready') AS ready_count
           FROM speaker_tasks task
           JOIN task_templates template ON template.id = task.template_id AND template.event_id = task.event_id
           JOIN people person ON person.id = task.person_id
           LEFT JOIN attachments pointer ON pointer.id = task.attachment_id AND pointer.status = 'ready'
          WHERE task.event_id = ? AND task.kind = 'file' AND task.cancelled_at IS NULL
            AND task.submission_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
          ORDER BY task.due_at ASC, task.id ASC`,
      )
      .bind(event.id, JSON.stringify(submissionIds))
      .all<SlidesTaskRow>();

  const tasksBySubmission = new Map<string, SlidesTaskRow[]>();
  for (const task of slidesTasks.results) {
    const list = tasksBySubmission.get(task.submission_id) ?? [];
    list.push(task);
    tasksBySubmission.set(task.submission_id, list);
  }
  const arrivals = new Map<string, CheckinQueryRow>();
  for (const row of checkins.results) arrivals.set(`${row.agenda_item_id}:${row.person_id}`, row);

  const sessionsByRoom = new Map<string, RunOfShowSession[]>();
  const counts = { sessions: 0, speakers: 0, arrived: 0, slides_received: 0, slides_missing: 0, slides_overdue: 0 };
  for (const row of sessions.results) {
    const isBreak = row.kind === "break";
    const parsed = isBreak ? [] : (JSON.parse(row.speakers_json) as SpeakerJson[]);
    const speakerList: RunOfShowSpeaker[] = parsed.map((speaker) => {
      const arrival = arrivals.get(`${row.id}:${speaker.person_id}`) ?? null;
      return {
        person_id: speaker.person_id,
        name: speaker.name,
        role: speaker.role,
        phone: phoneFromCustomFields(speaker.custom_fields ?? null),
        arrived_at: arrival?.marked_at ?? null,
        marked_by_name: arrival?.marked_by_name ?? null,
      };
    });
    const slides = isBreak || row.submission_id === null
      ? slidesFor([], event.timezone, now)
      : slidesFor(tasksBySubmission.get(row.submission_id) ?? [], event.timezone, now);
    const session: RunOfShowSession = {
      id: row.id,
      title: row.item_title ?? row.submission_title ?? (isBreak ? "Break" : "Untitled session"),
      submission_id: row.submission_id,
      room_id: row.room_id,
      starts_at: row.starts_at,
      ends_at: row.starts_at + row.duration_min * 60_000,
      is_break: isBreak,
      speakers: speakerList,
      arrived_count: speakerList.filter((speaker) => speaker.arrived_at !== null).length,
      slides,
    };
    const list = sessionsByRoom.get(row.room_id) ?? [];
    list.push(session);
    sessionsByRoom.set(row.room_id, list);
    if (!isBreak) {
      counts.sessions += 1;
      counts.speakers += speakerList.length;
      counts.arrived += session.arrived_count;
      if (slides.state === "received") counts.slides_received += 1;
      if (slides.state === "missing" || slides.state === "overdue" || slides.state === "done_without_file") {
        counts.slides_missing += 1;
      }
      if (slides.state === "overdue") counts.slides_overdue += 1;
    }
  }

  const roomList: RunOfShowRoom[] = rooms.results.map((room) => {
    const roomSessions = sessionsByRoom.get(room.id) ?? [];
    const current = roomSessions.find((session) => session.starts_at <= now && now < session.ends_at) ?? null;
    const next = roomSessions.find((session) => session.starts_at > now) ?? null;
    return {
      id: room.id,
      name: room.name,
      building_name: room.building_name,
      capacity: room.capacity,
      av_capabilities: parseAvCapabilities(room.av_capabilities),
      notes: room.notes,
      sessions: roomSessions,
      current_session_id: current?.id ?? null,
      next_session_id: next?.id ?? null,
    };
  });

  return {
    event,
    day,
    days: conferenceDays(event.starts_on, event.ends_on),
    is_today: calendarDateInTimezone(now, event.timezone) === day,
    generated_at: now,
    // A room with nothing on it today is not part of the run of show; the crew
    // scrolling a phone should reach the end of the real day, not a list of
    // empty halls.
    rooms: roomList.filter((room) => room.sessions.length > 0),
    counts,
  };
}

function parseAvCapabilities(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
