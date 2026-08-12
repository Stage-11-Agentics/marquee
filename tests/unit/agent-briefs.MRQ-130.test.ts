import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";

import { AgentBriefPanel } from "../../src/ui/shell/AgentBrief";
import { agentBrief, AGENT_BRIEF_SURFACES, type AgentBriefSurface } from "../../src/ui/shell/agent-briefs";

const CONTEXT = { origin: "https://marquee.stage11.dev", eventId: "evt_aie-ny-2026" };
const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const each = (assert: (surface: AgentBriefSurface) => void) => { for (const surface of AGENT_BRIEF_SURFACES) assert(surface); };

/**
 * The ticket's own failure conditions, asserted. A brief that omits auth sends
 * the operator's agent into a 401; a brief that omits the definition of done
 * gets back "done" with no receipt. Both are failures of the copy, and both are
 * silent unless something checks.
 */
describe("MRQ-130 · every brief is paste-ready", () => {
  it("CONTRACT · every brief names the running deployment, the schema, the token path, and this conference", () => {
    each((surface) => {
      const copy = agentBrief(surface, CONTEXT);
      expect(copy.brief, surface).toContain(CONTEXT.origin);
      expect(copy.brief, surface).toContain("/api/openapi.json");
      expect(copy.brief, surface).toContain("Settings → API tokens");
      expect(copy.brief, surface).toContain(CONTEXT.eventId);
    });
  });

  it("CONTRACT · every brief asks for a report back and names an undo handle", () => {
    each((surface) => {
      const copy = agentBrief(surface, CONTEXT);
      expect(copy.brief, surface).toMatch(/When you're done, tell me|When you're done, give me/);
      expect(copy.brief, surface).toMatch(/form_id|outbox_ids|agenda item ids/);
    });
  });

  it("CONTRACT · every brief speaks in the operator's voice, with no exclamation marks", () => {
    each((surface) => {
      const copy = agentBrief(surface, CONTEXT);
      // DESIGN.md: no exclamation marks, anywhere.
      expect(copy.brief, surface).not.toContain("!");
      expect(copy.note, surface).not.toContain("!");
      // First person — the operator talking to their own agent.
      expect(copy.brief, surface).toMatch(/\bI\b|\bmy\b/);
    });
  });

  it("CONTRACT · every endpoint line is a single real path, not a template", () => {
    each((surface) => {
      const copy = agentBrief(surface, CONTEXT);
      expect(copy.endpoint, surface).toContain(CONTEXT.eventId);
      expect(copy.endpoint, surface).not.toContain("{eventId}");
      expect(copy.endpoint.split("\n"), surface).toHaveLength(1);
    });
  });

  it("CONTRACT · the origin is whatever the deployment actually is", () => {
    const local = agentBrief("cfp", { origin: "http://localhost:5173", eventId: "evt_x" });
    expect(local.brief).toContain("http://localhost:5173");
    expect(local.brief).not.toContain("marquee.stage11.dev");
  });

  /**
   * The ticket is explicit that a generic brief with the nouns swapped is a
   * fail. Only the shared contract paragraph may repeat; the job each brief
   * describes must be its own copy.
   */
  it("CONTRACT · the four briefs are distinct copy, not one template with holes", () => {
    const bodies = AGENT_BRIEF_SURFACES.map((surface) => agentBrief(surface, CONTEXT).brief
      .split("\n\n")
      .filter((paragraph) => !paragraph.startsWith("Marquee is at "))
      .join("\n\n"));
    expect(new Set(bodies).size).toBe(AGENT_BRIEF_SURFACES.length);
    for (const [index, body] of bodies.entries()) {
      for (const [otherIndex, other] of bodies.entries()) {
        if (index === otherIndex) continue;
        const shared = body.split(". ").filter((sentence) => other.includes(sentence));
        expect(shared, `${AGENT_BRIEF_SURFACES[index]} and ${AGENT_BRIEF_SURFACES[otherIndex]} share a sentence`).toHaveLength(0);
      }
    }
    // Each brief opens by naming its own job.
    expect(agentBrief("cfp", CONTEXT).brief.startsWith("Build the call for papers")).toBe(true);
    expect(agentBrief("chase", CONTEXT).brief.startsWith("Find who is behind")).toBe(true);
    expect(agentBrief("agenda", CONTEXT).brief.startsWith("Place my accepted Sessions")).toBe(true);
    expect(agentBrief("portal", CONTEXT).brief.startsWith("Get my accepted speakers")).toBe(true);
  });
});

describe("MRQ-130 · the panel reproduces the prototype's shape", () => {
  const html = renderToString(h(AgentBriefPanel, { copy: agentBrief("agenda", CONTEXT) }));

  it("CONTRACT · the panel renders label, explanation, brief, copy button, and the muted endpoint line", () => {
    expect(html).toContain("Hand this to your agent");
    expect(html).toContain("agent-brief-hint");
    expect(html).toContain("agent-brief-text");
    expect(html).toContain("Copy for your agent");
    expect(html).toContain("agent-brief-endpoint");
    expect(html).toContain(`POST /api/v1/events/${CONTEXT.eventId}/agenda/items`);
  });

  it("CONTRACT · the endpoint reference stays a muted line rather than a second code block", () => {
    expect(html).not.toContain("<pre class=\"agent-brief-endpoint\"");
    expect(html.match(/<pre/g) ?? []).toHaveLength(1);
  });

  it("CONTRACT · the copy button is full width so its confirmation cannot resize it", () => {
    // Elements never jump: the label swaps to a confirmation on copy, and only
    // a full-width button can survive that without changing size.
    expect(source("src/ui/shell/agent-brief.css")).toMatch(/\.agent-brief-copy \{[^}]*width: 100%/);
    const component = source("src/ui/shell/AgentBrief.tsx");
    expect(component).toContain("Copied — paste it into your agent");
    expect(component).toContain("aria-live=\"polite\"");
  });

  it("CONTRACT · copying falls back to selecting the text where the clipboard API is unavailable", () => {
    const component = source("src/ui/shell/AgentBrief.tsx");
    expect(component).toContain("navigator.clipboard?.writeText");
    expect(component).toContain("selectNodeContents");
    expect(component).toContain("Selected — press ⌘C to copy");
  });

  it("CONTRACT · the panel paints from tokens only, so Night re-lights it with the shell", () => {
    const css = source("src/ui/shell/agent-brief.css");
    const literals = css.split("\n").filter((line) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(line) && !line.trim().startsWith("*"));
    expect(literals).toEqual([]);
  });
});

/**
 * The operator ruling of 2026-08-12: this is strictly additive. A screen that
 * loses a working affordance to fit a brief has failed the ticket. These
 * assertions are the guard — a later edit that deletes one of these controls to
 * make room fails here rather than in front of an organizer.
 */
describe("MRQ-130 · every surface keeps the controls it had", () => {
  const SURFACES: Array<{ surface: AgentBriefSurface; path: string; retained: string[] }> = [
    {
      surface: "cfp",
      path: "src/ui/forms/FormsPage.tsx",
      retained: ["Duplicate", "+ New form", "Close form", "Reopen form", "Publish changes", "Add field", "Save form", "Save field", "Live preview"],
    },
    {
      surface: "chase",
      path: "src/ui/comms/CommsScreen.tsx",
      retained: ["Demo-safe outbox", "default: demo_safe", "Save template edits", "Ad-hoc", "Template", "Merge fields"],
    },
    {
      // "conflicts" alone would be a guard that cannot fail: the word appears
      // all over this file in state names and copy, so deleting the conflicts
      // BUTTON to make room would still leave it green. Each entry here is
      // unique to a control the organizer can operate.
      surface: "agenda",
      path: "src/ui/agenda/AgendaPage.tsx",
      retained: ["setConflictsOpen(true)", "<span class=\"tabular\">{visibleConflictData.length}</span> conflicts", "Publish the program", "Review publication"],
    },
    {
      surface: "portal",
      path: "src/ui/onboarding/OnboardingPage.tsx",
      retained: ["Import speakers", "Invite to portal", "Send reminder"],
    },
  ];

  it("CONTRACT · all four surfaces mount the brief and keep every existing control", () => {
    for (const { surface, path, retained } of SURFACES) {
      const content = source(path);
      expect(content, path).toContain(`<AgentBriefLauncher surface="${surface}"`);
      for (const control of retained) {
        expect(content, `${path} no longer contains "${control}"`).toContain(control);
      }
    }
  });

  it("CONTRACT · the briefs stop at the People boundary, which belongs to MRQ-131", () => {
    each((surface) => {
      expect(agentBrief(surface, CONTEXT).endpoint, surface).not.toMatch(/\/people|\/imports/);
    });
    expect([...AGENT_BRIEF_SURFACES]).toEqual(["cfp", "chase", "agenda", "portal"]);
    // The panel is exported on its own so MRQ-131 can consume it in place,
    // inside the import modal it already owns, rather than inlining a second
    // component in the same shape.
    expect(source("src/ui/shell/AgentBrief.tsx")).toContain("export function AgentBriefPanel");
  });
});
