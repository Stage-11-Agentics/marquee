import type { JSX } from "preact";
import { useCallback } from "preact/hooks";

import { Chip, PageHeader } from "../shell/components";
import { announce } from "../shell/OverlayHosts";
import {
  AGENTS_ROSTER,
  agentsConnectPrompt,
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
 * machine doors, four agents worth running, and two honesty cards. No runtime
 * name-dropping, no command anatomy — the reference already exists and this page
 * points at it rather than reprinting it.
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
