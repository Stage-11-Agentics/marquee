import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { apiFetch } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader } from "../shell/components";
import { CONFERENCE_CHECKLIST_STEPS } from "./checklist";
import "./setup.css";

/**
 * From a conference record to an open call for speakers, in five steps.
 *
 * Each step's done-state is READ, never remembered: the checklist asks the same
 * routes the screens do, so a step ticked here is a step that is actually true
 * of the conference. A checklist that stores its own progress is a checklist
 * that congratulates you for work you undid.
 */

const SETTINGS_ROUTE = "/api/v1/events/{eventId}";
const FORMS_ROUTE = "/api/v1/events/{eventId}/forms";
const PLANS_ROUTE = "/api/v1/events/{eventId}/plans";

interface Progress {
  details: boolean;
  taxonomy: boolean;
  form: boolean;
  evaluation: boolean;
  intake: boolean;
}

const NOTHING_DONE: Progress = {
  details: false,
  taxonomy: false,
  form: false,
  evaluation: false,
  intake: false,
};

async function readProgress(eventId: string): Promise<Progress> {
  const encoded = encodeURIComponent(eventId);
  const [settings, forms, evaluation] = await Promise.all([
    apiFetch<{ data: { event: { name: string }; formats: unknown[]; tracks: unknown[] } }>(
      `/api/v1/events/${encoded}`,
      { route: SETTINGS_ROUTE },
    ).catch(() => null),
    apiFetch<{ data: { status: string }[] }>(`/api/v1/events/${encoded}/forms`, {
      route: FORMS_ROUTE,
    }).catch(() => null),
    apiFetch<{ data: unknown[] }>(`/api/v1/events/${encoded}/plans`, { route: PLANS_ROUTE })
      .catch(() => null),
  ]);
  const formRows = forms?.data ?? [];
  return {
    details: settings !== null,
    taxonomy: (settings?.data.tracks.length ?? 0) > 0 && (settings?.data.formats.length ?? 0) > 0,
    form: formRows.length > 0,
    evaluation: (evaluation?.data.length ?? 0) > 0,
    intake: formRows.some((form) => form.status === "open"),
  };
}

export function SetupChecklistCard({
  eventId,
  navigate,
}: {
  eventId: string;
  navigate: (target: string) => void;
}): JSX.Element {
  const [progress, setProgress] = useState<Progress>(NOTHING_DONE);

  useEffect(() => {
    let cancelled = false;
    void readProgress(eventId).then((next) => { if (!cancelled) setProgress(next); });
    return () => { cancelled = true; };
  }, [eventId]);

  const steps = CONFERENCE_CHECKLIST_STEPS.map((step) => ({
    ...step,
    done: progress[step.key as keyof Progress] === true,
  }));
  const done = steps.filter((step) => step.done).length;
  const nextIndex = steps.findIndex((step) => !step.done);

  return <Card>
    <CardHeader title="Set up your conference">
      <span class="subtle tabular">{done} of {steps.length}</span>
    </CardHeader>
    <CardBody>
      <div class="setup-steps">
        {steps.map((step, index) => <div key={step.key} class={`setup-step ${step.done ? "done" : index === nextIndex ? "next" : "later"}`}>
          <span class="setup-mark" aria-hidden="true">{step.done ? "✓" : index + 1}</span>
          <span class="setup-step-copy"><strong>{step.label}</strong><span>{step.note}</span></span>
          <Button small variant={index === nextIndex ? "primary" : ""} onClick={() => navigate(step.route)}>
            {step.done ? "Review" : step.action}
          </Button>
        </div>)}
      </div>
    </CardBody>
  </Card>;
}
