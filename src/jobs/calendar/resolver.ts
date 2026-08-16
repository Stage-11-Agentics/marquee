import type { D1Database } from "@cloudflare/workers-types";

export interface CalendarIcsRevision {
  body: string;
  createdAt: number;
  method: "REQUEST" | "CANCEL";
  outboxId: string;
  sequence: number;
  uid: string;
}

interface OwnerCandidate {
  child_count: number;
  created_at: number;
  id: string;
  ics_body: string | null;
  ics_uid: string | null;
  template_key: string;
}

interface ChildPart {
  content_type: string;
  filename: string;
  ics_body: string;
  ics_uid: string;
  id: string;
  outbox_id: string;
  part_index: number;
  sequence: number;
}

function header(body: string, name: "UID" | "METHOD" | "SEQUENCE"): string | null {
  const match = body.match(new RegExp(`^${name}:([^\\r\\n]*)$`, "m"));
  return match?.[1] ?? null;
}

function parseBody(body: string): { method: "REQUEST" | "CANCEL"; sequence: number; uid: string } | null {
  const method = header(body, "METHOD");
  const uid = header(body, "UID");
  const sequenceText = header(body, "SEQUENCE");
  if (method !== "REQUEST" && method !== "CANCEL") return null;
  if (!uid || sequenceText === null || !/^\d+$/.test(sequenceText)) return null;
  if ((body.match(/BEGIN:VEVENT/g) ?? []).length !== 1 || (body.match(/END:VEVENT/g) ?? []).length !== 1) return null;
  return { method, sequence: Number(sequenceText), uid };
}

function validPart(part: ChildPart, expectedUid: string): CalendarIcsRevision | null {
  if (part.filename !== `${expectedUid}.ics` || part.content_type !== "text/calendar; charset=utf-8; method=REQUEST") return null;
  if (part.ics_uid !== expectedUid) return null;
  const parsed = parseBody(part.ics_body);
  if (!parsed || parsed.method !== "REQUEST" || parsed.uid !== expectedUid || parsed.sequence !== part.sequence) return null;
  return {
    body: part.ics_body,
    createdAt: 0,
    method: parsed.method,
    outboxId: part.outbox_id,
    sequence: parsed.sequence,
    uid: parsed.uid,
  };
}

/**
 * Resolve one public ICS URL across both calendar storage grains.
 *
 * `template_key` is the durable admission discriminator. A malformed owner is
 * deliberately a hard miss for the UID: falling through to an older store
 * would make a corrupt/newer revision look like current calendar truth.
 */
export async function resolveCalendarIcs(db: D1Database, uid: string): Promise<CalendarIcsRevision | null> {
  const owners = await db.prepare(
    `SELECT owner.id, owner.created_at, owner.template_key,
            owner.ics_uid, owner.ics_body,
            (SELECT COUNT(*) FROM outbox_calendar_parts part_count WHERE part_count.outbox_id = owner.id) AS child_count
     FROM outbox owner
     WHERE owner.ics_uid = ?
        OR EXISTS (SELECT 1 FROM outbox_calendar_parts part_uid
                   WHERE part_uid.outbox_id = owner.id AND part_uid.ics_uid = ?)`
  ).bind(uid, uid).all<OwnerCandidate>();
  if (owners.results.length === 0) return null;

  const ownerIds = owners.results.map((owner) => owner.id);
  const placeholders = ownerIds.map(() => "?").join(", ");
  const parts = await db.prepare(
    `SELECT id, outbox_id, part_index, ics_uid, sequence, filename, ics_body, content_type
     FROM outbox_calendar_parts
     WHERE outbox_id IN (${placeholders})
     ORDER BY outbox_id ASC, part_index ASC`,
  ).bind(...ownerIds).all<ChildPart>();
  const partsByOwner = new Map<string, ChildPart[]>();
  for (const part of parts.results) {
    const existing = partsByOwner.get(part.outbox_id) ?? [];
    existing.push(part);
    partsByOwner.set(part.outbox_id, existing);
  }

  const revisions: CalendarIcsRevision[] = [];
  for (const owner of owners.results) {
    const ownerParts = partsByOwner.get(owner.id) ?? [];
    let revision: CalendarIcsRevision | null = null;
    if (owner.template_key === "calendar_request" || owner.template_key === "calendar_cancel") {
      if (owner.ics_uid !== uid || owner.ics_body === null || ownerParts.length !== 0) return null;
      const parsed = parseBody(owner.ics_body);
      const expectedMethod = owner.template_key === "calendar_cancel" ? "CANCEL" : "REQUEST";
      if (!parsed || parsed.uid !== uid || parsed.method !== expectedMethod) return null;
      revision = {
        body: owner.ics_body,
        createdAt: owner.created_at,
        method: parsed.method,
        outboxId: owner.id,
        sequence: parsed.sequence,
        uid: parsed.uid,
      };
    } else if (owner.template_key === "calendar_batch_request") {
      if (owner.ics_uid !== null || owner.ics_body !== null || ownerParts.length === 0) return null;
      const part = ownerParts.find((candidate) => candidate.ics_uid === uid);
      if (!part) return null;
      if (ownerParts.some((candidate, index) => candidate.part_index !== index)
        || new Set(ownerParts.map((candidate) => candidate.ics_uid)).size !== ownerParts.length) return null;
      const parsedParts = ownerParts.map((candidate) => validPart(candidate, candidate.ics_uid));
      if (parsedParts.some((candidate) => candidate === null)) return null;
      const parsed = validPart(part, uid);
      if (!parsed) return null;
      revision = { ...parsed, createdAt: owner.created_at };
    } else {
      return null;
    }
    revisions.push(revision);
  }

  revisions.sort((left, right) => right.createdAt - left.createdAt || (right.outboxId < left.outboxId ? -1 : right.outboxId > left.outboxId ? 1 : 0));
  return revisions[0] ?? null;
}
