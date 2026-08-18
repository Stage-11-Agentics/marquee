import type { JSX } from "preact";
import { useCallback } from "preact/hooks";

import { Chip, PageHeader } from "../shell/components";
import { announce } from "../shell/OverlayHosts";
import {
  AGENT_FIRST_READ_BRIEF,
  AGENTS_ROSTER,
  agentsConnectPrompt,
  CONFIG_COPIED_TOAST,
  mcpClientConfig,
  mcpUrl,
  PROMPT_COPIED_TOAST,
  resolveOrigin,
  skillUrl,
  URL_COPIED_TOAST,
} from "./agents-copy";
import "./agents.css";

/**
 * The Agents page — the agent-native front door, one screen of calm.
 *
 * PHILOSOPHY §3 says every capability is reachable programmatically. Until this
 * screen existed that claim was reachable only from the sidebar foot, which is
 * where a product puts the things it is not really offering. The page is
 * deliberately light: one paste-ready prompt that connects any agent, three
 * canonical machine doors plus the generated context shortcut, four agents
 * worth running, and two honesty cards. No runtime name-dropping, no command
 * anatomy — the reference already exists and this page points at it rather
 * than reprinting it.
 *
 * Every card action is Copy. The agent cards carry no navigation on purpose
 * (client ruling, 2026-08-15): this page tells an operator how to set their
 * agent up, it does not shuttle them somewhere else mid-thought.
 */

/**
 * One copy affordance, used by every button on the page. The label never
 * changes — the toast is the receipt, and a button that relabels itself is a
 * button that resizes, which is the jump the craft rules forbid.
 */
function useCopy(): (text: string, receipt: string) => void {
  return useCallback((text: string, receipt: string) => {
    // The clipboard can be absent (an insecure origin, or a browser withholding
    // it) and it can reject. Neither is worth a modal here: the text is on
    // screen, selectable, in both places it is offered.
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(
        () => announce(receipt),
        () => announce("Copying was refused by the browser — select the text and press ⌘C"),
      );
      return;
    }
    announce("Copying is unavailable here — select the text and press ⌘C");
  }, []);
}

function CopyButton({ onCopy, children }: { onCopy: () => void; children: string }): JSX.Element {
  return <button class="button small" type="button" onClick={onCopy}>{children}</button>;
}

export function AgentsPage({ navigate, origin }: { navigate: (target: string) => void; origin?: string }): JSX.Element {
  const copy = useCopy();
  const instanceOrigin = resolveOrigin(origin);
  const connectPrompt = agentsConnectPrompt(instanceOrigin);
  const skill = skillUrl(instanceOrigin);
  const mcp = mcpUrl(instanceOrigin);
  const mcpConfig = mcpClientConfig(instanceOrigin);
  const go = (target: string) => (event: MouseEvent) => { event.preventDefault(); navigate(target); };

  return <>
    <PageHeader
      title="Agents"
      copy="Marquee is agent-native: the CLI and API are first-class doors to the same records as these screens. Connect the agent of your choice and hand over the chase work."
    />
    <div class="agents-lead">
      <section class="card agents-connect">
        <header class="card-head">
          <div><h2>Connect an agent</h2><span class="subtle">One prompt, pasted into the agent of your choice</span></div>
          <Chip tone="success">GET /SKILL.md</Chip>
        </header>
        <div class="card-body agents-connect-body">
          <div class="agents-quote">“{connectPrompt}”</div>
          <div class="agents-connect-side">
            <p class="subtle">It installs the skill, takes the token you mint here, and proves the connection with a read before anything writes.</p>
            <div><CopyButton onCopy={() => copy(connectPrompt, PROMPT_COPIED_TOAST)}>Copy prompt</CopyButton></div>
          </div>
        </div>
      </section>
{/*
        The three machine doors: dark instrument blocks, the strongest visual
        register on the page. They are a band rather than header buttons
        (client ruling) — the doors an agent's operator actually needs are the
        token, the reference, and the skill file, and a header button is where
        a product hides something it does not mean.
      */}
      <div class="agents-doors">
        <div class="agents-context-door">
          <strong>Machine context</strong>
          <span>Start with the generated index, or take the complete served context in one fetch.</span>
          <a class="button small" href="/llms.txt">Open /llms.txt →</a>
        </div>
        <div class="agents-door">
          <strong>Create API token</strong>
          <span>Scoped to the organization or one conference, revocable in one click.</span>
          <a class="button small" href="/org/tokens" onClick={go("/org/tokens")}>Open API tokens →</a>
        </div>
        <div class="agents-door">
          <strong>API &amp; CLI reference</strong>
          <span>Every command and endpoint — the same surface these screens use.</span>
          {/* The reference is served outside the admin shell, so this is a real
              browser navigation rather than a client-side push. */}
          <a class="button small" href="/api/docs">Open the reference →</a>
        </div>
        <div class="agents-door">
          <strong>/SKILL.md</strong>
          <span>The full reference as one markdown file, straight from this instance — made to hand to an agent.</span>
          <CopyButton onCopy={() => copy(skill, URL_COPIED_TOAST)}>Copy the URL →</CopyButton>
        </div>
      </div>
    </div>
    <section class="card agents-connect">
      <header class="card-head">
        <div><h2>Connect over MCP</h2><span class="subtle">One endpoint, for any Model Context Protocol client</span></div>
        <Chip tone="success">POST /mcp</Chip>
      </header>
      <div class="card-body agents-connect-body">
        <pre class="agents-quote agents-code">{mcpConfig}</pre>
        <div class="agents-connect-side">
          <p class="subtle">
            With no token, <code>{mcp}</code> serves the public tier — the published program, one
            session, one speaker, what the call for proposals asks, and sending a proposal. Add a
            scoped token and the tool set widens to exactly what that token already allows over the
            API: never more, and never on a conference it is not scoped to.
          </p>
          <p class="subtle">Mint the token in <a href="/org/tokens" onClick={go("/org/tokens")}>API tokens</a>, then paste it in place of <code>mq_YOUR_TOKEN</code>.</p>
          <div><CopyButton onCopy={() => copy(mcpConfig, CONFIG_COPIED_TOAST)}>Copy config</CopyButton></div>
        </div>
      </div>
    </section>
    <div class="agents-roster-head">
      <h2>Four agents worth running</h2>
      <span class="subtle">Start from the prompt · check the receipts on these screens</span>
    </div>
    <div class="agents-roster">
      {AGENTS_ROSTER.map((agent) => <section class="card agents-card" key={agent.num}>
        <header class="card-head">
          <div><h2>{agent.name}</h2><span class="subtle">{agent.role}</span></div>
          <Chip>{agent.num}</Chip>
        </header>
        <div class="card-body">
          <p>{agent.copy}</p>
          <div class="agents-quote">“{agent.prompt}”</div>
          <div class="agents-card-actions">
            <CopyButton onCopy={() => copy(agent.prompt, PROMPT_COPIED_TOAST)}>Copy prompt</CopyButton>
          </div>
        </div>
      </section>)}
    </div>
    <section class="card">
      <header class="card-head">
        <div><h2>Let an outside agent do the AI first read</h2><span class="subtle">A worked example · your agent reads the pile, you decide the program</span></div>
        <Chip>Example</Chip>
      </header>
      <div class="card-body">
        <p>
          A conference with a thousand proposals has one real problem on a Tuesday night: what to read
          first. Marquee will not do that reading for you — there is no model running in here. What it
          has instead is a seat your own agent can sit in, and a place to put what it thought.
        </p>
        <div class="agents-contract-line"><span class="agents-contract-key">Mint the seat</span><span>On a committee, create an Agent evaluator seat. It is a real reviewer seat with its own name, its own track responsibilities, and its own token — created and revoked like any other.</span></div>
        <div class="agents-contract-line"><span class="agents-contract-key">Point your agent at it</span><span>Give it the MCP config above with that token. It can reach its own queue and nothing else.</span></div>
        <div class="agents-contract-line"><span class="agents-contract-key">Read the result beside your own</span><span>An agent's score is shown next to the committee's and is never averaged into the human number. Sort the pile by <em>Agent read high → low</em> to order your evening.</span></div>
        <div class="agents-contract-line"><span class="agents-contract-key">Disagree freely</span><span>A chair can override any agent score, and the row then shows the override. The first read is a suggestion about reading order, not a verdict.</span></div>
        <div class="agents-quote">“{AGENT_FIRST_READ_BRIEF}”</div>
        <div class="agents-card-actions">
          <CopyButton onCopy={() => copy(AGENT_FIRST_READ_BRIEF, PROMPT_COPIED_TOAST)}>Copy brief</CopyButton>
        </div>
      </div>
    </section>
    <div class="agents-next-year">When the year turns: <code>event create --from</code> stands up the next conference — structure carried across, people already there.</div>
    {/* The shell's own two-up, which already collapses to one column on a
        phone — the contract cards want no layout of their own. */}
    <div class="grid-2">
      <section class="card">
        <header class="card-head"><div><h2>Built for verification</h2><span class="subtle">Why agents work well here</span></div></header>
        <div class="card-body">
          <div class="agents-contract-line"><span class="agents-contract-key">State back</span><span>Every write returns the resulting record. Agents verify, never infer.</span></div>
          <div class="agents-contract-line"><span class="agents-contract-key">Server-side selection</span><span>Filters resolve in Marquee, never guessed from a paginated page.</span></div>
          <div class="agents-contract-line"><span class="agents-contract-key">Guarded writes</span><span>A stale agenda write fails with a conflict instead of clobbering.</span></div>
          <div class="agents-contract-line"><span class="agents-contract-key">One JSON value</span><span><code>--json</code> writes exactly one JSON value to stdout.</span></div>
        </div>
      </section>
      <section class="card">
        <header class="card-head"><div><h2>What stays human</h2><span class="subtle">Drawn on purpose, not by omission</span></div></header>
        <div class="card-body">
          <div class="agents-contract-line"><span class="agents-contract-key">Ownership</span><span>The one-time claim link is opened by a person, never an agent.</span></div>
          <div class="agents-contract-line"><span class="agents-contract-key">Going public</span><span>Opening intake and publishing are operator clicks.</span></div>
          <div class="agents-contract-line"><span class="agents-contract-key">Decisions</span><span>A reviewer seat recommends. Organizers accept and reject.</span></div>
          <div class="agents-contract-line"><span class="agents-contract-key">Accountability</span><span>Every token action lands in the <a href="/org/activity" onClick={go("/org/activity")}>Activity log</a>; any token is <a href="/org/tokens" onClick={go("/org/tokens")}>revocable</a> in one click.</span></div>
        </div>
      </section>
    </div>
  </>;
}
