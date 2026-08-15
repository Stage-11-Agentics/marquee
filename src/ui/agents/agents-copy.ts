/**
 * The Agents page's copy, held apart from its markup.
 *
 * The page is the org-level sibling of the per-surface agent briefs
 * (`src/ui/shell/agent-briefs.ts`): a brief tells one agent how to do one job on
 * one conference, while this page is the front door — how any agent connects to
 * this instance at all, and which four are worth running once it has.
 *
 * Two strings name the deployment, and both resolve the origin at render rather
 * than carrying a domain. The binding prototype is a static file, so it writes
 * our own hostname into both; a build that copied that literal would hand every
 * other deployment's operator a prompt pointing at ours, which is the same
 * defect the briefs already refuse to ship (`agent-briefs.ts` §1).
 */

export interface AgentRoster {
  /** The numeral the card's chip carries — presentational, and stable. */
  num: string;
  name: string;
  role: string;
  /** One sentence. The client ruling is that a card says one thing. */
  copy: string;
  /** The paste-ready prompt, the card's only payload. */
  prompt: string;
}

/**
 * The four, verbatim from the prototype. They are an opinion, not a menu: each
 * one is a job an organizer already has and would rather not do by hand.
 */
export const AGENTS_ROSTER: readonly AgentRoster[] = [
  {
    num: "01",
    name: "The setup agent",
    role: "Cloned repo → claimed instance",
    copy: "Stands up a fresh deploy on your own Cloudflare account, then hands you a one-time claim link. Ownership lands on you, never on the agent.",
    prompt: "Set up Marquee for our conference — Great Lakes Infra Days, April 14–15 2027, Buffalo.",
  },
  {
    num: "02",
    name: "The reviewer seat",
    role: "A committee member that reads everything",
    copy: "Takes an evaluator seat, scores its assigned queue, and files a rationale your chair reads verbatim. It recommends; an organizer decides.",
    prompt: "Work through your review queue. Score each abstract against the rubric and explain every recommendation.",
  },
  {
    num: "03",
    name: "The chase agent",
    role: "The deadline work nobody wanted",
    copy: "Finds who still owes what and sends the reminders. The queued count is its receipt.",
    prompt: "Find every speaker still owing a headshot, nudge each one politely, and tell me who is left.",
  },
  {
    num: "04",
    name: "The program builder",
    role: "Triage → agenda → published",
    copy: "Accepts a wave, places Sessions into rooms, and publishes. Writes are version-guarded, so two agents cannot clobber each other.",
    prompt: "Place the accepted Platform-track talks into Lakeside A on day one — no conflicts — then publish them.",
  },
];

/** Where this instance serves the skill an agent installs to work here. */
export function skillUrl(origin: string): string {
  return `${origin}/SKILL.md`;
}

/**
 * The one prompt the whole page rests on: install the skill this instance
 * serves, take a scoped token, prove the connection with a read before anything
 * writes.
 */
export function agentsConnectPrompt(origin: string): string {
  return `Install Marquee's skill: fetch ${skillUrl(origin)} and save it where you load skills. Then I'll paste a scoped API token — set MARQUEE_URL and MARQUEE_TOKEN, verify the connection with a read-only command, and show me what you can see.`;
}

/** The two receipts a copy action leaves. Both are the prototype's, verbatim. */
export const PROMPT_COPIED_TOAST = "Prompt copied · paste it to your agent";
export const URL_COPIED_TOAST = "URL copied · your agent can fetch it";

/**
 * The running deployment's origin, resolved where it is true — the same read
 * `AgentBriefLauncher` makes. Server-side rendering (and the unit tests) pass
 * one in; in the browser there is exactly one right answer and it is not a
 * constant.
 */
export function resolveOrigin(origin?: string): string {
  if (origin !== undefined) return origin;
  return typeof window === "undefined" ? "" : window.location.origin;
}
