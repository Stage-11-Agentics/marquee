import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { agentBrief, AGENT_BRIEF_PARITY, type AgentBriefCopy, type AgentBriefSurface } from "./agent-briefs";
import { useDialogLifecycle } from "./OverlayHosts";
import "./agent-brief.css";

/**
 * The panel shape, lifted one-to-one from the binding prototype
 * (`prototypes/crm/index.html`, the "Import people" modal): label, one line of
 * human-facing explanation, the brief in a readable block, a full-width primary
 * Copy button, then a muted single line naming the endpoint for anyone who
 * would rather drive it themselves.
 *
 * Exported on its own so a surface that already has a modal — People → import —
 * can render the brief inside it rather than behind a second overlay.
 */
export function AgentBriefPanel({ copy }: { copy: AgentBriefCopy }): JSX.Element {
  const briefRef = useRef<HTMLPreElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");

  // The confirmation has to be visible without moving anything. The button is
  // full-width, so swapping its label cannot change its size — and nothing is
  // inserted or removed to say "copied", which is what would push the muted
  // endpoint line down the panel.
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2400);
    return () => clearTimeout(timer);
  }, [state]);

  const onCopy = useCallback(() => {
    const text = briefRef.current?.textContent ?? copy.brief;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(() => setState("copied")).catch(() => selectBrief(briefRef.current, setState));
      return;
    }
    // No clipboard API — an insecure origin, or a browser that withholds it.
    // Selecting the text leaves the operator one keystroke from the same
    // result, which is a working path rather than a dead button.
    selectBrief(briefRef.current, setState);
  }, [copy.brief]);

  const label = state === "copied" ? "Copied — paste it into your agent" : state === "selected" ? "Selected — press ⌘C to copy" : "Copy for your agent";

  return <div class="agent-brief" data-agent-brief-state={state}>
    <label class="agent-brief-label" for="agent-brief-text">{copy.label}</label>
    <p class="agent-brief-hint">{copy.hint}</p>
    <div class="agent-brief-box">
      <pre id="agent-brief-text" ref={briefRef} class="agent-brief-text" tabIndex={0}>{copy.brief}</pre>
      <button class="button primary agent-brief-copy" type="button" onClick={onCopy}>
        <span aria-live="polite">{label}</span>
      </button>
    </div>
    <p class="agent-brief-note">
      {copy.note} {AGENT_BRIEF_PARITY} <span class="agent-brief-endpoint">{copy.endpoint}</span>, if you'd rather drive it yourself.
    </p>
  </div>;
}

function selectBrief(node: HTMLPreElement | null, setState: (value: "selected") => void): void {
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  if (node && selection) {
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    node.focus();
  }
  setState("selected");
}

/**
 * The trigger and its overlay. A surface adds exactly one element and keeps
 * every control it already had: the brief costs no vertical space on screens
 * that are already dense, so nothing has to shrink or move to make room for it.
 */
export function AgentBriefLauncher({ surface, eventId, origin, small = false }: { surface: AgentBriefSurface; eventId: string; origin?: string; small?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const dialogRef = useDialogLifecycle(open, close);
  // The real URL of the running deployment, resolved where it is true. A
  // constant here would be a placeholder on every deployment but one.
  const resolvedOrigin = origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  const copy = agentBrief(surface, { origin: resolvedOrigin, eventId });

  return <>
    <button
      class={`button agent-brief-trigger${small ? " small" : ""}`}
      type="button"
      data-agent-brief-trigger={surface}
      aria-haspopup="dialog"
      aria-expanded={open ? "true" : "false"}
      onClick={() => setOpen(true)}
    >{copy.title}</button>
    {open && <div class="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
      <section ref={dialogRef as never} class="modal agent-brief-modal" role="dialog" aria-modal="true" aria-label={copy.title} tabIndex={-1}>
        <header class="modal-head"><h2>{copy.title}</h2><p>Marquee is one product with two front doors. This is the other one.</p></header>
        <div class="modal-body"><AgentBriefPanel copy={copy} /></div>
        <footer class="modal-actions"><button class="button" type="button" onClick={close}>Close</button></footer>
      </section>
    </div>}
  </>;
}
