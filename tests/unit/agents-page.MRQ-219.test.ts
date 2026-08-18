/**
 * MRQ-219 · the Agents page, as a copy-and-reachability contract.
 *
 * The page is almost entirely copy and two clipboard actions, so what can go
 * wrong is what a screenshot would not catch: a hardcoded domain in the connect
 * prompt (which sends every other deployment's agent to ours), a card that grew
 * a navigation the client ruled against, a door that points at a route which no
 * longer exists, or the sidebar row quietly disappearing.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";

import { AgentsPage } from "../../src/ui/agents/AgentsPage";
import {
  AGENTS_ROSTER,
  agentsConnectPrompt,
  PROMPT_COPIED_TOAST,
  resolveOrigin,
  skillUrl,
  URL_COPIED_TOAST,
} from "../../src/ui/agents/agents-copy";
import { activeNavId, matchRoute, routesFor } from "../../src/ui/shell/route-table";

const ORIGIN = "https://conference.example.org";
const root = resolve(import.meta.dirname, "../..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");
const markup = renderToString(h(AgentsPage, { navigate: () => {}, origin: ORIGIN }));

describe("MRQ-219 · the Agents page is reachable", () => {
  it("CONTRACT · MRQ-219 AC1 — /agents is an organization row with its own active state", () => {
    const route = matchRoute("/agents");
    expect(route).toMatchObject({ id: "agents", label: "Agents", icon: "⌘", group: "organization", sidebar: true });
    // Its own row, not borrowed from another surface.
    expect(activeNavId("agents")).toBe("agents");
    const organization = routesFor("organization").map((entry) => entry.id);
    expect(organization).toContain("agents");
    // Between Outreach and Settings, exactly where the binding prototype's nav
    // puts it — Settings closes the group.
    expect(organization.indexOf("agents")).toBe(organization.indexOf("sourcing") + 1);
    expect(organization.at(-1)).toBe("org-settings");
  });

  it("CONTRACT · MRQ-219 AC1 — the shell answers /agents before the conference guard", () => {
    // An instance with no conference yet still has an agent to connect, so the
    // page must be rendered above `eventId === null ? <NoConference…`.
    const shell = read("src/ui/shell/AppShell.tsx");
    expect(shell).toContain("<AgentsPage");
    expect(shell.indexOf("<AgentsPage")).toBeLessThan(shell.indexOf("eventId === null ? <NoConference"));
    // …and its crumb names the organization rather than a conference it does
    // not belong to.
    expect(shell).toMatch(/isAgents \? \{ scopeName: orgName/);
  });
});

describe("MRQ-219 · the connect prompt names this instance", () => {
  it("CONTRACT · MRQ-219 AC2 — the origin is substituted, and no deployment's domain is baked in", () => {
    const prompt = agentsConnectPrompt(ORIGIN);
    expect(prompt).toContain(`${ORIGIN}/SKILL.md`);
    expect(markup).toContain(`${ORIGIN}/SKILL.md`);
    // The prototype is a static file and writes our own domain into both
    // strings; a build that copied it would be wrong everywhere but here.
    for (const source of [read("src/ui/agents/agents-copy.ts"), read("src/ui/agents/AgentsPage.tsx"), markup]) {
      expect(source).not.toContain("marquee.stage11.dev");
    }
  });

  it("CONTRACT · MRQ-219 AC2 — the prompt is the prototype's, word for word", () => {
    expect(agentsConnectPrompt(ORIGIN)).toBe(
      `Install Marquee's skill: fetch ${ORIGIN}/SKILL.md and save it where you load skills. Then I'll paste a scoped API token — set MARQUEE_URL and MARQUEE_TOKEN, verify the connection with a read-only command, and show me what you can see.`,
    );
    expect(markup).toContain("One prompt, pasted into the agent of your choice");
    expect(markup).toContain("It installs the skill, takes the token you mint here, and proves the connection with a read before anything writes.");
    expect(markup).toContain("GET /SKILL.md");
  });

  it("CONTRACT · MRQ-219 AC2 — the origin falls back to the running deployment, never to a constant", () => {
    expect(resolveOrigin(ORIGIN)).toBe(ORIGIN);
    // No window in the test environment: an empty string is the honest answer,
    // and it is what a server-side render gets.
    expect(resolveOrigin()).toBe("");
    expect(skillUrl(ORIGIN)).toBe(`${ORIGIN}/SKILL.md`);
  });
});

describe("MRQ-219 · the machine doors", () => {
  it("CONTRACT · MRQ-219 AC3 — three doors: the token screen, the reference, and the skill URL", () => {
    const doors = markup.match(/class="agents-door"/g) ?? [];
    expect(doors).toHaveLength(3);
    expect(markup).toContain("Create API token");
    expect(markup).toContain('href="/org/tokens"');
    expect(markup).toContain("API &amp; CLI reference");
    expect(markup).toContain('href="/api/docs"');
    expect(markup).toContain("Copy the URL →");
    // Both destinations are real routes, so neither door is a dead end.
    expect(matchRoute("/org/tokens")?.id).toBe("org-tokens");
    expect(matchRoute("/api/docs")?.id).toBe("api-docs");
  });

  it("CONTRACT · MRQ-219 AC3 — the doors are painted from tokens in both palettes", () => {
    const tokens = read("src/styles/tokens.css");
    const night = tokens.match(/html\[data-theme="night"\] \{([\s\S]*?)\n\}/)?.[1] ?? "";
    for (const token of ["--canvas-btn", "--canvas-tile-line", "--canvas-tile-ink", "--canvas-link"]) {
      expect(tokens, `${token} must exist`).toContain(`${token}:`);
      expect(night, `${token} must be redefined at night`).toContain(`${token}:`);
    }
    // The page's own stylesheet is one of the files check:design cannot read,
    // so the literal check happens here instead.
    const css = read("src/ui/agents/agents.css")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("/*"));
    expect(css.filter((line) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(line))).toEqual([]);
  });
});

describe("MRQ-219 · the roster and the contract cards", () => {
  it("CONTRACT · MRQ-219 AC4 — four cards, verbatim, each with exactly one action", () => {
    expect(AGENTS_ROSTER).toHaveLength(4);
    expect(AGENTS_ROSTER.map((agent) => agent.name)).toEqual([
      "The setup agent",
      "The reviewer seat",
      "The chase agent",
      "The program builder",
    ]);
    for (const agent of AGENTS_ROSTER) {
      expect(markup, agent.name).toContain(agent.name);
      expect(markup, agent.role).toContain(agent.role);
      expect(markup, agent.prompt).toContain(agent.prompt);
      // One sentence per card is the ruling; a second full stop mid-copy is
      // allowed only where the prototype has one, so assert the copy itself.
      expect(markup).toContain(agent.copy);
    }
    // Copy prompt is the only action on a card — the client ruled that this
    // page tells you how to set your agent up and does not shuttle you away.
    const cards = markup.split('class="card agents-card"').slice(1);
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      // Bounded to the card's own section: the tail of the last split carries
      // whatever the page renders after the roster, which is not this card's.
      const own = card.slice(0, card.indexOf("</section>"));
      expect(own.match(/<button/g) ?? []).toHaveLength(1);
      expect(own).not.toContain("<a ");
    }
  });

  it("CONTRACT · MRQ-219 AC5 — the next-year line and both contract cards are the prototype's", () => {
    expect(markup).toContain("event create --from");
    expect(markup).toContain("structure carried across, people already there");
    for (const line of [
      "Every write returns the resulting record. Agents verify, never infer.",
      "Filters resolve in Marquee, never guessed from a paginated page.",
      "A stale agenda write fails with a conflict instead of clobbering.",
      "writes exactly one JSON value to stdout.",
      "The one-time claim link is opened by a person, never an agent.",
      "Opening intake and publishing are operator clicks.",
      "A reviewer seat recommends. Organizers accept and reject.",
    ]) {
      expect(markup, line).toContain(line);
    }
    // Both accountability links route somewhere real.
    expect(markup).toContain('href="/org/activity"');
    expect(matchRoute("/org/activity")?.id).toBe("org-activity");
  });
});

describe("MRQ-219 · copying is the page's only write", () => {
  it("CONTRACT · MRQ-219 AC2/AC3 — both receipts are announced through the shell's toast host", () => {
    const page = read("src/ui/agents/AgentsPage.tsx");
    expect(PROMPT_COPIED_TOAST).toBe("Prompt copied · paste it to your agent");
    expect(URL_COPIED_TOAST).toBe("URL copied · your agent can fetch it");
    expect(page).toContain("announce(receipt)");
    expect(page).toContain("navigator.clipboard");
    // Nothing swaps a button label: the toast is the confirmation, so no
    // control resizes under the operator's cursor (DESIGN.md, elements never
    // jump). Every button on the page renders a literal, so the rendered labels
    // are the whole set — assert them rather than a spelling of their absence.
    const labels = [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
    expect(labels).toEqual([
      "Copy prompt",
      "Copy the URL →",
      "Copy config",
      "Copy prompt",
      "Copy prompt",
      "Copy prompt",
      "Copy prompt",
      "Copy brief",
    ]);
  });

  it("CONTRACT · MRQ-219 AC2/AC3 — a repeated receipt is still an event", () => {
    // Five of this page's eight buttons announce the SAME words, and the shell
    // holds one message: writing an identical string renders nothing, so the
    // second Copy would leave the screen unchanged. The binding prototype's
    // toast clears itself after 2.4s and re-shows on every call; the shell now
    // does the same, and the counter is what makes a repeat a change.
    const shell = read("src/ui/shell/AppShell.tsx");
    expect(shell).toMatch(/setToastSeq\(\(seq\) => seq \+ 1\)/);
    expect(shell).toMatch(/setTimeout\(\(\) => setToast\(""\), 2400\)/);
    expect(shell).toMatch(/\}, \[toast, toastSeq, toastHolds\]\)/);
    // …and a failure is the one receipt that does not time out.
    expect(shell).toMatch(/showToast\("Reset failed: " \+ errorSummary\(error\), true\)/);
  });

  it("CONTRACT · MRQ-219 AC8 — the instance still serves the skill the prompt tells an agent to fetch", () => {
    const index = read("src/index.ts");
    expect(index).toContain('app.get("/SKILL.md"');
    expect(index).toContain("text/markdown");
  });
});
