/**
 * The attendee's schedule, client side — one vanilla module, no framework.
 *
 * Public pages are server-rendered strings and carry no Preact runtime, so
 * everything the star does ships as this single script. It binds to the card
 * hook contract (`data-public-session-*`) rather than to any markup, which is
 * why a card can be re-rendered without touching this file — and why a
 * computer-use agent driving the real UI finds the same handles.
 *
 * Two rules shape it. Stars are written to localStorage synchronously, because
 * the attendee is standing in a hallway on hotel wifi and a star must never
 * wait on a network. And nothing jumps: every slot this fills was rendered at
 * its final size by the server.
 */
export const PUBLIC_SCHEDULE_SCRIPT = `
(() => {
  const root = document.querySelector('[data-public-schedule]');
  if (!root) return;

  let config;
  try { config = JSON.parse(root.dataset.publicSchedule); } catch { return; }
  const STORAGE_KEY = 'marquee:schedule:' + config.eventSlug;
  const ORIGIN_KEY = 'marquee:schedule-origin:' + config.eventSlug;
  const MINE = config.view === 'mine';

  /* ── State ─────────────────────────────────────────────────────────── */

  const emptyState = () => ({ v: 1, sessionIds: [], code: null, writeKey: null });

  function readState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sessionIds)) return emptyState();
      return {
        v: 1,
        sessionIds: raw.sessionIds.filter((id) => typeof id === 'string'),
        code: typeof raw.code === 'string' ? raw.code : null,
        writeKey: typeof raw.writeKey === 'string' ? raw.writeKey : null,
      };
    } catch { return emptyState(); }
  }

  function writeState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode: the session still works */ }
  }

  let state = readState();
  const starred = new Set(state.sessionIds);
  const isStarred = (id) => starred.has(id);

  /* ── The program, read from the card hooks ─────────────────────────── */

  const cardsById = new Map();
  function readCards() {
    cardsById.clear();
    for (const card of document.querySelectorAll('[data-public-session-id]')) {
      const id = card.dataset.publicSessionId;
      if (!id || cardsById.has(id)) continue;
      cardsById.set(id, {
        id,
        card,
        slug: card.dataset.publicSessionSlug || '',
        title: card.dataset.publicSessionTitle || '',
        room: card.dataset.publicSessionRoom || '',
        speakers: card.dataset.publicSessionSpeakers || '',
        day: card.dataset.publicSessionDay || '',
        start: Number(card.dataset.publicSessionStart || 0),
        end: Number(card.dataset.publicSessionEnd || 0),
      });
    }
  }
  readCards();

  const mineSessions = () => [...cardsById.values()]
    .filter((session) => isStarred(session.id))
    .sort((left, right) => left.start - right.start);

  /** Touching is not overlapping: a 14:00–14:45 and a 14:45–15:30 are a plan, not a conflict. */
  const overlaps = (left, right) => left.start < right.end && right.start < left.end;
  const overlapsFor = (session, set) => set.filter((other) => other.id !== session.id && overlaps(session, other));

  /* ── Clock, in the event's timezone ────────────────────────────────── */

  const zoneParts = (instant) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(instant));
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const hour = value.hour === '24' ? '00' : value.hour;
    return { date: value.year + '-' + value.month + '-' + value.day, time: hour + ':' + value.minute, minutes: Number(hour) * 60 + Number(value.minute) };
  };
  const hhmm = (instant) => zoneParts(instant).time;

  /* ── Rendering ─────────────────────────────────────────────────────── */

  const countEl = document.querySelector('[data-schedule-count]');
  const mySchedButton = document.querySelector('.mysched-btn');

  function paintStars() {
    for (const button of document.querySelectorAll('[data-schedule-star]')) {
      const id = button.dataset.scheduleStar;
      const on = isStarred(id);
      const session = cardsById.get(id);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.setAttribute('aria-label', (on ? 'Remove from' : 'Add to') + ' my schedule' + (session && session.title ? ': ' + session.title : ''));
    }
    if (countEl) countEl.textContent = String(starred.size);
    if (mySchedButton) mySchedButton.classList.toggle('has-stars', starred.size > 0);
  }

  /**
   * The itinerary view: the same server-rendered program with everything the
   * attendee did not star hidden, plus the day and time headers that would
   * otherwise announce an empty stretch of someone else's conference.
   */
  function paintMine() {
    if (!MINE) return;
    const mine = mineSessions();
    for (const session of cardsById.values()) session.card.hidden = !isStarred(session.id);
    for (const slot of document.querySelectorAll('.public-agenda-slot')) {
      slot.hidden = !slot.querySelector('[data-public-session-id]:not([hidden])');
    }
    for (const day of document.querySelectorAll('.public-agenda-day')) {
      day.hidden = !day.querySelector('[data-public-session-id]:not([hidden])');
    }

    const list = document.querySelector('[data-schedule-list]');
    const empty = document.querySelector('[data-schedule-empty]');
    const summary = document.querySelector('[data-schedule-summary]');
    if (list) list.hidden = mine.length === 0;
    if (empty) empty.hidden = mine.length > 0;
    if (summary) summary.hidden = mine.length === 0;

    const counts = document.querySelector('[data-schedule-counts]');
    if (counts) {
      const perDay = config.days
        .map((day) => ({ day, count: mine.filter((session) => session.day === day.date).length }))
        .filter((entry) => entry.count > 0)
        .map((entry) => entry.day.label.split(',')[0] + ' ' + entry.count)
        .join(' · ');
      counts.textContent = '';
      const total = document.createElement('strong');
      total.textContent = mine.length + (mine.length === 1 ? ' session' : ' sessions');
      counts.append(total, perDay);
    }
    paintOverlapChips(mine);
  }

  /** Noted, never nagged: double-starring is a conscious act. */
  function paintOverlapChips(mine) {
    for (const chip of document.querySelectorAll('.overlap-chip')) chip.remove();
    if (!MINE) return;
    for (const session of mine) {
      const clashes = overlapsFor(session, mine);
      if (clashes.length === 0) continue;
      const body = session.card.querySelector('.public-abstract')?.parentElement ?? session.card;
      for (const other of clashes) {
        const chip = document.createElement('span');
        chip.className = 'overlap-chip';
        chip.textContent = 'overlaps ' + clip(other.title, 44) + ' · ' + hhmm(other.start);
        body.append(chip);
      }
    }
  }

  const clip = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);

  function paint() {
    paintStars();
    paintMine();
  }

  /* ── Interaction ───────────────────────────────────────────────────── */

  function toggleStar(id, button) {
    const adding = !isStarred(id);
    if (adding) starred.add(id); else starred.delete(id);
    state.sessionIds = [...starred];
    writeState();
    paint();
    if (adding && button) {
      button.classList.add('just-starred');
      setTimeout(() => button.classList.remove('just-starred'), 130);
    }
  }

  document.addEventListener('click', (event) => {
    const star = event.target.closest?.('[data-schedule-star]');
    if (star) {
      event.preventDefault();
      toggleStar(star.dataset.scheduleStar, star);
      return;
    }
    // Remember which view a session was opened from, so its page can offer the
    // way back the attendee actually came by.
    const link = event.target.closest?.('a[href*="/s/"]');
    if (link) {
      try { sessionStorage.setItem(ORIGIN_KEY, MINE ? 'mine' : 'agenda'); } catch { /* nothing to remember with */ }
    }
  });

  /**
   * A session opened from the itinerary returns to the itinerary. Nobody who
   * came from their own schedule wants to be dropped back into the full
   * program to find their place again.
   */
  function applyOrigin() {
    const back = document.querySelector('[data-schedule-back]');
    if (!back) return;
    let origin = null;
    try { origin = sessionStorage.getItem(ORIGIN_KEY); } catch { /* ignore */ }
    if (origin !== 'mine') return;
    back.textContent = '← My schedule';
    back.setAttribute('href', '/agenda?event=' + encodeURIComponent(config.eventSlug) + '&view=mine');
    for (const segment of document.querySelectorAll('[data-schedule-view]')) {
      segment.setAttribute('aria-selected', segment.dataset.scheduleView === 'mine' ? 'true' : 'false');
    }
  }

  applyOrigin();
  paint();
})();
`;
