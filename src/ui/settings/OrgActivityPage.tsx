import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, EmptyState, PageHeader } from "../shell/components";
import { appendUnseen } from "../history/paging";
import "./settings.css";

/**
 * Lens one: the organization log.
 *
 * One append-only log, three lenses — this is the admin one. The person's CRM
 * feed and the submission record's timeline read the same `audit_log` rows
 * through the same server-side projection, which is why every sentence on this
 * page arrives already written: two surfaces composing their own copy for one
 * row is how the three lenses would start disagreeing about the same day.
 *
 * The steady-state home for this is the Activity tab of Organization settings
 * (MRQ-207's shell). Until that shell lands it stands alone at `/org/activity`,
 * which is a placement question, not a different page — 207 mounts this exact
 * component.
 */

export interface ActivityEvent {
  id: string;
  action: string;
  summary: string;
  detail: string | null;
  actor_kind: string | null;
  actor_person_id: string | null;
  actor_name: string | null;
  entity_type: string;
  entity_id: string;
  event_id: string | null;
  event_name: string | null;
  created_at: number;
}

interface ActivityPage {
  data: ActivityEvent[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; events: ActivityEvent[]; total: number; page: number; totalPages: number }
  | { kind: "error"; message: string };

const PER_PAGE = 50;
const ACTIVITY_ROUTE = "/api/v1/org/activity";

/**
 * Absolute, with the time: an audit line without a clock answers half the
 * question. The formatter is built once — constructing an `Intl` formatter is
 * the expensive half of formatting, and this one runs per row per render (R7).
 */
const MOMENT_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function activityMoment(value: number): string {
  return MOMENT_FORMAT.format(value);
}

/**
 * Who did it, in one phrase. A row whose actor is not a person says so rather
 * than borrowing a name that did not do the work — the same rule the submission
 * record's History card follows.
 */
export function actorLine(entry: ActivityEvent): string {
  if (entry.actor_name) return entry.actor_name;
  if (entry.actor_kind === "api_token") return "An API token";
  if (entry.actor_kind === "system") return "Marquee";
  return "Conference team";
}

export function ActivityRow({ entry }: { entry: ActivityEvent }): JSX.Element {
  return <div class="org-activity-row">
    <div class="org-activity-fact">
      <strong>{entry.summary}</strong>
      {entry.detail && <span class="subtle">{entry.detail}</span>}
    </div>
    <div class="org-activity-meta">
      <span>{actorLine(entry)}</span>
      {/* Null `event_name` is the honest word for an action about the
          organization itself, not a missing value to hide. */}
      <span class="subtle">{entry.event_name ?? "All conferences"}</span>
      <time class="tabular" dateTime={new Date(entry.created_at).toISOString()}>{activityMoment(entry.created_at)}</time>
    </div>
  </div>;
}

export function OrgActivityPage(): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [pending, setPending] = useState(false);

  async function load(page: number, existing: ActivityEvent[], signal?: AbortSignal): Promise<void> {
    try {
      const result = await apiFetch<ActivityPage>(`${ACTIVITY_ROUTE}?page=${page}&per_page=${PER_PAGE}`, {
        credentials: "include",
        route: ACTIVITY_ROUTE,
        ...(signal ? { signal } : {}),
      });
      setState({
        kind: "ready",
        // The log grows while it is being read, which shifts the offset window:
        // without this, a row written between two pages arrives in both.
        events: appendUnseen(existing, result.data),
        total: result.total,
        page: result.page,
        totalPages: result.total_pages,
      });
    } catch (error) {
      if (signal?.aborted) return;
      setState({ kind: "error", message: errorSummary(error) });
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(1, [], controller.signal);
    return () => controller.abort();
  }, []);

  const body = state.kind === "loading"
    ? <div class="token-skeleton" aria-busy="true" aria-label="Loading organization activity"><span class="skeleton-line wide" /><span class="skeleton-line" /><span class="skeleton-line" /></div>
    : state.kind === "error"
      ? <div class="settings-error" role="alert"><strong>Activity unavailable</strong><span>{state.message}</span><Button small onClick={() => { setState({ kind: "loading" }); void load(1, []); }}>Retry</Button></div>
      : state.events.length === 0
        ? <EmptyState title="Nothing recorded yet" copy="Invites, organizer access, API tokens, defaults and ownership transfers are recorded here as they happen." />
        : <Card>
            <CardHeader title="Organization log">
              <span class="subtle">Removal survives here — access ends, the record doesn't</span>
            </CardHeader>
            <CardBody>
              <div class="org-activity-list">
                {state.events.map((entry) => <ActivityRow key={entry.id} entry={entry} />)}
              </div>
              {/* The count is stated whether or not there is more to load, so the
                  control below never moves the numbers around it when it goes. */}
              <div class="org-activity-foot">
                <span class="subtle tabular">{state.events.length} of {state.total}</span>
                {state.page < state.totalPages
                  ? <Button
                      small
                      disabled={pending}
                      onClick={() => {
                        setPending(true);
                        void load(state.page + 1, state.events).finally(() => setPending(false));
                      }}
                    >{pending ? "Loading…" : "Load more"}</Button>
                  : <span class="subtle">Complete</span>}
              </div>
            </CardBody>
          </Card>;

  return <div class="settings-page org-activity-page">
    <PageHeader
      title="Activity"
      copy="One append-only log, three lenses: this admin lens, each person's feed in People, and each submission's timeline on its record. This is the admin lens — seats, invites, tokens, defaults."
    />
    {body}
  </div>;
}
