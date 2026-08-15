/**
 * The People import brief — the fifth "Hand this to your agent", written for an
 * ORG-level job.
 *
 * It renders through MRQ-130's shared `AgentBriefPanel`, which is exported on
 * its own precisely so a surface that already has a modal can put the brief
 * inside it rather than behind a second overlay.
 *
 * It is deliberately NOT in `AGENT_BRIEF_SURFACES`. Every brief in that list
 * names the conference it is about, and its parity test enforces that — rightly,
 * because a brief that omits the conference sends the agent to the wrong one.
 * People has no conference: it is the organization's record, and the endpoint is
 * `/api/v1/org/imports`. Adding it to that list would mean either weakening the
 * rule for the four surfaces that need it or writing an event id into a brief
 * that does not have one. So it borrows the panel and states its own contract.
 *
 * The four load-bearing items are all still here — origin, `/api/openapi.json`,
 * the token path, and a definition of done naming the undo handle — because
 * those are what make a brief paste-ready rather than decorative.
 */
import type { AgentBriefCopy } from "../shell/agent-briefs";
import { AGENT_BRIEF_PARITY } from "../shell/agent-briefs";

export { AGENT_BRIEF_PARITY };

export function peopleImportBrief(origin: string): AgentBriefCopy {
  return {
    title: "Hand this to your agent",
    label: "Hand this to your agent",
    hint: "Copy the text below and paste it into Claude, or whichever agent you work with. It knows where Marquee is, how to read its API, and what to tell you when it's finished.",
    brief: [
      "Import my speaker list into Marquee.",
      `Marquee is at ${origin}. Read /api/openapi.json first — it describes every endpoint and field. You'll need an API token; I'll paste one in, or you can tell me to make one at Settings → API tokens. People is organization-level, so this one is not about any single conference.`,
      "The people are in a CSV I'll point you at. Marquee matches on email address, so anyone already in there gets updated rather than duplicated — no need to de-dupe the file first. Columns are mapped by their headers; don't guess at one you can't place.",
      "When you're done, tell me how many were created, updated and skipped, list any columns you couldn't map, and give me the import_id so I can undo it if it's wrong.",
    ].join("\n\n"),
    note: "Point it at your file when it asks.",
    endpoint: "POST /api/v1/org/imports",
  };
}

/**
 * The attendee-import brief — the answer to ticketing platforms, MRQ-208.
 *
 * Marquee ships no per-platform importers, and this is why it does not need
 * to: the rails are a documented endpoint and an email-keyed upsert, and the
 * bridge from wherever the tickets were sold is a job an agent can do in one
 * pass. Adding Eventbrite, then Luma, then Tito, then the one nobody has heard
 * of is a treadmill; teaching the loop once is not.
 *
 * It is a different job from the speaker import above and says so: it names a
 * conference, because an attendance row is event-scoped, and it names the
 * verification step, because "did all 1,847 of them land" is the question the
 * organizer will actually ask afterwards.
 */
export function attendeeImportBrief(origin: string, event: { name: string; slug: string } | null): AgentBriefCopy {
  const slug = event?.slug ?? "your-conference-slug";
  const name = event?.name ?? "our conference";
  return {
    title: "Hand this to your agent",
    label: "Import attendees — a task for your agent",
    hint: "Copy this into Claude, Codex, or whichever agent you work with. It bridges from wherever your tickets were sold to Marquee's documented import, and tells you what landed.",
    brief: [
      `Import our ${name} attendees into Marquee.`,
      `Marquee is at ${origin}. Read /api/openapi.json first — it describes every endpoint and field. You'll need an API token; I'll paste one in, or you can tell me to make one at Settings → API tokens.`,
      "Source: wherever our tickets were sold — Luma, Tito, Eventbrite, a CSV export. Work out the export yourself and ask me for access if you need it. What you need per person is name, email and company.",
      [
        "The loop:",
        `1. Pull the attendee export from the source.`,
        `2. POST /api/v1/org/imports with { "csv": "<the file as text>", "event": "${slug}" }. Marquee matches on email, so re-running is safe: nobody is duplicated, and the attendance rows for the conference are written by that same call — there is no second request to make.`,
        `3. Verify: GET /api/v1/org/people?event_id=${slug}&kind=attendee and check the total against the export.`,
      ].join("\n"),
      "Email is the identity key — never create a second person for an address that already exists. Many attendees are past speakers, and keeping them as one record is the point of importing them here at all.",
      "Report back: rows imported, how many matched people we already had, anything skipped, and the import_id so I can undo it if it is wrong.",
    ].join("\n\n"),
    note: "It will ask you where the export lives.",
    endpoint: "POST /api/v1/org/imports",
  };
}
