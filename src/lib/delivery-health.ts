/**
 * Delivery health — the derivations behind the organizer-facing health screen.
 *
 * Everything here is pure: facts in, organizer sentences out. The SQL that
 * gathers the facts lives in `src/routes/health-surface.routes.ts`; this module
 * imports no binding so the judgement calls (what counts as amber, what a
 * suppressed row means for a speaker) are unit-testable without a Worker.
 *
 * Two rules bind every string produced here:
 *
 *   1. Nothing technical reaches an organizer. No status codes, no SQL, no
 *      provider error text, no internal reason token. Each line says what
 *      happened and what to do about it.
 *   2. Amber and red are earned. A screen read by an anxious person during a
 *      decision wave has to be trusted, so an expected state (demo mode holding
 *      mail back exactly as configured) stays green and says so plainly.
 *
 *   3. A successful send means the message was accepted by the mail provider,
 *      not that it arrived. The screen says "delivered" only when the provider's
 *      signed delivery event has actually recorded that fact.
 */
import { classifySendFailure } from "./mail-failure";

/** Resend's free tier. A hard ceiling, not a cushion — a wave that exceeds it silently strands speakers. */
export const DAILY_SEND_LIMIT = 100;

/** A queued message older than this has stopped being "about to go out". */
export const QUEUE_PATIENCE_MS = 15 * 60_000;

/** Mirror rows that have retried this often are not going to drain on their own. */
export const MIRROR_STUCK_ATTEMPTS = 3;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type HealthLevel = "ok" | "warn" | "alarm" | "unknown";

export interface CapabilityStatus {
  id: string;
  label: string;
  level: HealthLevel;
  /** What is true right now, in one organizer sentence. */
  headline: string;
  /** What it means, or what to do about it. Always present so the row never changes height. */
  detail: string;
  href: string | null;
}

export type OwedState =
  | "never_prepared"
  | "waiting"
  | "waiting_too_long"
  | "held_back_demo"
  | "held_back"
  /** The provider is still retrying delivery; it is not a hard failure yet. */
  | "delivery_retrying"
  /** The send failed for a reason that lives on this speaker's address. */
  | "undelivered"
  /** The send failed for a reason that has nothing to do with this speaker. */
  | "send_blocked"
  | "no_address"
  | "changed_elsewhere";

export interface OwedFact {
  submission_id: string;
  submission_title: string;
  person_name: string | null;
  decided_at: number;
  resulting_status: string;
  outbox_status: "queued" | "sent" | "suppressed" | "failed" | null;
  outbox_created_at: number | null;
  suppressed_reason: string | null;
  has_error: boolean;
  /** The latest provider fact, or `unknown` before a provider webhook arrives. */
  delivery_state?: "unknown" | "delivered" | "bounced_hard" | "bounced_soft" | "complained" | null;
  /**
   * The provider's own words for why the send failed. Never rendered — it is
   * classified into an organizer sentence by `classifySendFailure`. Absent on a
   * fact gathered before this was carried, which reads as an unknown failure.
   */
  error_text?: string | null;
  has_valid_address: boolean;
  changed_elsewhere: boolean;
}

export interface OwedMessage {
  submission_id: string;
  submission_title: string;
  person_name: string;
  decision: string;
  decided_at: number;
  waiting_days: number;
  state: OwedState;
  level: HealthLevel;
  reason: string;
  what_to_do: string;
  href: string;
}

export interface OutboxFacts {
  queued: number;
  sent: number;
  suppressed: number;
  failed: number;
  /** Queued past the point where "any moment now" is still true. */
  stuck_queued: number;
  sent_last_7_days: number;
  last_sent_at: number | null;
}

/** Counts of provider delivery facts, kept separate from transport status. */
export interface DeliverySignalFacts {
  delivered: number;
  bounced_hard: number;
  bounced_soft: number;
  complained: number;
  unknown: number;
}

export interface QuotaFacts {
  sent_today: number;
  waiting: number;
}

export interface FormFact {
  id: string;
  name: string;
  status: string;
  opens_at: number | null;
  closes_at: number | null;
}

export interface CalendarFacts {
  invites_total: number;
  invites_unsent: number;
  invite_sends_failed: number;
}

export interface UploadFacts {
  files_held: number;
}

export interface MirrorFacts {
  configured: boolean;
  pending: number;
  stuck: number;
  last_sync_at: number | null;
  has_error: boolean;
}

export interface WebhookFacts {
  endpoints: number;
  failed: number;
  retrying: number;
  /** Inbound provider delivery facts; outbound endpoint counts remain above. */
  delivery?: DeliverySignalFacts;
}

export interface CronFact {
  id: string;
  /** null when the trigger has never run — reported, but not counted as broken. */
  last_success_at: number | null;
  /** Age measured where the heartbeat was read, which avoids reasoning across two clocks. */
  age_ms: number | null;
}

export interface InfrastructureFacts {
  reported: boolean;
  overall: "ok" | "degraded" | null;
  /** true = reachable, false = failing, null = not reported. */
  components: { storage: boolean | null; files: boolean | null; cache: boolean | null; queues: boolean | null };
  crons: readonly CronFact[];
}

export interface DeliveryHealthFacts {
  now: number;
  event_id: string;
  demo_mode: boolean;
  forms: readonly FormFact[];
  outbox: OutboxFacts;
  quota: QuotaFacts;
  owed: readonly OwedFact[];
  owed_total: number;
  calendar: CalendarFacts;
  uploads: UploadFacts;
  mirror: MirrorFacts;
  webhooks: WebhookFacts;
}

export interface SendQuota {
  sent_today: number;
  waiting: number;
  daily_limit: number;
  remaining: number;
  level: HealthLevel;
  headline: string;
  detail: string;
}

export interface OwedReasonCount {
  state: OwedState;
  level: HealthLevel;
  reason: string;
  count: number;
}

export interface DeliveryTotals {
  /**
   * Accepted by the mail provider. Deliberately not named `delivered`: whether
   * these arrived is reported over a provider webhook Marquee does not receive,
   * so the honest ceiling on this number is "handed over", not "landed".
   */
  sent: number;
  waiting: number;
  held_back: number;
  /** Never handed over at all — the sends that failed. */
  undelivered: number;
}

export interface DeliveryHealthSnapshot {
  generated_at: number;
  event_id: string;
  demo_mode: boolean;
  /**
   * Kept in the response for API compatibility. The speaker page uses the
   * explicit `summarizeSpeakerFollowups` derivation and the system page uses
   * `summarizeSystemHealth`; neither page races these two domains together.
   */
  summary: { level: HealthLevel; headline: string; detail: string };
  capabilities: readonly CapabilityStatus[];
  quota: SendQuota;
  totals: DeliveryTotals;
  owed: readonly OwedMessage[];
  /** Everyone owed a message, however many were carried into the ledger. */
  owed_total: number;
  /** How many of those need a person to act — the number the summary speaks. */
  owed_urgent: number;
  /** How many were actually judged. Below owed_total only on a conference past the scan bound. */
  owed_counted: number;
  /** The shape of the debt: how many are owed for each distinct reason. */
  owed_reasons: readonly OwedReasonCount[];
  owed_shown: number;
  owed_href: string;
  infrastructure_reported: boolean;
}

/** The ledger carries the worst rows; the counts always speak for the whole set. */
export const OWED_LEDGER_LIMIT = 50;

const LEVEL_RANK: Record<HealthLevel, number> = { ok: 0, unknown: 1, warn: 2, alarm: 3 };

/**
 * Within one level, the rarer and more particular failures come first. A
 * thousand decisions that were never sent are one action; the three that
 * bounced each need a person, and must not be buried under the thousand.
 */
const STATE_RANK: Record<OwedState, number> = {
  undelivered: 0,
  no_address: 1,
  send_blocked: 2,
  delivery_retrying: 3,
  held_back: 4,
  never_prepared: 5,
  changed_elsewhere: 6,
  waiting_too_long: 7,
  held_back_demo: 8,
  waiting: 9,
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

function daysSince(from: number, now: number): number {
  return Math.max(0, Math.floor((now - from) / DAY_MS));
}

/**
 * Reason tokens are internal vocabulary and never reach the screen; anything
 * unrecognized falls through to a sentence that is true of every case.
 */
/** Shared with the record's delivery card so both name a hold the same way. */
export function heldBackReason(reason: string | null): string {
  if (reason === "demo_mode_not_allowlisted") return "Held back while this conference was in demo mode.";
  if (reason === "acceptance_reversed") return "Cancelled because the acceptance was reversed.";
  return "Held back before it left the building.";
}

function decisionWord(resultingStatus: string): string {
  if (resultingStatus === "accepted") return "Accepted";
  if (resultingStatus === "rejected") return "Declined";
  if (resultingStatus === "waved") return "Waved";
  return "Decided";
}

interface OwedVerdict {
  state: OwedState;
  level: HealthLevel;
  reason: string;
  what_to_do: string;
}

/** One owed row's meaning. The ordering is deliberate: a hard failure outranks an expected hold. */
export function owedVerdict(fact: OwedFact, options: { now: number; demoMode: boolean }): OwedVerdict {
  const { now, demoMode } = options;
  if (fact.delivery_state === "bounced_hard") {
    return {
      state: "undelivered",
      level: "alarm",
      reason: "The mail service rejected this message after it was sent.",
      what_to_do: "Correct the address on this speaker's record, then send the decision again.",
    };
  }
  if (fact.delivery_state === "complained") {
    return {
      state: "undelivered",
      level: "alarm",
      reason: "The recipient marked this message as unwanted.",
      what_to_do: "Confirm the address with this speaker before sending the decision again.",
    };
  }
  if (fact.delivery_state === "bounced_soft") {
    return {
      state: "delivery_retrying",
      level: "warn",
      reason: "The mail service is still trying to deliver this message.",
      what_to_do: "Nothing to do yet — we will tell you if it stops.",
    };
  }
  if (fact.outbox_status === "failed" || (fact.outbox_status === null && fact.has_error)) {
    // The provider's text says which of these it was; the organizer never sees
    // that text, only the sentence it maps to and the action that follows.
    const failure = classifySendFailure(fact.error_text);
    return {
      state: failure.scope === "conference" ? "send_blocked" : "undelivered",
      level: "alarm",
      reason: failure.reason,
      what_to_do: failure.what_to_do,
    };
  }
  if (!fact.has_valid_address) {
    return {
      state: "no_address",
      level: "alarm",
      reason: "There is no usable email address on file.",
      what_to_do: "Add an address to this speaker's record, then open the record and choose Send decision again.",
    };
  }
  if (fact.outbox_status === "suppressed") {
    const demoHold = fact.suppressed_reason === "demo_mode_not_allowlisted";
    if (demoHold && demoMode) {
      return {
        state: "held_back_demo",
        level: "ok",
        reason: "Held back on purpose — this conference is in demo mode.",
        what_to_do: "Nothing to do. Open the message in Communications to read exactly what this speaker would have received.",
      };
    }
    return {
      state: "held_back",
      level: "alarm",
      reason: heldBackReason(fact.suppressed_reason),
      what_to_do: "Open the record and choose Send decision again once the reason no longer applies.",
    };
  }
  if (fact.outbox_status === "queued") {
    const age = now - (fact.outbox_created_at ?? now);
    if (age > QUEUE_PATIENCE_MS) {
      return {
        state: "waiting_too_long",
        level: "warn",
        reason: "Written and waiting longer than it should be.",
        what_to_do: "Give it a few minutes. If it is still here, open the record and choose Send decision again.",
      };
    }
    return {
      state: "waiting",
      level: "ok",
      reason: "Written and on its way out.",
      what_to_do: "Nothing to do — this one is in flight.",
    };
  }
  if (fact.changed_elsewhere) {
    return {
      state: "changed_elsewhere",
      level: "warn",
      reason: "The record changed in Airtable after the decision was made.",
      what_to_do: "Open the record, confirm the decision still stands, then choose Send decision again.",
    };
  }
  return {
    state: "never_prepared",
    level: "alarm",
    reason: "The decision is recorded but no message was ever written.",
    what_to_do: "Open the record and choose Send decision again — this speaker does not know yet.",
  };
}

export function deriveOwed(
  facts: readonly OwedFact[],
  options: { now: number; demoMode: boolean },
): OwedMessage[] {
  return facts
    .map((fact) => {
      const verdict = owedVerdict(fact, options);
      return {
        submission_id: fact.submission_id,
        submission_title: fact.submission_title,
        person_name: fact.person_name ?? "Speaker not named",
        decision: decisionWord(fact.resulting_status),
        decided_at: fact.decided_at,
        waiting_days: daysSince(fact.decided_at, options.now),
        state: verdict.state,
        level: verdict.level,
        reason: verdict.reason,
        what_to_do: verdict.what_to_do,
        href: `/submissions/${fact.submission_id}`,
      };
    })
    .sort((left, right) =>
      LEVEL_RANK[right.level] - LEVEL_RANK[left.level]
      || STATE_RANK[left.state] - STATE_RANK[right.state]
      || left.decided_at - right.decided_at,
    );
}

/** The distinct reasons people are waiting, worst first — the shape of the debt in one line. */
export function summarizeOwedReasons(rows: readonly OwedMessage[]): OwedReasonCount[] {
  // Keyed on the sentence, not just the state: one state can carry several
  // distinct reasons (a rejected address and a suppressed one are both
  // `undelivered`), and collapsing them would print one of them over the other.
  const byReason = new Map<string, OwedReasonCount>();
  for (const row of rows) {
    const key = `${row.state}|${row.reason}`;
    const existing = byReason.get(key);
    if (existing) existing.count += 1;
    else byReason.set(key, { state: row.state, level: row.level, reason: row.reason, count: 1 });
  }
  return [...byReason.values()].sort((left, right) =>
    LEVEL_RANK[right.level] - LEVEL_RANK[left.level]
    || STATE_RANK[left.state] - STATE_RANK[right.state]
    // Two reasons can share a state, so the order needs a tiebreak of its own:
    // the bigger group first, then alphabetical so the list never reshuffles
    // between two loads that found the same thing.
    || right.count - left.count
    || left.reason.localeCompare(right.reason),
  );
}

export function deriveQuota(facts: QuotaFacts, limit = DAILY_SEND_LIMIT): SendQuota {
  const sentToday = Math.max(0, facts.sent_today);
  const waiting = Math.max(0, facts.waiting);
  const remaining = Math.max(0, limit - sentToday);
  const shortfall = Math.max(0, waiting - remaining);
  const detailTail = `${count(sentToday)} of ${count(limit)} sent today · ${count(remaining)} left`;
  const sourceNote = "This allowance comes from your connected email configuration. A conference using its own production Resend key sets its own ceiling.";

  if (remaining === 0) {
    return {
      sent_today: sentToday,
      waiting,
      daily_limit: limit,
      remaining,
      level: "alarm",
      headline: "Today's send allowance is used up.",
      detail: waiting > 0
        ? `${count(waiting)} ${plural(waiting, "message is", "messages are")} waiting and none can go out until tomorrow. ${detailTail}. ${sourceNote}`
        : `Anything sent now waits until tomorrow. ${detailTail}. ${sourceNote}`,
    };
  }
  if (shortfall > 0) {
    return {
      sent_today: sentToday,
      waiting,
      daily_limit: limit,
      remaining,
      level: "alarm",
      headline: `${count(shortfall)} ${plural(shortfall, "speaker would not", "speakers would not")} hear from you today.`,
      detail: `${count(waiting)} ${plural(waiting, "message is", "messages are")} waiting and only ${count(remaining)} can go out. Send the rest tomorrow, or split the wave. ${detailTail}. ${sourceNote}`,
    };
  }
  if (sentToday + waiting >= limit * 0.8) {
    return {
      sent_today: sentToday,
      waiting,
      daily_limit: limit,
      remaining,
      level: "warn",
      headline: "Today's send allowance is nearly spent.",
      detail: `A wave larger than ${count(remaining)} ${plural(remaining, "message", "messages")} will not finish today. ${detailTail}. ${sourceNote}`,
    };
  }
  return {
    sent_today: sentToday,
    waiting,
    daily_limit: limit,
    remaining,
    level: "ok",
    headline: "There is room to send today.",
    detail: `A wave of up to ${count(remaining)} ${plural(remaining, "message", "messages")} goes out today. ${detailTail}. ${sourceNote}`,
  };
}

interface CronMeta {
  label: string;
  interval_ms: number;
  what: string;
}

const CRON_META: Record<string, CronMeta> = {
  "0 * * * *": { label: "Deadline reminders", interval_ms: HOUR_MS, what: "reminder emails before your form closes" },
  "15 4 * * *": { label: "Airtable keepalive", interval_ms: DAY_MS, what: "the nightly Airtable connection renewal" },
  "30 4 * * *": { label: "File cleanup", interval_ms: DAY_MS, what: "the nightly cleanup of abandoned uploads" },
};

function cronMeta(id: string): CronMeta {
  return CRON_META[id] ?? { label: "Scheduled job", interval_ms: DAY_MS, what: "a scheduled background job" };
}

function scheduledCapability(infrastructure: InfrastructureFacts, now: number): CapabilityStatus {
  const base = { id: "scheduled", label: "Scheduled jobs", href: "/settings" as string | null };
  if (!infrastructure.reported || infrastructure.crons.length === 0) {
    return {
      ...base,
      level: "unknown",
      headline: "Not reported yet.",
      detail: "Background jobs have not checked in since this screen was opened. Reload in a few minutes.",
    };
  }
  const late = infrastructure.crons
    .map((cron) => ({ cron, meta: cronMeta(cron.id) }))
    .map(({ cron, meta }) => {
      if (cron.last_success_at === null) return { meta, level: "unknown" as HealthLevel, age: 0 };
      // Prefer the age the reporter measured; two clocks are one too many.
      const age = cron.age_ms ?? now - cron.last_success_at;
      const level: HealthLevel = age > meta.interval_ms * 3 ? "alarm" : age > meta.interval_ms * 1.5 ? "warn" : "ok";
      return { meta, level, age };
    })
    .sort((left, right) => LEVEL_RANK[right.level] - LEVEL_RANK[left.level]);
  const worstJob = late[0];
  if (worstJob === undefined || worstJob.level === "ok") {
    return { ...base, level: "ok", headline: "Running on schedule.", detail: `All ${count(infrastructure.crons.length)} background ${plural(infrastructure.crons.length, "job is", "jobs are")} checking in on time.` };
  }
  if (worstJob.level === "unknown") {
    return { ...base, level: "unknown", headline: "Not reported yet.", detail: `${worstJob.meta.label} has not checked in since the last deploy. Nothing is known to be wrong.` };
  }
  const hours = Math.max(1, Math.floor(worstJob.age / HOUR_MS));
  return {
    ...base,
    level: worstJob.level,
    headline: `${worstJob.meta.label} has not run in ${count(hours)} ${plural(hours, "hour", "hours")}.`,
    detail: worstJob.level === "alarm"
      ? `That job sends ${worstJob.meta.what}. Speakers are not getting it. Reach out to whoever hosts this conference for you.`
      : `That job sends ${worstJob.meta.what}. It is late, not missing — check again in an hour.`,
  };
}

function storageCapability(infrastructure: InfrastructureFacts): CapabilityStatus {
  const base = { id: "storage", label: "Your conference data", href: null };
  if (infrastructure.components.storage === false) {
    return {
      ...base,
      level: "alarm",
      headline: "The system cannot reach your conference data.",
      detail: "Screens will fail to load until this clears. Reach out to whoever hosts this conference for you.",
    };
  }
  if (infrastructure.components.storage === true) {
    return { ...base, level: "ok", headline: "Your conference data is reachable.", detail: "Every screen is reading live from your own store." };
  }
  return {
    ...base,
    level: "unknown",
    headline: "Not reported yet.",
    detail: "This screen loaded, so your data is reachable — the system has just not filed its own report.",
  };
}

function submissionsCapability(facts: DeliveryHealthFacts): CapabilityStatus {
  const base = { id: "submissions", label: "Accepting submissions", href: "/forms" as string | null };
  const open = facts.forms.filter((form) => form.status === "open");
  const expired = open.filter((form) => form.closes_at !== null && form.closes_at < facts.now);
  const live = open.filter((form) => !expired.includes(form));
  if (expired.length > 0 && live.length === 0) {
    return {
      ...base,
      level: "warn",
      headline: `${count(expired.length)} ${plural(expired.length, "form is", "forms are")} past the closing date but still marked open.`,
      detail: "Speakers can still submit. Close the form, or move its closing date.",
    };
  }
  if (live.length === 0) {
    return {
      ...base,
      level: "ok",
      headline: "Your call for speakers is closed.",
      detail: facts.forms.length === 0
        ? "No submission form has been built yet. Nothing is broken."
        : `${count(facts.forms.length)} ${plural(facts.forms.length, "form exists", "forms exist")} and none are accepting right now.`,
    };
  }
  const nextClose = live
    .map((form) => form.closes_at)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)[0];
  return {
    ...base,
    level: "ok",
    headline: `${count(live.length)} ${plural(live.length, "form is", "forms are")} accepting submissions.`,
    detail: nextClose === undefined
      ? "No closing date is set, so the form stays open until you close it."
      : `The next one closes in ${count(Math.max(0, Math.ceil((nextClose - facts.now) / DAY_MS)))} days.`,
  };
}

function emailCapability(facts: DeliveryHealthFacts): CapabilityStatus {
  const base = { id: "email", label: "Sending email", href: "/communications" as string | null };
  const delivery = facts.webhooks.delivery ?? {
    delivered: 0,
    bounced_hard: 0,
    bounced_soft: 0,
    complained: 0,
    unknown: 0,
  };
  if (facts.outbox.failed > 0) {
    return {
      ...base,
      level: "alarm",
      // "Could not be sent", never "came back": these are messages that never
      // left. What came back after a successful send is not something this
      // screen is told.
      headline: `${count(facts.outbox.failed)} ${plural(facts.outbox.failed, "message", "messages")} could not be sent.`,
      detail: "Those messages never left the connected mail account. Check the mail configuration before trying again.",
    };
  }
  const addressFailures = delivery.bounced_hard + delivery.complained;
  if (addressFailures > 0) {
    return {
      ...base,
      level: "alarm",
      headline: `${count(addressFailures)} ${plural(addressFailures, "message did not", "messages did not")} reach the recipient.`,
      detail: "Those messages were rejected after sending. Work the follow-up list to confirm the address before trying again.",
    };
  }
  if (delivery.bounced_soft > 0) {
    return {
      ...base,
      level: "warn",
      headline: `${count(delivery.bounced_soft)} ${plural(delivery.bounced_soft, "message is", "messages are")} still being tried by the mail service.`,
      detail: "Nothing is wrong yet. We will tell you if the service stops trying to deliver them.",
    };
  }
  if (delivery.unknown > 0) {
    return {
      ...base,
      level: "unknown",
      headline: "Your mail provider does not report delivery.",
      detail: `${count(delivery.unknown)} ${plural(delivery.unknown, "message was", "messages were")} accepted for sending, but no arrival signal has come back yet.`,
    };
  }
  if (facts.outbox.stuck_queued > 0) {
    return {
      ...base,
      level: "warn",
      headline: `${count(facts.outbox.stuck_queued)} ${plural(facts.outbox.stuck_queued, "message has", "messages have")} been waiting to go out longer than expected.`,
      detail: "Mail usually leaves within a minute or two. Check back shortly before resending anything.",
    };
  }
  if (facts.demo_mode) {
    return {
      ...base,
      level: "ok",
      headline: "Email is held back on purpose — this conference is in demo mode.",
      detail: `${count(facts.outbox.suppressed)} ${plural(facts.outbox.suppressed, "message is", "messages are")} written and logged in Communications, where you can read exactly what each one would have said.`,
    };
  }
  return {
    ...base,
    level: "ok",
    headline: "Email is reaching your speakers.",
    detail: `${count(facts.outbox.sent_last_7_days)} ${plural(facts.outbox.sent_last_7_days, "message", "messages")} sent in the last seven days · ${count(facts.outbox.queued)} waiting.`,
  };
}

function calendarCapability(facts: DeliveryHealthFacts): CapabilityStatus {
  const base = { id: "calendar", label: "Calendar invites", href: "/agenda-builder" as string | null };
  if (facts.calendar.invite_sends_failed > 0) {
    return {
      ...base,
      level: "alarm",
      headline: `${count(facts.calendar.invite_sends_failed)} calendar ${plural(facts.calendar.invite_sends_failed, "invite", "invites")} did not reach the speaker.`,
      detail: "Those speakers have no session in their calendar. Open the sessions below and send the invite again.",
    };
  }
  if (facts.calendar.invites_unsent > 0) {
    return {
      ...base,
      level: "warn",
      headline: `${count(facts.calendar.invites_unsent)} ${plural(facts.calendar.invites_unsent, "invite has", "invites have")} not gone out yet.`,
      detail: "Scheduled sessions send an invite when they are published. These are still waiting.",
    };
  }
  if (facts.calendar.invites_total === 0) {
    return { ...base, level: "ok", headline: "No calendar invites yet.", detail: "Invites go out once sessions are scheduled and published." };
  }
  return {
    ...base,
    level: "ok",
    headline: `${count(facts.calendar.invites_total)} ${plural(facts.calendar.invites_total, "invite is", "invites are")} in speakers' calendars.`,
    detail: "Every scheduled session has reached the people presenting it.",
  };
}

function uploadsCapability(facts: DeliveryHealthFacts, infrastructure: InfrastructureFacts): CapabilityStatus {
  const base = { id: "uploads", label: "Speaker uploads", href: "/onboarding" as string | null };
  if (infrastructure.components.files === false) {
    return {
      ...base,
      level: "alarm",
      headline: "Speakers cannot upload files right now.",
      detail: "Headshots and slides will fail while this lasts. Reach out to whoever hosts this conference for you.",
    };
  }
  if (!infrastructure.reported) {
    return {
      ...base,
      level: "unknown",
      headline: "Not reported yet.",
      detail: `${count(facts.uploads.files_held)} ${plural(facts.uploads.files_held, "file is", "files are")} stored for this conference. File storage has not checked in.`,
    };
  }
  return {
    ...base,
    level: "ok",
    headline: "Speakers can upload files.",
    detail: `${count(facts.uploads.files_held)} ${plural(facts.uploads.files_held, "file is", "files are")} stored for this conference.`,
  };
}

function mirrorCapability(facts: DeliveryHealthFacts): CapabilityStatus {
  // No link: the mirror is configured where the conference is hosted, not from
  // a screen inside Marquee. A row that promised one would land nowhere.
  const base = { id: "mirror", label: "Airtable sync", href: null as string | null };
  if (!facts.mirror.configured) {
    return { ...base, level: "ok", headline: "Airtable is not connected.", detail: "Nothing to sync. This conference is not mirroring to Airtable." };
  }
  if (facts.mirror.stuck > 0) {
    return {
      ...base,
      level: "alarm",
      headline: `${count(facts.mirror.stuck)} ${plural(facts.mirror.stuck, "change is", "changes are")} stuck and not reaching Airtable.`,
      detail: "Your Airtable base is behind. Anyone working there is looking at old information.",
    };
  }
  if (facts.mirror.pending > 0) {
    return {
      ...base,
      level: "warn",
      headline: `${count(facts.mirror.pending)} ${plural(facts.mirror.pending, "change is", "changes are")} still on their way to Airtable.`,
      detail: "Sync runs continuously. If this number is not falling, your base is drifting behind.",
    };
  }
  return {
    ...base,
    level: "ok",
    headline: "Airtable is up to date.",
    detail: facts.mirror.last_sync_at === null
      ? "Nothing is waiting to sync."
      : `Nothing is waiting to sync · last synced ${describeAge(facts.now - facts.mirror.last_sync_at)}.`,
  };
}

function webhooksCapability(facts: DeliveryHealthFacts): CapabilityStatus {
  const base = { id: "webhooks", label: "Connected tools", href: "/settings" as string | null };
  if (facts.webhooks.endpoints === 0) {
    return { ...base, level: "ok", headline: "No other tools are connected.", detail: "Nothing to notify. Connect one in settings if another tool needs to hear about your program." };
  }
  if (facts.webhooks.failed > 0) {
    return {
      ...base,
      level: "warn",
      headline: `${count(facts.webhooks.failed)} ${plural(facts.webhooks.failed, "update", "updates")} never reached your other tools.`,
      detail: "Your speakers are unaffected. Whatever you connected is showing older information than this screen.",
    };
  }
  if (facts.webhooks.retrying > 0) {
    return {
      ...base,
      level: "warn",
      headline: `${count(facts.webhooks.retrying)} ${plural(facts.webhooks.retrying, "update is", "updates are")} being retried.`,
      detail: "The other tool is not answering right now. Retries keep going on their own.",
    };
  }
  return {
    ...base,
    level: "ok",
    headline: `${count(facts.webhooks.endpoints)} connected ${plural(facts.webhooks.endpoints, "tool is", "tools are")} up to date.`,
    detail: "Everything this conference has published has been handed on.",
  };
}

export function describeAge(ageMs: number): string {
  if (ageMs < 90_000) return "moments ago";
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) return `${count(minutes)} ${plural(minutes, "minute", "minutes")} ago`;
  const hours = Math.round(ageMs / HOUR_MS);
  if (hours < 48) return `${count(hours)} ${plural(hours, "hour", "hours")} ago`;
  const days = Math.round(ageMs / DAY_MS);
  return `${count(days)} ${plural(days, "day", "days")} ago`;
}

/**
 * The infrastructure report from the telemetry diagnostics endpoint, read
 * defensively: the screen degrades to "not reported yet" rather than guessing,
 * and never treats a shape it does not recognize as a failure.
 */
export function readInfrastructure(payload: unknown): InfrastructureFacts {
  const empty: InfrastructureFacts = {
    reported: false,
    overall: null,
    components: { storage: null, files: null, cache: null, queues: null },
    crons: [],
  };
  if (payload === null || typeof payload !== "object") return empty;
  const source = payload as Record<string, unknown>;
  const checks = pickRecord(source, ["checks", "components", "bindings", "resources"]);
  const probes = readProbes(source);
  const overallRaw = typeof source.status === "string" ? source.status : null;
  return {
    reported: true,
    overall: overallRaw === "ok" || overallRaw === "degraded" ? overallRaw : null,
    components: {
      storage: componentHealth(checks, ["d1", "database", "db", "storage"], probes),
      files: componentHealth(checks, ["r2", "media", "files", "bucket"], probes),
      cache: componentHealth(checks, ["kv", "cache"], probes),
      queues: componentHealth(checks, ["queues", "queue"], probes),
    },
    crons: readCrons(source),
  };
}

/** The probe list as the telemetry surface reports it: one named verdict per binding. */
function readProbes(source: Record<string, unknown>): Record<string, unknown>[] {
  const list = [source.probes, source.checks, source.components].find((value) => Array.isArray(value));
  if (!Array.isArray(list)) return [];
  return list.filter((entry): entry is Record<string, unknown> =>
    entry !== null && typeof entry === "object" && typeof (entry as Record<string, unknown>).name === "string",
  );
}

function pickRecord(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  for (const key of keys) {
    const value = source[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return source;
}

function componentHealth(
  checks: Record<string, unknown>,
  keys: readonly string[],
  probes: readonly Record<string, unknown>[],
): boolean | null {
  for (const key of keys) {
    const probe = probes.find((entry) => entry.name === key);
    if (probe && typeof probe.ok === "boolean") return probe.ok;
    const value = checks[key];
    if (value === undefined) continue;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return healthyWord(value);
    if (value !== null && typeof value === "object") {
      const entry = value as Record<string, unknown>;
      if (typeof entry.ok === "boolean") return entry.ok;
      if (typeof entry.healthy === "boolean") return entry.healthy;
      if (typeof entry.bound === "boolean") return entry.bound;
      if (typeof entry.status === "string") return healthyWord(entry.status);
      // A latency reading with no verdict still proves the component answered.
      if (typeof entry.latency_ms === "number" || typeof entry.duration_ms === "number") return true;
    }
  }
  return null;
}

function healthyWord(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (["ok", "up", "healthy", "pass", "available", "bound", "true"].includes(normalized)) return true;
  if (["degraded", "down", "error", "fail", "failed", "unavailable", "missing", "false"].includes(normalized)) return false;
  return null;
}

function readCrons(source: Record<string, unknown>): CronFact[] {
  const candidates = [source.crons, source.cron_heartbeats, source.cronHeartbeats, source.schedules];
  const nested = pickRecord(source, ["checks", "components"]);
  candidates.push(nested.crons, nested.cron_heartbeats);
  const list = candidates.find((value) => Array.isArray(value)) as unknown[] | undefined;
  if (!list) return [];
  return list.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const id = [row.cron, row.id, row.schedule, row.trigger].find((value) => typeof value === "string");
    if (typeof id !== "string") return [];
    const lastSuccess = [row.last_success_at, row.lastSuccessAt, row.last_success, row.last_run_at]
      .find((value) => typeof value === "number");
    // A trigger that has never run reports zero. That is "never", not "in 1970".
    const stamped = typeof lastSuccess === "number" && lastSuccess > 0 ? lastSuccess : null;
    const age = typeof row.age_ms === "number" ? row.age_ms : null;
    return [{ id, last_success_at: stamped, age_ms: stamped === null ? null : age }];
  });
}

export interface HealthSummary {
  level: HealthLevel;
  headline: string;
  detail: string;
}

/**
 * The people page has one job: show who has not heard from the organizer and
 * whether the connected mail account can carry the next wave. Capability rows
 * are intentionally absent from this derivation.
 */
export function summarizeSpeakerFollowups(
  owedTotal: number,
  owedUrgent: number,
  waitingCount: number,
  quota: SendQuota,
  sentLast7Days = 0,
  delivery: DeliverySignalFacts = { delivered: 0, bounced_hard: 0, bounced_soft: 0, complained: 0, unknown: 0 },
): HealthSummary {
  if (owedTotal > 0) {
    const level = owedUrgent > 0 || quota.level === "alarm"
      ? "alarm"
      : quota.level === "warn" || delivery.bounced_soft > 0 ? "warn" : "ok";
    return {
      level,
      headline: `${count(owedTotal)} ${plural(owedTotal, "speaker has", "speakers have")} not heard from you.`,
      detail: owedUrgent > 0
        ? "Their decision is recorded and the message has not reached them. Open the follow-up list — each row opens its record."
        : quota.level === "alarm"
          ? "Today's send allowance will not carry these messages. See the allowance below, then open the follow-up list to see the exact state."
          : delivery.bounced_soft > 0
            ? "The mail service is still trying some of these messages. We will tell you if it stops."
          : "These messages are still in flight or held on purpose. Open the follow-up list to see the exact state.",
    };
  }
  if (quota.level === "alarm") return { level: "alarm", headline: quota.headline, detail: quota.detail };
  if (quota.level === "warn") return { level: "warn", headline: quota.headline, detail: quota.detail };
  if (delivery.unknown > 0) {
    return {
      level: "unknown",
      headline: "Your mail provider does not report delivery.",
      detail: "Messages have been accepted for sending, but this provider has not supplied an arrival signal. Nothing here claims they reached a mailbox.",
    };
  }
  return {
    level: "ok",
    headline: "Everyone who has been decided has been told.",
    detail: waitingCount === 0
      ? `${count(sentLast7Days)} ${plural(sentLast7Days, "message", "messages")} sent in the last seven days. Nothing is stuck.`
      : `${count(waitingCount)} ${plural(waitingCount, "message is", "messages are")} in flight and nothing is stuck.`,
  };
}

/**
 * The system page has one job: report capability and infrastructure health.
 * It never receives owed-speaker or quota facts, so a person-facing gap cannot
 * become its headline.
 */
export function summarizeSystemHealth(capabilities: readonly CapabilityStatus[]): HealthSummary {
  const failing = capabilities.find((capability) => capability.level === "alarm");
  if (failing) return { level: "alarm", headline: failing.headline, detail: failing.detail };
  const warning = capabilities.find((capability) => capability.level === "warn");
  if (warning) return { level: "warn", headline: warning.headline, detail: warning.detail };
  const unknown = capabilities.find((capability) => capability.level === "unknown");
  if (unknown) return { level: "unknown", headline: `The ${unknown.label} check has not reported yet.`, detail: unknown.detail };
  return {
    level: "ok",
    headline: "System health is clear.",
    detail: "All eight capability checks are reporting normally.",
  };
}

export function deriveDeliveryHealth(
  facts: DeliveryHealthFacts,
  infrastructure: InfrastructureFacts,
  ledgerLimit = OWED_LEDGER_LIMIT,
): DeliveryHealthSnapshot {
  // Every owed row is judged; only the worst are carried into the ledger. The
  // counts must speak for the whole set, or a capped page understates the
  // number of people waiting — which is the one thing this screen cannot do.
  const judged = deriveOwed(facts.owed, { now: facts.now, demoMode: facts.demo_mode });
  const urgent = judged.filter((row) => row.level === "alarm").length;
  const owed = judged.slice(0, ledgerLimit);
  const quota = deriveQuota(facts.quota);
  const delivery = facts.webhooks.delivery ?? { delivered: 0, bounced_hard: 0, bounced_soft: 0, complained: 0, unknown: 0 };
  // Eight rows, always, in this order. The screen refreshes under the reader,
  // so a capability never appears or disappears — only its words change.
  const capabilities: readonly CapabilityStatus[] = [
    storageCapability(infrastructure),
    submissionsCapability(facts),
    emailCapability(facts),
    calendarCapability(facts),
    uploadsCapability(facts, infrastructure),
    mirrorCapability(facts),
    webhooksCapability(facts),
    scheduledCapability(infrastructure, facts.now),
  ];
  return {
    generated_at: facts.now,
    event_id: facts.event_id,
    demo_mode: facts.demo_mode,
    summary: summarizeSpeakerFollowups(facts.owed_total, urgent, quota.waiting, quota, facts.outbox.sent_last_7_days, delivery),
    capabilities,
    quota,
    totals: {
      sent: facts.outbox.sent,
      waiting: facts.outbox.queued,
      held_back: facts.outbox.suppressed,
      undelivered: facts.outbox.failed,
    },
    owed,
    owed_total: facts.owed_total,
    owed_urgent: urgent,
    owed_counted: judged.length,
    owed_reasons: summarizeOwedReasons(judged),
    owed_shown: owed.length,
    owed_href: "/submissions?status=not_notified",
    infrastructure_reported: infrastructure.reported,
  };
}
