/**
 * Outreach — prospects being worked toward a slot.
 *
 * Cards move by the "Move to" menu, never by drag. That is the same ruling the
 * program board carries: a consequential action lives on a control that names
 * it, so it cannot happen because a hand slipped.
 *
 * Every move appends to the annotations log, so the card's history is the log
 * rather than a second table that can fall out of step with it.
 */
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { errorSummary } from "../shell/api-client";
import { disambiguatedNames } from "../../lib/duplicate-names";
import { isOutreachOverdue } from "../../lib/person-annotations";
import { Button, EmptyState, PageHeader } from "../shell/components";
import { PersonDrawer } from "./PersonDrawer";
import { fetchPipeline, setStage, type PipelineCard, type PipelineStage } from "./people-api";
import "./people.css";

export function OutreachCard({
  card,
  displayName,
  stages,
  busy,
  onMove,
  onOpen,
}: {
  card: PipelineCard;
  displayName: string;
  stages: PipelineStage[];
  busy: boolean;
  onMove: (stage: string) => void;
  onOpen: () => void;
}): JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const measure = () => {
      setOverflowing(element.scrollWidth > element.clientWidth + 1);
      setMeasured(true);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [card.name, card.target_event_name, card.stage]);

  const overdue = isOutreachOverdue(card.next_touch_on, card.stage);
  return <div
    ref={cardRef}
    class="people-card"
    data-outreach-card="true"
    data-overflow={measured ? (overflowing ? "true" : "false") : undefined}
  >
    <button type="button" class="people-rowlink" title={card.name} onClick={onOpen}>
      <span class="people-card-name">{displayName}</span>
    </button>
    <div class="people-card-company">{card.company ?? "—"}</div>
    <div class="people-card-target" title={card.target_event_name ? `→ ${card.target_event_name}` : "→ No conference target"}>
      → {card.target_event_name ?? "No conference target yet"}
    </div>
    <div class={`people-card-next ${overdue ? "overdue" : ""}`}>
      {card.next_touch_on ? `Next touch · ${card.next_touch_on}` : "No next touch set"}
    </div>
    <div class="people-card-foot">
      <span class="people-card-score">{card.score === null ? "—" : `Score ${card.score}`}</span>
      <select
        class="people-moveto"
        aria-label={`Move ${displayName} to another stage`}
        disabled={busy}
        value={card.stage}
        onChange={(event) => onMove((event.currentTarget as HTMLSelectElement).value)}
      >
        {stages.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}
      </select>
    </div>
  </div>;
}

export function SourcingPipelinePage({
  search = "",
  navigate,
}: {
  search?: string;
  navigate?: (target: string) => void;
}): JSX.Element {
  const openPersonId = new URLSearchParams(search).get("person");
  const [board, setBoard] = useState<{
    stages: PipelineStage[];
    cards: PipelineCard[];
    target_events: Array<{ id: string; name: string }>;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchPipeline(controller.signal)
      .then(setBoard)
      .catch((caught: unknown) => { if (!controller.signal.aborted) setError(errorSummary(caught)); });
    return () => controller.abort();
  }, [reloadToken]);

  const move = async (personId: string, stage: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await setStage(personId, { stage });
      setReloadToken((token) => token + 1);
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setBusy(false);
    }
  };

  const stages = board?.stages ?? [];
  const cards = board?.cards ?? [];
  // Derived across the whole board, not per column: the two namesakes are most
  // likely to sit in different stages, and each card carries a stage control.
  const cardNames = disambiguatedNames(cards.map((card) => ({ id: card.person_id, name: card.name })));

  return <div class="people-page">
    <PageHeader
      title="Outreach"
      copy="People you want on a stage before any submission exists…"
      actions={<><Button onClick={() => navigate?.("/people")}>Back to People</Button><Button variant="primary" onClick={() => navigate?.("/people")}>+ Add prospect</Button></>}
    />

    {error ? <div class="people-table-wrap"><div class="people-state error" role="alert">{error}</div></div> : null}
    {!board && !error ? <div class="people-table-wrap"><div class="people-state">Reading the pipeline…</div></div> : null}

    {board && cards.length === 0 ? <EmptyState
      title="Nobody in the pipeline yet"
      copy="Open anyone in People and move them to a stage — Researching or Identified is where Outreach usually starts."
      action={<Button variant="primary" onClick={() => navigate?.("/people")}>+ Add prospect</Button>}
    /> : null}

    {board && cards.length > 0 ? <div class="people-board">
      {stages.map((stage) => {
        const inStage = cards
          .filter((card) => card.stage === stage.id)
          .sort((left, right) => {
            const leftOverdue = isOutreachOverdue(left.next_touch_on, left.stage);
            const rightOverdue = isOutreachOverdue(right.next_touch_on, right.stage);
            if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
            return (left.next_touch_on ?? "\uffff").localeCompare(right.next_touch_on ?? "\uffff")
              || right.moved_at - left.moved_at;
          });
        return <div class="people-column" key={stage.id}>
          <div class="people-column-head">
            <div class="people-column-line">
              <strong>{stage.name}</strong>
              <span class="people-column-count">{inStage.length}</span>
            </div>
            <span class={`people-column-kind ${stage.kind}`}>{stage.kind}</span>
          </div>
          <div class="people-column-body">
            {inStage.length === 0 ? <span class="people-hint">—</span> : inStage.map((card) => <OutreachCard
              key={card.person_id}
              card={card}
              displayName={cardNames.get(card.person_id) ?? card.name}
              stages={stages}
              busy={busy}
              onMove={(stage) => void move(card.person_id, stage)}
              onOpen={() => navigate?.(`/pipeline?person=${encodeURIComponent(card.person_id)}`)}
            />)}
          </div>
        </div>;
      })}
    </div> : null}

    {board && cards.length > 0 ? <p class="people-hint">
      Cards move by the <strong>Move to</strong> menu, not by drag — consequential actions live on the
      control that names them. Overdue next touches stay at the top of each stage.
    </p> : null}

    {openPersonId ? <PersonDrawer
      personId={openPersonId}
      onClose={() => navigate?.("/pipeline")}
      navigate={navigate}
      onChanged={() => setReloadToken((token) => token + 1)}
    /> : null}
  </div>;
}
