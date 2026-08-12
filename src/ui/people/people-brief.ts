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
