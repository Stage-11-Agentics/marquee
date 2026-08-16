/**
 * "Hand this to your agent" — the copy behind the agent-brief affordance.
 *
 * PHILOSOPHY §3 claims every capability is reachable programmatically and that
 * Marquee ships the affordances that make agents effective. A brief is that
 * claim made visible: on the surfaces where a capable agent does the job faster
 * than a human clicking, the operator can copy a paste-ready instruction
 * written in their own voice, to their own agent.
 *
 * A brief is never a replacement for the screen. Every control the surface had
 * before is still there and still works; the brief is a second path to the same
 * endpoints the screen itself calls.
 *
 * Four things are load-bearing, and a brief missing any of them is not
 * paste-ready:
 *
 *   1. Where this instance lives — the real origin, resolved at render, never a
 *      placeholder. A brief naming some other deployment sends the agent to the
 *      wrong conference.
 *   2. The machine-readable entry point, told as an instruction. An agent that
 *      reads `/api/openapi.json` first does not have to guess field names.
 *   3. The auth path, and where to mint a token. A brief that omits this sends
 *      the operator's agent into a 401.
 *   4. A definition of done, including the undo handle. A brief that omits this
 *      gets back "done" with no receipt and nothing to reverse.
 *
 * The copy is per-surface on purpose. Only the second paragraph is shared — it
 * states the same contract everywhere — and a brief whose body is the shared
 * paragraph with the nouns swapped has not described a job.
 */

export type AgentBriefSurface = "cfp" | "chase" | "agenda" | "portal" | "decision";

export interface AgentBriefContext {
  /** The running deployment's origin. `window.location.origin` in the app. */
  origin: string;
  /** The conference the brief is about, so the agent needs no follow-up question. */
  eventId: string;
}

export interface AgentBriefCopy {
  /** Dialog title, and the label on the trigger button. */
  title: string;
  /** The field label above the brief, matching the prototype. */
  label: string;
  /** One line of human-facing explanation — what this is and what to do with it. */
  hint: string;
  /** The brief itself: the text the operator copies and hands over. */
  brief: string;
  /** The per-surface sentence that opens the muted trailing line. */
  note: string;
  /** The endpoint, for an operator who would rather drive it themselves. */
  endpoint: string;
}

/**
 * The paragraph every brief carries. It is identical across surfaces because
 * the contract it states is identical: this instance, the schema, the token,
 * this conference.
 */
function contract({ origin, eventId }: AgentBriefContext): string {
  return `Marquee is at ${origin}. Read /api/openapi.json first — it describes every endpoint and field. You'll need an API token; I'll paste one in, or you can tell me to make one at Settings → API tokens. This conference is ${eventId}.`;
}

function cfp(context: AgentBriefContext): AgentBriefCopy {
  return {
    title: "Hand this to your agent",
    label: "Hand this to your agent",
    hint: "Copy the text below and paste it into Claude, or whichever agent you work with. It knows where Marquee is, how to read its API, and what to tell you when it's finished.",
    brief: [
      "Build the call for papers for my conference in Marquee.",
      contract(context),
      "I'll describe the conference to you — the tracks, the session formats, what I need to ask a speaker before I can schedule them. Turn that into a form: create it, add the fields in the order a submitter should meet them, mark the ones I can't run the program without as required, and bind any option list that already exists in Conference settings rather than retyping it there.",
      "Leave it as a draft. Publishing it is my call, not yours.",
      "When you're done, give me the form_id and the public URL it will have, list the fields in order with their type and whether they're required, and tell me anything I described that you couldn't express as a field. If I don't like it, I want to delete that form_id and have you start again.",
    ].join("\n\n"),
    note: "Describe your conference to it when it asks.",
    endpoint: `POST /api/v1/events/${context.eventId}/forms`,
  };
}

function chase(context: AgentBriefContext): AgentBriefCopy {
  return {
    title: "Hand this to your agent",
    label: "Hand this to your agent",
    hint: "Copy the text below and paste it into Claude, or whichever agent you work with. It knows where Marquee is, how to read its API, and what to tell you when it's finished.",
    brief: [
      "Find who is behind on my conference and send each of them the right nudge.",
      contract(context),
      "Start from the open Tasks rather than a guess: read the onboarding board to see which speakers still owe something and how late each one is. Group them by what is actually missing — a headshot is not a bio — and use the stored template that fits when there is one.",
      "Count before you send. The audience endpoint resolves a selector to an exact number of recipients; show me that number and wait for me before anything goes out, and keep every selector narrow.",
      "When you're done, tell me how many were selected, how many were queued, and how many were skipped as duplicates, and give me the outbox_ids so I can read what each speaker actually received and stop anyone being chased twice.",
    ].join("\n\n"),
    note: "Check the count it reports before you tell it to send.",
    endpoint: `POST /api/v1/events/${context.eventId}/comms/send`,
  };
}

function agenda(context: AgentBriefContext): AgentBriefCopy {
  return {
    title: "Hand this to your agent",
    label: "Hand this to your agent",
    hint: "Copy the text below and paste it into Claude, or whichever agent you work with. It knows where Marquee is, how to read its API, and what to tell you when it's finished.",
    brief: [
      "Place my accepted Sessions on the Agenda.",
      contract(context),
      "Read the Agenda first: it returns the rooms, the days, everything already placed, and the pool still waiting. Place out of that pool only. Start times are epoch milliseconds, and a Session's duration comes from its format unless I have told you otherwise.",
      "Respect the conflicts the API reports — a speaker in two rooms at once, a room double-booked, a Session outside its track's day. If a placement would conflict, leave that Session in the pool and tell me why rather than placing it anyway. Every item carries a version; send it back when you move one so you don't overwrite a change someone else just made.",
      "Nothing reaches the event site until I publish it.",
      "When you're done, tell me how many Sessions you placed and how many you left in the pool with the reason for each, and give me the agenda item ids so I can move or remove any of them.",
    ].join("\n\n"),
    note: "Tell it which day you're building if you don't want the whole conference at once.",
    endpoint: `POST /api/v1/events/${context.eventId}/agenda/items`,
  };
}

function portal(context: AgentBriefContext): AgentBriefCopy {
  return {
    title: "Hand this to your agent",
    label: "Hand this to your agent",
    hint: "Copy the text below and paste it into Claude, or whichever agent you work with. It knows where Marquee is, how to read its API, and what to tell you when it's finished.",
    brief: [
      "Get my accepted speakers into the Portal and started on their Tasks.",
      contract(context),
      "Read the onboarding board to see which accepted speakers have never been invited, and what each one still owes — headshot, bio, slides, travel. Invite the ones who have not been invited. For anyone already in the Portal, send the reminder that names the Task they are actually missing rather than a general prod.",
      "Do not invite the same speaker twice, and do not send anything to a speaker whose Tasks are all complete.",
      "When you're done, tell me who you invited, who you reminded, and who you deliberately skipped with the reason for each, and give me the outbox_ids so I can read exactly what each speaker received.",
    ].join("\n\n"),
    note: "Tell it which speakers if you don't want the whole accepted list.",
    endpoint: `POST /api/v1/events/${context.eventId}/speakers/invite`,
  };
}

function decision(context: AgentBriefContext): AgentBriefCopy {
  return {
    title: "Hand this to your agent",
    label: "Hand this to your agent",
    hint: "Copy the text below and paste it into Claude, or whichever agent you work with. It knows how to carry the decision, its facts, and its receipt through the same API as this screen.",
    brief: [
      "Carry my program decision through with its facts intact.",
      contract(context),
      "Read the submission and its current decision history first. Build a decision plan, then apply it with the plan fingerprint and If-Match value. For an acceptance or rejection, put speaker-facing context in feedback_md and staff-only context in internal_note; the latter is saved with the proposal and never sent. A waitlist changes the record and sends no email.",
      "Do not use the generic communications endpoint for a decision. The decision endpoint mints a recipient-specific speaker portal link and guarantees that the final rendered message contains it even if an edited template removed the merge field.",
      "When you're done, report the resulting status, decision_id, outbox_id, whether a message was queued, and the exact feedback you carried. Verify the queued message has the event name, the speaker-facing feedback, and a working portal exchange URL, while the internal note is absent from the message and portal payload.",
    ].join("\n\n"),
    note: "Keep speaker-facing feedback and staff-only context in their separate fields.",
    endpoint: `POST /api/v1/events/${context.eventId}/submissions/{submissionId}/decision`,
  };
}

const BUILDERS: Record<AgentBriefSurface, (context: AgentBriefContext) => AgentBriefCopy> = {
  cfp,
  chase,
  agenda,
  portal,
  decision,
};

export const AGENT_BRIEF_SURFACES: readonly AgentBriefSurface[] = ["cfp", "chase", "agenda", "portal", "decision"];

/** The shared closing claim: the screen and the API are the same product. */
export const AGENT_BRIEF_PARITY = "Everything the screen can do, it can do — there is no capability here the API lacks.";

export function agentBrief(surface: AgentBriefSurface, context: AgentBriefContext): AgentBriefCopy {
  return BUILDERS[surface](context);
}
