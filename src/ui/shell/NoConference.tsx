import type { JSX } from "preact";

import { Button, EmptyState, PageHeader } from "./components";
import { useEventContext } from "./event-context";

/**
 * What the organizer surfaces show when there is no conference to scope them
 * to — a fresh instance, a seat whose only conference was removed, or the
 * moment after a reset while the list is being re-read.
 *
 * Every page below this point takes a required `eventId`, which is what makes
 * it impossible to render one unscoped. This is the honest answer for the case
 * that requirement creates, rather than a screen full of zeroes that looks like
 * a conference with nothing in it.
 */
export function NoConference({ navigate }: { navigate: (target: string) => void }): JSX.Element {
  const { status, error, refresh } = useEventContext();

  if (status === "error") {
    return <>
      <PageHeader title="Your conferences could not be read" copy="The list the whole shell is scoped to did not answer." />
      <EmptyState
        title="Nothing is scoped yet"
        copy={error || "Try again; if it repeats, copy the diagnostic report and file it."}
        action={<Button variant="primary" onClick={() => void refresh()}>Try again</Button>}
      />
    </>;
  }

  if (status === "loading") {
    return <>
      <PageHeader title="Reading your conferences" copy="Every list, gauge, and search below is scoped to one conference." />
      <EmptyState title="Reading your conferences…" copy="This is the boot read that decides which conference this tab is looking at." />
    </>;
  }

  return <>
    <PageHeader title="No conference yet" copy="Marquee runs one conference at a time, and this account can read none of them yet." />
    <EmptyState
      title="Create your first conference"
      copy="Name it, give it dates, and the forms, portal, agenda and calendar invites all inherit them. If you are here as a speaker or a reviewer, your own surface is the speaker portal or the review queue."
      action={<Button variant="primary" onClick={() => navigate("/conferences/new")}>Create conference</Button>}
    />
  </>;
}
