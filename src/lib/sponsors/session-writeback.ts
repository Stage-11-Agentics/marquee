/**
 * What a sponsor deliverable writes beyond its own answers.
 *
 * The sponsor portal has exactly one write path — the task machinery
 * (`sponsors-design.md` §5.2 ruling 3). Sessions are read-only cards there, and
 * the company profile is editable only through its own narrow route. So the
 * three deliverables that are *about* something else have to reach that
 * something else on completion, or the ruling is a promise the product does not
 * keep: a sponsor completes "Name your speaker", the task goes green, and the
 * Session still says nobody is speaking.
 *
 * Dispatch is by template identity, exactly as the speaker portal's
 * `FINALIZE_TALK_TEMPLATE_ID` already does it. A template that is not one of the
 * three writes nothing extra, so an ordinary sponsor form task behaves exactly
 * like an ordinary speaker one.
 *
 * These statements are produced BEFORE the completion UPDATE runs, deliberately.
 * D1 gives no transaction across both, and of the two possible half-states the
 * survivable one is "the Session was filled, the task is still open" — the
 * sponsor retries and every write here is idempotent. The other order would
 * leave a green task beside an empty Session, which is the dead end this whole
 * ruling exists to prevent.
 */

import { newUlid } from "../../api/ids";
import { ApiError } from "../../api/errors";
import { auditStatement } from "../audit";
import { reconcileTaskSet } from "../../jobs/cascade/decisions";
import { PUBLISHED_PARTICIPANT_REFUSAL, isPublishedSession } from "../publication-guard";
import { SPONSOR_WRITEBACK_TEMPLATE_IDS } from "./deliverable-templates";

export { SPONSOR_WRITEBACK_TEMPLATE_IDS };

export interface SponsorWritebackTask {
  id: string;
  event_id: string;
  template_id: string;
  submission_id: string | null;
  sponsorship_id: string | null;
}

export interface SponsorWritebackInput {
  db: D1Database;
  orgId: string;
  task: SponsorWritebackTask;
  answers: Record<string, unknown>;
  actorPersonId: string;
  requestId: string | null;
  now: number;
}

function text(answers: Record<string, unknown>, key: string): string | null {
  const value = answers[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Fill the Session's speaker.
 *
 * The named person becomes a real speaker of this conference, not a string on a
 * card: a `people` row (found by email or created) and a `speaker` participation.
 * Their membership and their onboarding task set are then minted by
 * `reconcileTaskSet` — the same idempotent reconciliation the acceptance
 * boundary runs — so the deliverable's own promise comes true literally: they
 * get their speaker portal with their bio, headshot, and A/V tasks in it. A
 * hand-written membership row here would have given them the seat and left the
 * portal empty.
 *
 * No mail is sent. Inviting is the organizer's existing machinery, and a portal
 * task completion is not the place to start mailing strangers.
 */
async function nameSpeakerStatements(input: SponsorWritebackInput): Promise<D1PreparedStatement[]> {
  const { db, task, answers, now } = input;
  if (!task.submission_id) return [];
  const name = text(answers, "speaker_name");
  const email = text(answers, "speaker_email");
  if (!name || !email) return [];

  // The submission must belong to THIS deal, not merely to this conference.
  // `task-access.ts` proves the caller holds the sponsorship; nothing proves the
  // task's two nullable joins agree, and they are independent columns. Today only
  // the seed writes both, and it pairs them correctly — but the day anything else
  // can set them (organizer-side sponsor task authoring, a bulk edit) a mismatched
  // pair would let a contact rewrite a stranger's Session or add a speaker to it.
  const submission = await db
    .prepare("SELECT id FROM submissions WHERE id = ? AND event_id = ? AND sponsorship_id = ?")
    .bind(task.submission_id, task.event_id, task.sponsorship_id)
    .first<{ id: string }>();
  if (!submission) return [];

  // `lower(email)` on both sides: `Nadia@…` and `nadia@…` are one human, and an
  // exact match would mint a duplicate person for the same speaker.
  const existing = await db
    .prepare("SELECT id FROM people WHERE org_id = ? AND lower(email) = lower(?) ORDER BY id LIMIT 1")
    .bind(input.orgId, email)
    .first<{ id: string }>();

  const statements: D1PreparedStatement[] = [];
  const personId = existing?.id ?? newUlid(now);
  const title = text(answers, "speaker_title");
  if (existing) {
    // An existing person's own record is theirs. Only fill what is empty — a
    // sponsor typing a job title must never overwrite a bio or a title the
    // speaker already curated on their own profile.
    statements.push(
      db.prepare(
        `UPDATE people
         SET title = COALESCE(NULLIF(TRIM(COALESCE(title, '')), ''), ?),
             last_write_source = 'marquee', updated_at = ?
         WHERE id = ? AND org_id = ?`,
      ).bind(title, now, personId, input.orgId),
    );
  } else {
    statements.push(
      db.prepare(
        `INSERT INTO people (id, org_id, email, name, title, is_demo, last_write_source, social_links, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 'marquee', '[]', ?, ?)`,
      ).bind(personId, input.orgId, email, name, title, now, now),
    );
  }

  statements.push(
    db.prepare(
      `INSERT INTO participations
         (id, submission_id, person_id, role, position, confirmation_status, confirmed_at, invited_at, created_at, updated_at)
       VALUES (?, ?, ?, 'speaker', 0, 'pending', NULL, NULL, ?, ?)
       ON CONFLICT (person_id, submission_id, role) DO NOTHING`,
    ).bind(newUlid(now), task.submission_id, personId, now, now),
  );
  statements.push(
    auditStatement(db, {
      eventId: task.event_id,
      actorKind: "user",
      actorPersonId: input.actorPersonId,
      action: "sponsor_session_speaker_named",
      entityType: "submission",
      entityId: task.submission_id,
      after: { person_id: personId, name, email, task_id: task.id },
      now,
      requestId: input.requestId,
    }),
  );
  return statements;
}

/**
 * Fill the Session's title and description.
 *
 * The audit action is `speaker_talk_updated` — the same one the speaker portal
 * writes — so a Session's content history reads as one story regardless of which
 * portal edited it, rather than splitting into two vocabularies for the same act.
 */
async function sessionContentStatements(input: SponsorWritebackInput): Promise<D1PreparedStatement[]> {
  const { db, task, answers, now } = input;
  if (!task.submission_id) return [];
  // Same scoping as the speaker write-back above, for the same reason.
  const current = await db
    .prepare("SELECT id, title, abstract FROM submissions WHERE id = ? AND event_id = ? AND sponsorship_id = ?")
    .bind(task.submission_id, task.event_id, task.sponsorship_id)
    .first<{ id: string; title: string; abstract: string | null }>();
  if (!current) return [];
  const title = text(answers, "session_title") ?? current.title;
  const description = text(answers, "session_description") ?? current.abstract;
  if (title === current.title && description === current.abstract) return [];
  if (await isPublishedSession(db, task.event_id, current.id)) {
    // Sponsor contacts cannot unpublish or reverse an acceptance; leaving the
    // task open gives them a recoverable retry once the organizer changes state.
    throw ApiError.conflict(PUBLISHED_PARTICIPANT_REFUSAL);
  }
  return [
    db.prepare(
      `UPDATE submissions
       SET title = ?, abstract = ?, last_saved_at = ?, last_write_source = 'marquee', updated_at = ?
       WHERE id = ? AND event_id = ?`,
    ).bind(title, description, now, now, current.id, task.event_id),
    auditStatement(db, {
      eventId: task.event_id,
      actorKind: "user",
      actorPersonId: input.actorPersonId,
      action: "speaker_talk_updated",
      entityType: "submission",
      entityId: current.id,
      before: { title: current.title, description: current.abstract },
      after: { title, description },
      now,
      requestId: input.requestId,
    }),
  ];
}

/**
 * Confirm the company's public facts.
 *
 * These are ORG-LEVEL: they carry to every conference this company sponsors,
 * which is the whole reason `companies` sits above `sponsorships`. This is why
 * the deliverable replaces a public intake form (ruling 6) — the organizer
 * entered the deal, and the sponsor confirms the facts the world will read.
 */
async function companyDetailsStatements(input: SponsorWritebackInput): Promise<D1PreparedStatement[]> {
  const { db, task, answers, now } = input;
  if (!task.sponsorship_id) return [];
  const company = await db
    .prepare(
      `SELECT company.id, company.name, company.website, company.blurb
       FROM sponsorships sponsorship
       JOIN companies company ON company.id = sponsorship.company_id AND company.org_id = ?
       WHERE sponsorship.id = ? AND sponsorship.event_id = ?`,
    )
    .bind(input.orgId, task.sponsorship_id, task.event_id)
    .first<{ id: string; name: string; website: string | null; blurb: string | null }>();
  if (!company) return [];
  const next = {
    name: text(answers, "company_name") ?? company.name,
    website: text(answers, "company_website") ?? company.website,
    blurb: text(answers, "company_blurb") ?? company.blurb,
  };
  if (next.name === company.name && next.website === company.website && next.blurb === company.blurb) return [];
  return [
    db.prepare(
      `UPDATE companies SET name = ?, website = ?, blurb = ?, last_write_source = 'marquee', updated_at = ?
       WHERE id = ? AND org_id = ?`,
    ).bind(next.name, next.website, next.blurb, now, company.id, input.orgId),
    auditStatement(db, {
      eventId: task.event_id,
      actorKind: "user",
      actorPersonId: input.actorPersonId,
      action: "sponsor_company_updated",
      entityType: "company",
      entityId: company.id,
      before: { name: company.name, website: company.website, blurb: company.blurb },
      after: next,
      now,
      requestId: input.requestId,
    }),
  ];
}

/** Every extra write this deliverable owes, or none for an ordinary one. */
async function writebackStatements(input: SponsorWritebackInput): Promise<D1PreparedStatement[]> {
  switch (input.task.template_id) {
    case SPONSOR_WRITEBACK_TEMPLATE_IDS.nameYourSpeaker:
      return nameSpeakerStatements(input);
    case SPONSOR_WRITEBACK_TEMPLATE_IDS.sessionContent:
      return sessionContentStatements(input);
    case SPONSOR_WRITEBACK_TEMPLATE_IDS.companyDetails:
      return companyDetailsStatements(input);
    default:
      return [];
  }
}

/**
 * Apply whatever this deliverable owes the thing it is about.
 *
 * Two phases, because the second one reads what the first one wrote: the
 * participation has to exist before `reconcileTaskSet` can see a speaker to
 * onboard. Both are idempotent, so a retry after a partial failure converges.
 */
export async function applySponsorWriteback(input: SponsorWritebackInput): Promise<void> {
  if (input.task.sponsorship_id === null) return;
  const statements = await writebackStatements(input);
  if (statements.length === 0) return;
  await input.db.batch(statements);
  if (input.task.template_id === SPONSOR_WRITEBACK_TEMPLATE_IDS.nameYourSpeaker && input.task.submission_id) {
    await reconcileTaskSet(input.db, input.task.event_id, [input.task.submission_id], input.now, {
      kind: "user",
      personId: input.actorPersonId,
      requestId: input.requestId,
    });
  }
}
