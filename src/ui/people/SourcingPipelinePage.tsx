/**
 * The sourcing pipeline — prospects being worked toward a slot.
 *
 * Cards move by the "Move to" menu, never by drag. That is the same ruling the
 * program board carries: a consequential action lives on a control that names
 * it, so it cannot happen because a hand slipped.
 *
 * Every move appends to the annotations log, so the card's history is the log
 * rather than a second table that can fall out of step with it.
 */
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { errorSummary } from "../shell/api-client";
import { Button, EmptyState, PageHeader } from "../shell/components";
import { PersonDrawer } from "./PersonDrawer";
import { fetchPipeline, setStage, type PipelineCard, type PipelineStage } from "./people-api";
import "./people.css";

export function SourcingPipelinePage({
  search = "",
  navigate,
}: {
  search?: string;
  navigate?: (target: string) => void;
}): JSX.Element {
  const openPersonId = new URLSearchParams(search).get("person");
  const [board, setBoard] = useState<{ stages: PipelineStage[]; cards: PipelineCard[] } | null>(null);
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

  return <div class="people-page">
    <PageHeader
      title="Sourcing pipeline"
      copy="Prospects being worked toward a slot. Cards carry a score and a rationale; every stage move is recorded with a timestamp and survives a reload."
      actions={<Button onClick={() => navigate?.("/people")}>Back to People</Button>}
    />

    {error ? <div class="people-table-wrap"><div class="people-state error" role="alert">{error}</div></div> : null}
    {!board && !error ? <div class="people-table-wrap"><div class="people-state">Reading the pipeline…</div></div> : null}

    {board && cards.length === 0 ? <EmptyState
      title="Nobody in the pipeline yet"
      copy="Open anyone in People and move them to a stage — Researching or Identified is where sourcing usually starts."
      action={<Button variant="primary" onClick={() => navigate?.("/people")}>Open People</Button>}
    /> : null}

    {board && cards.length > 0 ? <div class="people-board">
      {stages.map((stage) => {
        const inStage = cards.filter((card) => card.stage === stage.id);
        return <div class="people-column" key={stage.id}>
          <div class="people-column-head">
            <div class="people-column-line">
              <strong>{stage.name}</strong>
              <span class="people-column-count">{inStage.length}</span>
            </div>
            <span class={`people-column-kind ${stage.kind}`}>{stage.kind}</span>
          </div>
          <div class="people-column-body">
            {inStage.length === 0 ? <span class="people-hint">—</span> : inStage.map((card) => <div class="people-card" key={card.person_id}>
              <button
                type="button"
                class="people-rowlink"
                onClick={() => navigate?.(`/pipeline?person=${encodeURIComponent(card.person_id)}`)}
              ><span class="people-card-name">{card.name}</span></button>
              <div class="people-card-company">{card.company ?? "—"}</div>
              <div class="people-card-foot">
                <span class="people-card-score">{card.score === null ? "No score" : `Score ${card.score}`}</span>
                <select
                  class="people-moveto"
                  aria-label={`Move ${card.name} to another stage`}
                  disabled={busy}
                  value={card.stage}
                  onChange={(event) => void move(card.person_id, (event.currentTarget as HTMLSelectElement).value)}
                >
                  {stages.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}
                </select>
              </div>
            </div>)}
          </div>
        </div>;
      })}
    </div> : null}

    {board && cards.length > 0 ? <p class="people-hint">
      Cards move by the <strong>Move to</strong> menu, not by drag — consequential actions live on the
      control that names them.
    </p> : null}

    {openPersonId ? <PersonDrawer
      personId={openPersonId}
      onClose={() => navigate?.("/pipeline")}
      onChanged={() => setReloadToken((token) => token + 1)}
    /> : null}
  </div>;
}
