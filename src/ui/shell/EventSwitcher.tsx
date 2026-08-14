import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { useEventContext, type EventSummary } from "./event-context";

/**
 * The conference name, promoted from caption to control.
 *
 * It was a caption on purpose while there was nothing to pick: the element it
 * replaced was a link back to the page you were already on, dressed as a
 * switcher. Now there is something to pick, and this opens a list rather than
 * navigating anywhere.
 *
 * The closed state keeps the caption's exact box — the same left rule, the same
 * padding, the same row height pinned by the ＋ beside it — so promoting it
 * moves nothing below it in the sidebar. The popover is where the new weight
 * goes.
 */

const FILTER_THRESHOLD = 8;

function chipFor(event: EventSummary): { label: string; className: string } {
  if (event.demo_mode === 1) return { label: "DEMO", className: "demo" };
  return event.status === "live"
    ? { label: "LIVE", className: "live" }
    : { label: "DRAFT", className: "draft" };
}

/**
 * `2026-10-19` + `2026-10-21` → `Oct 19–21 2026`. Dates are stored as calendar
 * strings, so they are read as calendar strings: constructing a Date from one
 * and formatting it locally is how a conference loses a day in a western
 * timezone.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatEventDates(startsOn: string, endsOn: string): string {
  const [startYear, startMonth, startDay] = startsOn.split("-");
  const [endYear, endMonth, endDay] = endsOn.split("-");
  if (!startYear || !startMonth || !startDay || !endYear || !endMonth || !endDay) return startsOn;
  const startLabel = `${MONTHS[Number(startMonth) - 1] ?? startMonth} ${Number(startDay)}`;
  if (startYear === endYear && startMonth === endMonth) return `${startLabel}–${Number(endDay)} ${startYear}`;
  const endLabel = `${MONTHS[Number(endMonth) - 1] ?? endMonth} ${Number(endDay)}`;
  return startYear === endYear
    ? `${startLabel} – ${endLabel} ${startYear}`
    : `${startLabel} ${startYear} – ${endLabel} ${endYear}`;
}

export function EventSwitcher({
  eventName,
  navigate,
}: { eventName: string; navigate: (target: string) => void }): JSX.Element {
  const { events, eventId, switchEvent, status } = useEventContext();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [focusIndex, setFocusIndex] = useState(-1);
  const [anchor, setAnchor] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setFilter("");
    setFocusIndex(-1);
  }, []);

  /**
   * The popover is measured onto the viewport rather than laid out inside the
   * sidebar. The sidebar scrolls (`overflow-y: auto`), and a scroll container
   * clips both axes — so an absolutely-positioned popover 264px wide inside a
   * 224px column loses its status chips and submission gauges off the right
   * edge, which is precisely the information the list exists to show.
   */
  const position = useCallback(() => {
    const box = triggerRef.current?.getBoundingClientRect();
    if (box) setAnchor({ left: box.left, top: box.bottom + 4 });
  }, []);

  useEffect(() => {
    if (!open) return;
    position();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !rootRef.current?.contains(target)) close();
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", position);
    // Capture phase: the sidebar's own scroll does not bubble.
    window.addEventListener("scroll", position, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, close, position]);

  const query = filter.trim().toLowerCase();
  const matching = query.length === 0
    ? events
    : events.filter((event) => event.name.toLowerCase().includes(query));
  const upcoming = matching.filter((event) => !event.past);
  const past = matching.filter((event) => event.past);
  // Rows first, then the create action: arrow keys walk what is on screen, in
  // the order it is on screen.
  const rows: (EventSummary | "create")[] = [...upcoming, ...past, "create"];

  const choose = useCallback((row: EventSummary | "create") => {
    close();
    if (row === "create") {
      navigate("/conferences/new");
      return;
    }
    switchEvent(row.id);
    navigate("/dashboard");
  }, [close, navigate, switchEvent]);

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setFocusIndex((current) => {
        const next = event.key === "ArrowDown"
          ? Math.min(current + 1, rows.length - 1)
          : Math.max(current - 1, 0);
        return next;
      });
      return;
    }
    if (event.key === "Enter" && focusIndex >= 0) {
      const row = rows[focusIndex];
      if (row) {
        event.preventDefault();
        choose(row);
      }
    }
  };

  const renderRow = (event: EventSummary, index: number) => {
    const chip = chipFor(event);
    const current = event.id === eventId;
    return <button
      key={event.id}
      type="button"
      role="option"
      aria-selected={current}
      data-event-row={event.id}
      class={`pop-item${current ? " current" : ""}${event.past ? " past" : ""}${index === focusIndex ? " kbd-focus" : ""}`}
      onClick={() => choose(event)}
    >
      <span class="name">{event.name}</span>
      <span class={`chip ${chip.className}`}>{chip.label}</span>
      <span class="dates mono">{formatEventDates(event.starts_on, event.ends_on)}</span>
      <span class="gauge mono">{event.submission_count} subs</span>
    </button>;
  };

  const createIndex = rows.length - 1;

  return <div class="event-switcher-root" ref={rootRef} onKeyDown={onKeyDown}>
    <div class="event-context-row">
      <button
        ref={triggerRef}
        type="button"
        class="event-context event-switcher"
        aria-expanded={open}
        aria-haspopup="listbox"
        data-event-switcher
        title="Switch conference"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {/* No eyebrow inside the button: the "Conference" group label above it
            names this the same way every other group in the sidebar is named,
            and saying it twice in two different voices named it neither. */}
        <span class="event-context-copy"><strong>{eventName}</strong></span>
        <span class="event-caret" aria-hidden="true">▾</span>
      </button>
      {/*
        The ＋ is unchanged: next year's conference is the cold start most
        organizers actually live, and it opens the same screen — and therefore
        the same create endpoint — that setting up by hand uses.
      */}
      <a class="event-add" href="/conferences/new" title="Create conference" aria-label="Create conference" onClick={(event) => { event.preventDefault(); close(); navigate("/conferences/new"); }}>＋</a>
    </div>

    {open && <div class="switcher-pop" role="listbox" aria-label="Conferences" data-event-popover style={{ left: `${anchor.left}px`, top: `${anchor.top}px` }}>
      {events.length > FILTER_THRESHOLD && <div class="pop-filter">
        <input
          type="search"
          aria-label="Filter conferences"
          placeholder="Filter conferences…"
          value={filter}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the popover is opened deliberately, and typing is why
          autoFocus
          onInput={(event) => { setFilter((event.currentTarget as HTMLInputElement).value); setFocusIndex(-1); }}
        />
      </div>}
      {status === "loading" && <div class="pop-hint">Reading your conferences…</div>}
      {upcoming.length > 0 && <div class="pop-label microlabel">Upcoming</div>}
      {upcoming.map((event, index) => renderRow(event, index))}
      {past.length > 0 && <><hr class="pop-rule" /><div class="pop-label microlabel">Past</div></>}
      {past.map((event, index) => renderRow(event, upcoming.length + index))}
      {matching.length === 0 && status !== "loading" && <div class="pop-hint">No conference matches that.</div>}
      <hr class="pop-rule" />
      <button
        type="button"
        class={`pop-create${focusIndex === createIndex ? " kbd-focus" : ""}`}
        data-create-conference
        onClick={() => choose("create")}
      >＋ Create conference</button>
      <div class="pop-hint">↑↓ select · ⏎ switch · esc close · also in ⌘K search</div>
    </div>}
  </div>;
}
