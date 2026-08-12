import type { MembershipRole, PersonRow } from "../../db/schema";
import {
  DEMO_ORGANIZER_PERSON_ID,
  DEMO_SPEAKER_PERSON_ID,
  SHIPPED_DEMO_ORGANIZER_PERSON_ID,
  SHIPPED_DEMO_SPEAKER_PERSON_ID,
} from "../reset-demo/demo-fixture";

/**
 * Who a demo seat belongs to, resolved once for every door that opens one.
 *
 * Two doors ask the same question. `POST /api/v1/auth/demo` asks it for the
 * three one-click buttons, and the sign-in form asks it for a visitor who typed
 * a demo address instead of clicking. The seats they open must be the same
 * seats — a second copy of this resolution is a second answer waiting to
 * disagree about which persona is "the reviewer".
 */

export type DemoRole = "organizer" | "reviewer" | "speaker";

export const DEMO_ROLE_TO_MEMBERSHIP: Record<DemoRole, MembershipRole> = {
  organizer: "owner",
  reviewer: "reviewer",
  speaker: "speaker",
};

/**
 * The addresses a demo instance answers to, one per role.
 *
 * A judge who ignores the three buttons and types an address into the form is
 * the reason these exist: the form is the affordance every sign-in page has
 * trained them to use, and it must not be the one path that dead-ends. They are
 * obviously fake by construction, and they mean nothing off a demo instance —
 * every caller of this map gates on a live demo event first.
 */
export const DEMO_SIGNIN_EMAILS: Readonly<Record<string, DemoRole>> = {
  "organizer@demo.com": "organizer",
  "reviewer@demo.com": "reviewer",
  "speaker@demo.com": "speaker",
};

/** The same three addresses in the order the page prints them. */
export const DEMO_SIGNIN_EMAIL_LIST: readonly string[] = Object.keys(DEMO_SIGNIN_EMAILS);

/**
 * The role a typed address asks for, or null for every other address.
 *
 * Matching is on the trimmed, lowercased form because that is what the sign-in
 * lookup already normalizes to; `Organizer@Demo.com ` is the same request.
 */
export function demoRoleForEmail(email: string): DemoRole | null {
  return DEMO_SIGNIN_EMAILS[email.trim().toLowerCase()] ?? null;
}

/** SPEC §4.1's program-staff roles — the seats that carry organizer navigation. */
const DEMO_STAFF_ROLES: readonly string[] = ["owner", "program_lead", "ops"];

/**
 * The persona the demo fixture names for a role, when it names one.
 *
 * Reviewer names none: it resolves to whichever seeded reviewer sorts first,
 * which is the honest answer for a role the fixture does not personify.
 */
const DEMO_PERSONA_PREFERENCE: Record<string, readonly string[]> = {
  organizer: [SHIPPED_DEMO_ORGANIZER_PERSON_ID, DEMO_ORGANIZER_PERSON_ID],
  reviewer: [],
  speaker: [SHIPPED_DEMO_SPEAKER_PERSON_ID, DEMO_SPEAKER_PERSON_ID],
};

/**
 * A demo door has to open the same seat every time, and the *right* seat.
 *
 * The seeded program staffer holds `reviewer` alongside `owner` and
 * `program_lead`, so an unordered `LIMIT 1` can answer "sign me in as a
 * reviewer" with the organizer — the reviewer door would then present full
 * organizer navigation, which is not a reviewer demo at all. Two rules fix it:
 * a non-staff role never resolves to a staff holder, and the remaining
 * candidates are ordered rather than left to whatever the table returns.
 */
export async function findDemoPersona(
  db: D1Database,
  eventId: string,
  role: string,
  membershipRole: MembershipRole,
): Promise<PersonRow | null> {
  const preferred = DEMO_PERSONA_PREFERENCE[role] ?? [];
  const excludeStaff = !DEMO_STAFF_ROLES.includes(membershipRole);
  const bindings: (string | number)[] = [eventId, membershipRole];
  const staffExclusion = excludeStaff
    ? `AND NOT EXISTS (
         SELECT 1 FROM memberships staff
         WHERE staff.person_id = p.id
           AND staff.role IN (${DEMO_STAFF_ROLES.map(() => "?").join(", ")})
           AND (staff.event_id = ? OR staff.event_id IS NULL)
       )`
    : "";
  if (excludeStaff) bindings.push(...DEMO_STAFF_ROLES, eventId);
  const preferenceOrder = preferred.length > 0
    ? `CASE WHEN p.id IN (${preferred.map(() => "?").join(", ")}) THEN 0 ELSE 1 END, `
    : "";
  if (preferred.length > 0) bindings.push(...preferred);

  const persona = await db.prepare(
    `SELECT p.* FROM people p
     JOIN memberships m ON m.person_id = p.id
     WHERE p.is_demo = 1 AND m.event_id = ? AND m.role = ?
     ${staffExclusion}
     ORDER BY ${preferenceOrder}p.created_at ASC, p.id ASC
     LIMIT 1`,
  )
    .bind(...bindings)
    .first<PersonRow>();
  return persona ?? null;
}
