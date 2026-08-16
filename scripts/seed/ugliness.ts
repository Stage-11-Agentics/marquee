/** Deliberate edge cases and accepted-speaker onboarding workload. */

import { seedId, syntheticEmail } from "../../src/lib/ids.ts";
import { scheduledSessions } from "./accepted-core.ts";
import type { SeedContext, SeedModule, SeedRow } from "./_sql.ts";
import { EVENT_ID, ORG_ID, TEMPLATE_IDS } from "./event.ts";
import { poolSubmissionId } from "./pool.ts";

function table(ctx: SeedContext, name: string): SeedRow["row"][] {
  return ctx.rows.filter((entry) => entry.table === name).map((entry) => entry.row);
}

// STORYLINE: See SEED-STORYLINES.md § “Edge-case people”. These four names are
// deliberate layout, diacritic, and initials-avatar fixtures; preserve them.
const EDGE_PEOPLE = [
  ["casey-oconnell-singh", "Casey O'Connell-Singh", "Systems Cartographer"],
  ["mei-ling-de-la-fontaine", "Mei-Ling de la Fontaine", "Reliability Researcher"],
  ["aicha-ndiaye-kovacs", "Aïcha Ndiaye-Kovács", "Applied AI Lead"],
  ["lukasz-zolc-wisniewski", "Łukasz Żółć-Wiśniewski", "Infrastructure Fellow"],
] as const;

function addParticipation(
  ctx: SeedContext,
  personId: string,
  submissionId: string,
  position: number,
  key: string,
): void {
  ctx.add("participations", {
    id: seedId("par", `ugliness-${key}`),
    submission_id: submissionId,
    person_id: personId,
    role: "co_speaker",
    position,
    confirmation_status: "pending",
    confirmed_at: null,
    invited_at: null,
    created_at: ctx.now,
    updated_at: ctx.now,
  });
}

export function run(ctx: SeedContext): void {
  const takenEmails = new Set<string>();
  const ids = new Map<string, string>();
  for (const [key, name, title] of EDGE_PEOPLE) {
    const personId = seedId("per", `edge-${key}`);
    ids.set(key, personId);
    ctx.add("people", {
      id: personId,
      org_id: ORG_ID,
      email: syntheticEmail(name, takenEmails),
      name,
      title,
      company: "Longform Signal Cooperative",
      bio: "Synthetic edge-case profile used to exercise long-name layout and local initials avatars.",
      headshot_attachment_id: null,
      social_links: "[]",
      is_demo: 1,
      last_write_source: "marquee",
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }

  const tripleSpeakerId = ids.get("casey-oconnell-singh")!;
  for (let index = 0; index < 3; index += 1) {
    addParticipation(ctx, tripleSpeakerId, poolSubmissionId(index), 1, `triple-${index + 1}`);
  }

  const panelSubmissionId = poolSubmissionId(3);
  ["mei-ling-de-la-fontaine", "aicha-ndiaye-kovacs", "lukasz-zolc-wisniewski"].forEach(
    (key, index) => addParticipation(ctx, ids.get(key)!, panelSubmissionId, index + 1, `panel-${index + 1}`),
  );

  const acceptedIds = new Set(
    table(ctx, "submissions").filter((row) => row.status === "accepted").map((row) => String(row.id)),
  );
  // The agenda schedules a fixed, format-spanning set of accepted rows
  // (`scheduledSessions`). The first accepted row it leaves out is therefore a
  // real accepted Session with a sent wave, no agenda slot, and no pending
  // wave; closing its seeded tasks makes the derived Ready to place stage
  // genuinely reachable.
  const acceptedRows = table(ctx, "submissions").filter((row) => row.status === "accepted");
  const scheduledIds = new Set(scheduledSessions().map((session) => seedId("sub", session.slug)));
  const readyToPlaceSubmissionId = String(
    acceptedRows.find((row) => !scheduledIds.has(String(row.id)))?.id ?? "",
  );
  const acceptedParticipations = table(ctx, "participations").filter(
    (row) => acceptedIds.has(String(row.submission_id)),
  );
  const firstAcceptedSubmission = new Map<string, string | null>();
  for (const row of acceptedParticipations) {
    if (!firstAcceptedSubmission.has(String(row.person_id))) {
      firstAcceptedSubmission.set(String(row.person_id), String(row.submission_id));
    }
  }
  for (const member of table(ctx, "memberships").filter((row) => row.role === "speaker")) {
    const personId = String(member.person_id);
    if (!firstAcceptedSubmission.has(personId)) firstAcceptedSubmission.set(personId, null);
  }

  const requiredTemplates = [
    [TEMPLATE_IDS.hotelTravel, "Hotel and Travel Reservations", "form"],
    [TEMPLATE_IDS.presentationUpload, "Presentation Upload", "file"],
  ] as const;
  [...firstAcceptedSubmission].sort(([left], [right]) => left.localeCompare(right)).forEach(
    ([personId, submissionId], personIndex) => {
      const readyToPlace = submissionId === readyToPlaceSubmissionId;
      requiredTemplates.forEach(([templateId, title, kind], templateIndex) => {
        const overdue = templateIndex === 0 && personIndex < 10;
        const done = readyToPlace || (!overdue && (personIndex + templateIndex) % 5 === 0);
        const dueAt = overdue
          ? ctx.now - (personIndex + 1) * 24 * 60 * 60 * 1000
          : ctx.now + (templateIndex === 0 ? 16 : 11) * 24 * 60 * 60 * 1000;
        ctx.add("speaker_tasks", {
          id: seedId("tsk", `${personId}-${templateId}`),
          event_id: EVENT_ID,
          person_id: personId,
          submission_id: submissionId,
          template_id: templateId,
          title,
          kind,
          description: overdue
            ? "This deliberately overdue demo task keeps the chase board honest."
            : "Seeded onboarding work for the accepted-speaker portal.",
          due_at: dueAt,
          status: done ? "done" : "open",
          completed_at: done ? ctx.now - 60 * 60 * 1000 : null,
          response_json: done && kind === "form" ? JSON.stringify({ demo: "completed" }) : null,
          attachment_id: null,
          last_write_source: "marquee",
          created_at: ctx.now,
          updated_at: ctx.now,
        });
      });

      if (personIndex < 18) {
        [
          [TEMPLATE_IDS.finalizeDescription, "Finalize talk description", "Confirm the title and abstract before publication."],
          [TEMPLATE_IDS.finalizeBio, "Finalize bio & photos", "Review your bio and headshot before publication."],
        ].forEach(([templateId, title, description]) => {
          ctx.add("speaker_tasks", {
            id: seedId("tsk", `${personId}-${templateId}`),
            event_id: EVENT_ID,
            person_id: personId,
            submission_id: submissionId,
            template_id: templateId,
            title,
            kind: "acknowledge",
            description,
            due_at: ctx.now + 9 * 24 * 60 * 60 * 1000,
            status: readyToPlace ? "done" : "open",
            completed_at: readyToPlace ? ctx.now - 60 * 60 * 1000 : null,
            response_json: readyToPlace ? JSON.stringify({ demo: "completed" }) : null,
            attachment_id: null,
            last_write_source: "marquee",
            created_at: ctx.now,
            updated_at: ctx.now,
          });
        });
      }
    },
  );
}

export const seed: SeedModule = { name: "ugliness", order: 60, run };
