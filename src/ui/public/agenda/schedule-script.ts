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

  const emptyState = () => ({ v: 1, sessionIds: [], code: null, writeKey: null, feedToken: null });

  function readState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sessionIds)) return emptyState();
      return {
        v: 1,
        sessionIds: raw.sessionIds.filter((id) => typeof id === 'string'),
        code: typeof raw.code === 'string' ? raw.code : null,
        writeKey: typeof raw.writeKey === 'string' ? raw.writeKey : null,
        // The read-only handle that puts the owner's own talks in their feed.
        feedToken: typeof raw.feedToken === 'string' ? raw.feedToken : null,
      };
    } catch { return emptyState(); }
  }

  function writeState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode: the session still works */ }
  }

  let state = readState();
  const starred = new Set(state.sessionIds);
  const isStarred = (id) => starred.has(id);

  /**
   * The device handle behind the demand signal. It is random, it is per
   * browser rather than per event, and it is the only thing a star ever sends
   * — no person, nothing derived from one. Private mode leaves it null, in
   * which case stars still work and simply are not counted; a schedule that
   * refuses to save because a counter is unavailable would be the worse trade.
   */
  const DEVICE_KEY = 'marquee:device';
  function readDevice() {
    try {
      let value = localStorage.getItem(DEVICE_KEY);
      if (!value || !/^[0-9a-f]{16,64}$/.test(value)) {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        value = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(DEVICE_KEY, value);
      }
      return value;
    } catch { return null; }
  }
  const DEVICE = readDevice();

  /**
   * What the server knows about this code: the address it is linked to, and —
   * only when that address turned out to belong to a speaker here — the
   * sessions they are speaking at. Both are read with the write key, so a
   * share link never sees either. The pins are held apart from the starred
   * set on purpose: they are derived, they are never pushed, and unstarring
   * cannot reach them.
   */
  let claim = null;
  let speaking = new Set();
  const inMine = (id) => starred.has(id) || speaking.has(id);

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
    .filter((session) => inMine(session.id))
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

  /** "Tuesday", not "Tue" — the summary line reads as a sentence about a day. */
  const weekday = (date) => {
    try {
      return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
    } catch { return date; }
  };

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
    for (const session of cardsById.values()) session.card.hidden = !inMine(session.id);
    for (const slot of document.querySelectorAll('.public-agenda-slot')) {
      slot.hidden = !slot.querySelector('[data-public-session-id]:not([hidden])');
    }
    // The itinerary groups by day only. A time-slot header above a single
    // starred session repeats what the row already says, and the prototype
    // ruled the shape: day header, then the sessions.
    for (const head of document.querySelectorAll('.public-slot-head')) head.hidden = true;
    for (const day of document.querySelectorAll('.public-agenda-day')) {
      const starredHere = day.querySelectorAll('[data-public-session-id]:not([hidden])').length;
      day.hidden = starredHere === 0;
      // "4 sessions" is the day's programme; this view is about the attendee's
      // own picks, so the count has to say which number it is showing.
      const count = day.querySelector('.public-day-head small');
      if (count) count.textContent = starredHere + ' starred';
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
        .map((entry) => weekday(entry.day.date) + ' ' + entry.count)
        .join(' · ');
      counts.textContent = '';
      const total = document.createElement('strong');
      total.textContent = mine.length + (mine.length === 1 ? ' session' : ' sessions');
      counts.append(total, perDay);
    }
    paintOverlapChips(mine);
    paintSpeakingChips();
    paintNextChip(mine);
    paintGlance(mine);
    paintIdentity(mine);
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

  /**
   * "What does my Wednesday look like": the list answers what is next, the
   * blocks answer the shape of a day. A real 09:00–18:00 axis (widened when a
   * pick falls outside it), overlapping picks in half-width lanes side by side,
   * and a red NOW rule across today — the calendar convention, so nobody has
   * to learn it.
   */
  const AXIS_DEFAULT_START = 9 * 60;
  const AXIS_DEFAULT_END = 18 * 60;

  function paintGlance(mine) {
    const glance = document.querySelector('[data-schedule-glance]');
    if (!glance) return;
    glance.hidden = mine.length === 0;
    if (mine.length === 0) { glance.textContent = ''; return; }

    // End is measured FORWARD from the start, never as minutes-since-local-
    // midnight: a 23:30–00:30 session would otherwise end before it began,
    // draw a stub in the wrong place, and drag the axis down to 00:00 for
    // every other day.
    const at = new Map(mine.map((session) => [session.id, {
      start: zoneParts(session.start).minutes,
      end: zoneParts(session.start).minutes + Math.max(0, Math.round((session.end - session.start) / 60_000)),
    }]));
    let axisStart = AXIS_DEFAULT_START;
    let axisEnd = AXIS_DEFAULT_END;
    for (const span of at.values()) {
      axisStart = Math.min(axisStart, Math.floor(span.start / 60) * 60);
      axisEnd = Math.max(axisEnd, Math.ceil(span.end / 60) * 60);
    }
    const span = Math.max(axisEnd - axisStart, 60);
    const pct = (minutes) => ((minutes - axisStart) / span * 100).toFixed(2);
    const now = zoneParts(Date.now());
    const nextId = mine.find((session) => session.end > Date.now())?.id ?? null;

    glance.textContent = '';
    const head = (label, sub) => {
      const cell = document.createElement('div');
      cell.className = 'glance-head';
      cell.textContent = label;
      const small = document.createElement('small');
      small.className = 'num';
      small.textContent = sub;
      cell.append(small);
      return cell;
    };
    glance.append(head('', ''));
    for (const day of config.days) {
      const count = mine.filter((session) => session.day === day.date).length;
      glance.append(head(day.label.toUpperCase(), (count || '—') + ' starred'));
    }

    const axis = document.createElement('div');
    axis.className = 'glance-axis';
    for (let minutes = axisStart; minutes <= axisEnd; minutes += 180) {
      const tick = document.createElement('span');
      tick.style.top = pct(minutes) + '%';
      tick.textContent = String(Math.floor(minutes / 60)).padStart(2, '0');
      axis.append(tick);
    }
    glance.append(axis);

    for (const day of config.days) {
      const lane = document.createElement('div');
      lane.className = 'glance-lane';
      const inDay = mine.filter((session) => session.day === day.date);
      if (inDay.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'glance-empty';
        empty.textContent = '—';
        lane.append(empty);
      }
      for (const session of inDay) {
        const twin = inDay.find((other) => other.id !== session.id && overlaps(session, other));
        const earlier = twin && (session.start < twin.start || (session.start === twin.start && session.id < twin.id));
        const block = document.createElement('button');
        block.type = 'button';
        block.className = 'glance-block' + (twin ? (earlier ? ' lane-a' : ' lane-b') : '')
          + (session.id === nextId ? ' is-next' : '') + (speaking.has(session.id) ? ' speaking' : '');
        block.dataset.scheduleBlock = session.id;
        const bounds = at.get(session.id);
        block.style.top = pct(bounds.start) + '%';
        const drawnEnd = Math.min(bounds.end, axisEnd);
        block.style.height = (Math.max(drawnEnd - bounds.start, 30) / span * 100).toFixed(2) + '%';
        const time = document.createElement('small');
        time.className = 'num';
        time.textContent = hhmm(session.start);
        const title = document.createElement('strong');
        title.textContent = session.title;
        block.append(time, title);
        lane.append(block);
      }
      if (day.date === now.date && now.minutes >= axisStart && now.minutes <= axisEnd) {
        const rule = document.createElement('div');
        rule.className = 'glance-now';
        rule.style.top = pct(now.minutes) + '%';
        const label = document.createElement('span');
        label.textContent = 'NOW ' + now.time;
        rule.append(label);
        lane.append(rule);
      }
      glance.append(lane);
    }
  }

  /**
   * "You're speaking" on the sessions the claimed address turned out to own.
   * Rendered from the derived set every paint, so it appears with the identity
   * and vanishes with it — there is no stored state to go stale.
   */
  function paintSpeakingChips() {
    for (const chip of document.querySelectorAll('.speaking-chip')) chip.remove();
    if (!MINE) return;
    for (const id of speaking) {
      const session = cardsById.get(id);
      const title = session?.card.querySelector('.public-session-title');
      if (!title) continue;
      const chip = document.createElement('span');
      chip.className = 'speaking-chip';
      chip.textContent = "You're speaking";
      title.append(chip);
    }
  }

  /** The next thing they are going to, marked in the list as well as the blocks. */
  function paintNextChip(mine) {
    for (const chip of document.querySelectorAll('.next-chip')) chip.remove();
    const next = mine.find((session) => session.end > Date.now());
    if (!next) return;
    const title = next.card.querySelector('.public-session-title');
    if (!title) return;
    const chip = document.createElement('span');
    chip.className = 'next-chip';
    chip.textContent = 'Next';
    title.append(chip);
  }

  /* ── The hover card on a glance block ──────────────────────────────── */

  const tip = document.createElement('div');
  tip.className = 'glance-tip';
  document.body.append(tip);

  function showTip(block) {
    const session = cardsById.get(block.dataset.scheduleBlock);
    if (!session) return;
    const day = config.days.find((entry) => entry.date === session.day);
    tip.textContent = '';
    const time = document.createElement('div');
    time.className = 't-time';
    time.textContent = ((day ? day.label.toUpperCase() : '') + ' · ' + hhmm(session.start) + ' – ' + hhmm(session.end)).trim();
    const title = document.createElement('div');
    title.className = 't-title';
    title.textContent = session.title;
    const meta = document.createElement('div');
    meta.className = 't-meta';
    meta.textContent = session.room;
    if (session.speakers) {
      meta.append(document.createElement('br'));
      meta.append(session.speakers);
    }
    tip.append(time, title, meta);
    for (const other of overlapsFor(session, mineSessions())) {
      const chip = document.createElement('span');
      chip.className = 't-overlap';
      chip.textContent = 'overlaps ' + clip(other.title, 30);
      tip.append(chip);
    }
    const box = block.getBoundingClientRect();
    tip.classList.add('show');
    const left = Math.min(Math.max(8, box.left), window.innerWidth - tip.offsetWidth - 8);
    const below = box.bottom + 6;
    const top = below + tip.offsetHeight > window.innerHeight - 8 ? box.top - tip.offsetHeight - 6 : below;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }

  const hideTip = () => tip.classList.remove('show');
  document.addEventListener('mouseover', (event) => {
    const block = event.target.closest?.('[data-schedule-block]');
    if (block) showTip(block); else hideTip();
  });
  document.addEventListener('focusin', (event) => {
    const block = event.target.closest?.('[data-schedule-block]');
    if (block) showTip(block); else hideTip();
  });
  document.addEventListener('scroll', hideTip, { passive: true });

  /* ── Sheets ────────────────────────────────────────────────────────── */

  const scrim = document.querySelector('[data-schedule-scrim]');
  const sheets = new Map([...document.querySelectorAll('[data-schedule-sheet]')].map((sheet) => [sheet.dataset.scheduleSheet, sheet]));

  let sheetOpener = null;

  function closeSheets() {
    const wasOpen = [...sheets.values()].some((sheet) => sheet.classList.contains('open'));
    scrim?.classList.remove('open');
    for (const sheet of sheets.values()) sheet.classList.remove('open');
    // Focus goes back where it came from, not to the top of the document.
    // Only a real close restores and clears the opener: openSheet() calls this
    // first to make sheets exclusive, and that pass must not forget who asked.
    if (!wasOpen) return;
    if (sheetOpener?.isConnected) sheetOpener.focus();
    sheetOpener = null;
  }

  const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  /** aria-modal has to be true in behaviour as well as in markup. */
  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    const sheet = [...sheets.values()].find((each) => each.classList.contains('open'));
    if (!sheet) return;
    const stops = [...sheet.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null || node === document.activeElement);
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    else if (!sheet.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
  }
  function openSheet(name) {
    const sheet = sheets.get(name);
    if (!sheet) return;
    closeSheets();
    clearErrors();
    scrim?.classList.add('open');
    sheet.classList.add('open');
    sheet.querySelector('button, [href], input')?.focus?.();
  }

  scrim?.addEventListener('click', closeSheets);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeSheets(); return; }
    if (event.key === 'Enter' && event.target?.dataset?.scheduleClaimEmail) {
      event.preventDefault();
      document.querySelector('[data-schedule-claim-send]')?.click();
      return;
    }
    trapFocus(event);
  });

  /**
   * The human-side complement of the agent API: one paste-ready block whose
   * picks are inline, so it works with zero fetches, and whose overlaps are
   * phrased as the intentional either/ors they are.
   */
  function buildBriefing() {
    const mine = mineSessions();
    const lines = mine.map((session) => {
      const day = config.days.find((entry) => entry.date === session.day);
      return '- ' + (day ? day.label : session.day) + ' · ' + hhmm(session.start) + '–' + hhmm(session.end)
        + ' · "' + session.title + '"' + (session.room ? ' — ' + session.room : '')
        + (session.speakers ? ' (' + session.speakers + ')' : '')
        + (speaking.has(session.id) ? " — I'M SPEAKING at this one" : '');
    });
    const pairs = [];
    mine.forEach((left, index) => {
      for (const right of mine.slice(index + 1)) {
        if (!overlaps(left, right)) continue;
        pairs.push('- "' + left.title + '" and "' + right.title + '" overlap ('
          + hhmm(left.start) + '–' + hhmm(left.end) + ' vs ' + hhmm(right.start) + '–' + hhmm(right.end)
          + ') — an intentional either/or; help me decide closer to the day.');
      }
    });
    const links = liveUrls();
    return [
      'This is my conference schedule for ' + config.eventName + ', managed on Marquee.',
      '',
      'My starred sessions (' + mine.length + '):',
      lines.join('\\n'),
      pairs.length ? '\\nNoted overlaps:\\n' + pairs.join('\\n') : '',
      '',
      'Live data, no auth required:',
      links.schedule ? '- My schedule (JSON, includes overlap pairs): ' + links.schedule : '- Full program (JSON): ' + links.program,
      links.webcal ? '- Calendar feed (live): ' + links.webcal : '',
      links.schedule ? '- Full program (JSON): ' + links.program : '',
      '',
      'Things you can do for me: check the JSON before advising (I restar things), warn me when back-to-back picks are in different buildings, suggest non-conflicting alternatives from the full program, and build my day-of walking plan.',
    ].filter((line) => line !== '').join('\\n');
  }

  /** Present only for the owner of a verified claim; a share link never has it. */
  const feedSuffix = () => (state.feedToken ? '?f=' + encodeURIComponent(state.feedToken) : '');

  function liveUrls() {
    const origin = window.location.origin;
    const base = origin + '/api/v1/public/schedules/';
    return {
      program: origin + '/api/v1/public/agenda?event=' + encodeURIComponent(config.eventSlug),
      schedule: state.code ? base + state.code : null,
      webcal: state.code ? 'webcal://' + window.location.host + '/api/v1/public/schedules/' + state.code + '/calendar.ics' + feedSuffix() : null,
      ics: state.code ? base + state.code + '/calendar.ics' + feedSuffix() : null,
      share: state.code ? origin + '/agenda?event=' + encodeURIComponent(config.eventSlug) + '&sched=' + state.code : null,
      sync: state.code && state.writeKey
        ? origin + '/agenda?event=' + encodeURIComponent(config.eventSlug) + '&sched=' + state.code + '#k=' + state.writeKey
        : null,
    };
  }

  function copyText(button, text) {
    const done = () => {
      const original = button.textContent;
      button.classList.add('done');
      button.textContent = 'Copied';
      setTimeout(() => { button.classList.remove('done'); button.textContent = original; }, 1400);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, done);
    else done();
  }

  /* ── QR, drawn here because the key must not travel ────────────────
     The sync link carries the private write key in its fragment, so the
     image of it cannot be produced by a server that must never see it.
     Byte mode, ECC level L, versions 1–10 — comfortably more than a
     schedule URL needs. */

  const QR_EC = { 1:[7,[[1,19]]], 2:[10,[[1,34]]], 3:[15,[[1,55]]], 4:[20,[[1,80]]], 5:[26,[[1,108]]],
    6:[18,[[2,68]]], 7:[20,[[2,78]]], 8:[24,[[2,97]]], 9:[30,[[2,116]]], 10:[18,[[2,68],[2,69]]] };
  const QR_ALIGN = { 1:[], 2:[6,18], 3:[6,22], 4:[6,26], 5:[6,30], 6:[6,34], 7:[6,22,38], 8:[6,24,42], 9:[6,26,46], 10:[6,28,50] };

  const gfExp = new Uint8Array(512);
  const gfLog = new Uint8Array(256);
  (() => {
    let value = 1;
    for (let index = 0; index < 255; index += 1) {
      gfExp[index] = value;
      gfLog[value] = index;
      value <<= 1;
      if (value & 0x100) value ^= 0x11d;
    }
    for (let index = 255; index < 512; index += 1) gfExp[index] = gfExp[index - 255];
  })();
  const gfMul = (left, right) => (left === 0 || right === 0 ? 0 : gfExp[gfLog[left] + gfLog[right]]);

  /** The divisor polynomial, highest-degree coefficient first, leading 1 implicit. */
  function rsDivisor(degree) {
    const divisor = new Array(degree).fill(0);
    divisor[degree - 1] = 1;
    let root = 1;
    for (let index = 0; index < degree; index += 1) {
      for (let position = 0; position < degree; position += 1) {
        divisor[position] = gfMul(divisor[position], root);
        if (position + 1 < degree) divisor[position] ^= divisor[position + 1];
      }
      root = gfMul(root, 2);
    }
    return divisor;
  }

  function rsRemainder(data, degree) {
    const divisor = rsDivisor(degree);
    const remainder = new Array(degree).fill(0);
    for (const byte of data) {
      const factor = byte ^ remainder.shift();
      remainder.push(0);
      for (let index = 0; index < degree; index += 1) remainder[index] ^= gfMul(divisor[index], factor);
    }
    return remainder;
  }

  function qrMatrix(text) {
    const bytes = [...new TextEncoder().encode(text)];
    let version = 0;
    for (let candidate = 1; candidate <= 10; candidate += 1) {
      const [ecPerBlock, groups] = QR_EC[candidate];
      const dataCodewords = groups.reduce((sum, [count, size]) => sum + count * size, 0);
      const countBits = candidate < 10 ? 8 : 16;
      if (dataCodewords * 8 >= 4 + countBits + bytes.length * 8) { version = candidate; break; }
    }
    if (!version) return null;

    const [ecPerBlock, groups] = QR_EC[version];
    const countBits = version < 10 ? 8 : 16;
    const dataCodewords = groups.reduce((sum, [count, size]) => sum + count * size, 0);

    const bits = [];
    const push = (value, length) => { for (let index = length - 1; index >= 0; index -= 1) bits.push((value >> index) & 1); };
    push(0b0100, 4);
    push(bytes.length, countBits);
    for (const byte of bytes) push(byte, 8);
    for (let index = 0; index < 4 && bits.length < dataCodewords * 8; index += 1) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    const codewords = [];
    for (let index = 0; index < bits.length; index += 8) {
      codewords.push(bits.slice(index, index + 8).reduce((value, bit) => (value << 1) | bit, 0));
    }
    for (let pad = 0; codewords.length < dataCodewords; pad += 1) codewords.push(pad % 2 === 0 ? 0xec : 0x11);

    const blocks = [];
    let cursor = 0;
    for (const [count, size] of groups) {
      for (let index = 0; index < count; index += 1) {
        const data = codewords.slice(cursor, cursor + size);
        cursor += size;
        blocks.push({ data, ec: rsRemainder(data, ecPerBlock) });
      }
    }
    const interleaved = [];
    const longest = Math.max(...blocks.map((block) => block.data.length));
    for (let index = 0; index < longest; index += 1) {
      for (const block of blocks) if (index < block.data.length) interleaved.push(block.data[index]);
    }
    for (let index = 0; index < ecPerBlock; index += 1) {
      for (const block of blocks) interleaved.push(block.ec[index]);
    }

    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(null));
    const place = (row, column, value) => { modules[row][column] = value; };
    const finder = (row, column) => {
      for (let deltaRow = -1; deltaRow <= 7; deltaRow += 1) {
        for (let deltaColumn = -1; deltaColumn <= 7; deltaColumn += 1) {
          const y = row + deltaRow;
          const x = column + deltaColumn;
          if (y < 0 || y >= size || x < 0 || x >= size) continue;
          const edge = deltaRow === 0 || deltaRow === 6 || deltaColumn === 0 || deltaColumn === 6;
          const core = deltaRow >= 2 && deltaRow <= 4 && deltaColumn >= 2 && deltaColumn <= 4;
          const inside = deltaRow >= 0 && deltaRow <= 6 && deltaColumn >= 0 && deltaColumn <= 6;
          place(y, x, inside && (edge || core) ? 1 : 0);
        }
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let index = 8; index < size - 8; index += 1) {
      const value = index % 2 === 0 ? 1 : 0;
      place(6, index, value);
      place(index, 6, value);
    }
    // Every centre except the three that sit under a finder. The two that
    // land on a timing line are drawn over it, which is why this excludes by
    // position rather than by "is this cell already taken".
    const centres = QR_ALIGN[version];
    for (let rowIndex = 0; rowIndex < centres.length; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < centres.length; columnIndex += 1) {
        const corner = (rowIndex === 0 && columnIndex === 0)
          || (rowIndex === 0 && columnIndex === centres.length - 1)
          || (rowIndex === centres.length - 1 && columnIndex === 0);
        if (corner) continue;
        for (let deltaRow = -2; deltaRow <= 2; deltaRow += 1) {
          for (let deltaColumn = -2; deltaColumn <= 2; deltaColumn += 1) {
            const ring = Math.max(Math.abs(deltaRow), Math.abs(deltaColumn));
            place(centres[rowIndex] + deltaRow, centres[columnIndex] + deltaColumn, ring === 1 ? 0 : 1);
          }
        }
      }
    }
    place(size - 8, 8, 1);
    const reserved = [];
    for (let index = 0; index < 9; index += 1) {
      if (modules[8][index] === null) { modules[8][index] = 0; reserved.push([8, index]); }
      if (modules[index][8] === null) { modules[index][8] = 0; reserved.push([index, 8]); }
    }
    for (let index = 0; index < 8; index += 1) {
      if (modules[8][size - 1 - index] === null) { modules[8][size - 1 - index] = 0; reserved.push([8, size - 1 - index]); }
      if (modules[size - 1 - index][8] === null) { modules[size - 1 - index][8] = 0; reserved.push([size - 1 - index, 8]); }
    }
    if (version >= 7) {
      let remainder = version;
      for (let index = 0; index < 12; index += 1) remainder = (remainder << 1) ^ ((remainder >> 11) * 0x1f25);
      const versionBits = (version << 12) | remainder;
      for (let index = 0; index < 18; index += 1) {
        const bit = (versionBits >> index) & 1;
        modules[Math.floor(index / 3)][size - 11 + (index % 3)] = bit;
        modules[size - 11 + (index % 3)][Math.floor(index / 3)] = bit;
      }
    }

    const dataBits = [];
    for (const codeword of interleaved) for (let index = 7; index >= 0; index -= 1) dataBits.push((codeword >> index) & 1);
    let bitIndex = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let step = 0; step < size; step += 1) {
        const row = upward ? size - 1 - step : step;
        for (const column of [right, right - 1]) {
          if (modules[row][column] !== null) continue;
          modules[row][column] = bitIndex < dataBits.length ? dataBits[bitIndex] : 0;
          modules[row][column] |= 2; // mark as data for masking
          bitIndex += 1;
        }
      }
      upward = !upward;
    }

    const maskAt = (mask, row, column) => {
      if (mask === 0) return (row + column) % 2 === 0;
      if (mask === 1) return row % 2 === 0;
      if (mask === 2) return column % 3 === 0;
      if (mask === 3) return (row + column) % 3 === 0;
      if (mask === 4) return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
      if (mask === 5) return ((row * column) % 2) + ((row * column) % 3) === 0;
      if (mask === 6) return ((((row * column) % 2) + ((row * column) % 3)) % 2) === 0;
      return ((((row + column) % 2) + ((row * column) % 3)) % 2) === 0;
    };

    function render(mask) {
      const grid = modules.map((row) => row.slice());
      for (let row = 0; row < size; row += 1) {
        for (let column = 0; column < size; column += 1) {
          const cell = grid[row][column];
          grid[row][column] = (cell & 2) ? ((cell & 1) ^ (maskAt(mask, row, column) ? 1 : 0)) : (cell & 1);
        }
      }
      let format = (0b01 << 3) | mask;
      let remainder = format;
      for (let index = 0; index < 10; index += 1) remainder = (remainder << 1) ^ ((remainder >> 9) * 0x537);
      const formatBits = (((format << 10) | remainder) ^ 0x5412);
      const bit = (index) => (formatBits >> index) & 1;
      // First copy: down the column beside the top-left finder, then left
      // along the row beneath it. Second copy: along the top-right row and up
      // the bottom-left column.
      for (let index = 0; index <= 5; index += 1) grid[index][8] = bit(index);
      grid[7][8] = bit(6);
      grid[8][8] = bit(7);
      grid[8][7] = bit(8);
      for (let index = 9; index <= 14; index += 1) grid[8][14 - index] = bit(index);
      for (let index = 0; index <= 7; index += 1) grid[8][size - 1 - index] = bit(index);
      for (let index = 8; index <= 14; index += 1) grid[size - 15 + index][8] = bit(index);
      grid[size - 8][8] = 1;
      return grid;
    }

    function penalty(grid) {
      let score = 0;
      const runScore = (line) => {
        let run = 1;
        for (let index = 1; index < line.length; index += 1) {
          if (line[index] === line[index - 1]) { run += 1; continue; }
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
        if (run >= 5) score += 3 + (run - 5);
        // A finder-lookalike anywhere in the data is what makes a scanner
        // hunt for a corner that is not there.
        const text = '0000' + line.join('') + '0000';
        for (const pattern of ['00001011101', '10111010000']) {
          let at = text.indexOf(pattern);
          while (at !== -1) { score += 40; at = text.indexOf(pattern, at + 1); }
        }
      };
      for (let index = 0; index < size; index += 1) {
        runScore(grid[index]);
        runScore(grid.map((row) => row[index]));
      }
      for (let row = 0; row < size - 1; row += 1) {
        for (let column = 0; column < size - 1; column += 1) {
          const cell = grid[row][column];
          if (cell === grid[row][column + 1] && cell === grid[row + 1][column] && cell === grid[row + 1][column + 1]) score += 3;
        }
      }
      let dark = 0;
      for (const row of grid) for (const cell of row) dark += cell;
      score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
      return score;
    }

    let best = null;
    for (let mask = 0; mask < 8; mask += 1) {
      const grid = render(mask);
      const score = penalty(grid);
      if (!best || score < best.score) best = { grid, score };
    }
    return best.grid;
  }

  function drawQr(canvas, text) {
    const grid = qrMatrix(text);
    const context = canvas.getContext?.('2d');
    // No half-drawn code: a QR that scans to the wrong URL is worse than the
    // copyable link beneath it, which is always there.
    canvas.hidden = !grid || !context;
    if (!grid || !context) return;
    const quiet = 2;
    const modules = grid.length + quiet * 2;
    const scale = Math.max(1, Math.floor(canvas.width / modules));
    const offset = Math.floor((canvas.width - modules * scale) / 2);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#101820';
    for (let row = 0; row < grid.length; row += 1) {
      for (let column = 0; column < grid.length; column += 1) {
        if (!grid[row][column]) continue;
        context.fillRect(offset + (column + quiet) * scale, offset + (row + quiet) * scale, scale, scale);
      }
    }
  }

  /* ── Identity: the page says what it knows about you ───────────────── */

  /**
   * Three sentences, one slot, one height. The anonymous one is the truth the
   * server rendered; the other two replace its text once the browser — and,
   * for a claimed code, the server — have answered. Nothing is inserted or
   * removed, so the line never pushes the itinerary down as it resolves.
   */
  function paintIdentity(mine) {
    const line = document.querySelector('[data-schedule-identity]');
    if (!line) return;
    line.hidden = mine.length === 0;
    const copy = line.querySelector('[data-schedule-identity-copy]');
    const action = line.querySelector('[data-schedule-identity-action]');
    if (!copy || !action) return;
    const strong = (text) => { const node = document.createElement('b'); node.textContent = text; return node; };
    copy.textContent = '';
    if (claim && claim.status === 'verified') {
      line.classList.add('linked');
      copy.append('Linked to ', strong(claim.maskedEmail), ' — recoverable by email, on any device.');
      if (speaking.size > 0) {
        copy.append(" You're speaking at ");
        copy.append(strong(String(speaking.size)));
        copy.append(' session' + (speaking.size === 1 ? '' : 's') + ' — pinned below.');
      }
      action.textContent = 'Manage';
      return;
    }
    if (claim && claim.status === 'pending') {
      line.classList.remove('linked');
      // Deliberately no longer than the anonymous sentence it replaces: this
      // line sits above the whole itinerary, and a state change that adds a
      // wrapped line on a phone pushes the attendee's day down the screen.
      // What opening the link actually does is said in full in the sheet.
      copy.append('Check your email — link sent to ', strong(claim.maskedEmail), '.');
      action.textContent = 'Manage';
      return;
    }
    line.classList.remove('linked');
    copy.append('Saved on ', strong('this device only'), ' — no account, not linked to an email.');
    action.textContent = 'Get it by email';
  }

  function paint() {
    paintStars();
    paintMine();
  }

  /* ── One short code, every URL that matters ────────────────────────── */

  const SCHEDULES = '/api/v1/public/schedules';
  let pending = null;

  /**
   * A session an attendee starred can be pulled from the programme days later,
   * and their star outlives it in localStorage. The server refuses the whole
   * set when one id has stopped being published, so a stale star would
   * otherwise break every export path forever, with a message telling them to
   * try again. Drop exactly what the server names, and carry on.
   */
  function dropUnknown(response) {
    return response.json().then((payload) => {
      const gone = payload?.error?.details?.unknownSessionIds;
      if (!Array.isArray(gone) || gone.length === 0) return false;
      let changed = false;
      for (const id of gone) if (starred.delete(id)) changed = true;
      if (!changed) return false;
      state.sessionIds = [...starred];
      writeState();
      paint();
      return true;
    }, () => false);
  }

  /**
   * The set is promoted to the server only when the attendee asks for
   * something that needs a server — a phone, a friend, a calendar. Starring
   * itself never waits on the network.
   */
  function ensureCode(retry = true) {
    if (state.code) return Promise.resolve(state);
    if (pending) return pending;
    const posted = [...starred];
    pending = fetch(SCHEDULES, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventSlug: config.eventSlug, sessionIds: posted, deviceHash: DEVICE || undefined }),
    })
      .then((response) => {
        if (response.ok) return response.json();
        if (response.status === 422 && retry) {
          return dropUnknown(response).then((pruned) => {
            if (!pruned || starred.size === 0) throw new Error('sync failed');
            pending = null;
            return ensureCode(false);
          });
        }
        throw new Error('sync failed');
      })
      .then((payload) => {
        if (payload && payload.code && !state.code) {
          state.code = payload.code;
          state.writeKey = payload.writeKey;
          writeState();
        }
        // Anything starred while the request was in flight has not reached the
        // code yet: the POST body was a snapshot.
        if (posted.length !== starred.size || posted.some((id) => !starred.has(id))) pushUpdate(0);
        return state;
      })
      .finally(() => { pending = null; });
    return pending;
  }

  /**
   * localStorage stays this device's source of truth; the code catches up.
   * "Catches up" has to mean something, though — the feed is the flagship of
   * this feature and it is the surface that goes stale. A failed push is
   * remembered and re-sent when the tab comes back or the network does.
   */
  let pushTimer = null;
  let unpushed = false;
  function pushUpdate(delay = 700) {
    if (!state.code || !state.writeKey) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      fetch(SCHEDULES + '/' + encodeURIComponent(state.code), {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-schedule-write-key': state.writeKey },
        // The device travels with the set so the aggregate counts this browser
        // once — as a device — rather than twice, once more as a code.
        body: JSON.stringify({ sessionIds: [...starred], deviceHash: DEVICE || undefined }),
      }).then((response) => {
        if (response.ok) { unpushed = false; return; }
        if (response.status === 422) {
          dropUnknown(response).then((pruned) => { if (pruned) pushUpdate(0); else { unpushed = true; } });
          return;
        }
        unpushed = true;
      }, () => { unpushed = true; });
    }, delay);
  }

  const retryPush = () => { if (unpushed && document.visibilityState !== 'hidden') pushUpdate(0); };
  window.addEventListener('online', retryPush);
  document.addEventListener('visibilitychange', retryPush);

  function fillUrl(name, value) {
    const slot = document.querySelector('[data-schedule-url="' + name + '"]');
    if (slot) slot.textContent = value ?? '';
  }

  function showError(name, message) {
    const sheet = sheets.get(name);
    const slot = sheet?.querySelector('[data-schedule-error]');
    if (slot) { slot.textContent = message; slot.hidden = false; }
  }

  function clearErrors() {
    for (const slot of document.querySelectorAll('[data-schedule-error]')) { slot.textContent = ''; slot.hidden = true; }
  }

  /** The sheet's own explanation survives a bad moment; the error sits above it. */
  function failSheet(name) {
    showError(name, 'That did not reach the server. Your stars are safe on this device — try again when you have a signal.');
    openSheet(name);
  }

  function runAction(name) {
    if (name === 'brief') {
      const target = document.querySelector('[data-schedule-brief]');
      // A briefing works with zero fetches, so it opens immediately; the live
      // URLs are added once the set has a code.
      if (target) target.textContent = buildBriefing();
      openSheet('brief');
      ensureCode().then(() => { if (target) target.textContent = buildBriefing(); }, () => {});
      return;
    }
    if (name === 'import') { importShared(); return; }
    ensureCode().then(() => {
      const urls = liveUrls();
      if (name === 'ics') {
        const link = document.createElement('a');
        link.href = urls.ics;
        link.rel = 'noopener';
        link.download = '';
        link.click();
        return;
      }
      if (name === 'phone') {
        fillUrl('sync', urls.sync);
        const canvas = document.querySelector('[data-schedule-qr]');
        if (canvas && urls.sync) drawQr(canvas, urls.sync);
        openSheet('phone');
        return;
      }
      if (name === 'share') {
        fillUrl('webcal', urls.webcal);
        fillUrl('share', urls.share);
        const code = document.querySelector('[data-schedule-code]');
        if (code) code.textContent = state.code;
        openSheet('share');
      }
    }, () => failSheet(name === 'ics' ? 'share' : name));
  }

  /* ── Arriving on someone else's link ───────────────────────────────── */

  const query = new URLSearchParams(window.location.search);
  const sharedCode = query.get('sched');
  /**
   * The write key rides the fragment, which browsers never send to a server.
   * It is read once and removed from the address bar so it does not end up in
   * a screenshot, a shared URL, or a history entry.
   */
  const fragmentKey = /^#k=(.+)$/.exec(window.location.hash)?.[1] ?? null;
  /**
   * The claim token from the mail. Like the write key it is read once and
   * removed from the address bar — a verification link left sitting in a
   * history entry is a link somebody else can follow.
   */
  const claimToken = query.get('claim');
  if (fragmentKey || claimToken) {
    const remaining = new URLSearchParams(window.location.search);
    remaining.delete('claim');
    const search = remaining.toString();
    history.replaceState(null, '', window.location.pathname + (search ? '?' + search : ''));
  }

  let sharedSessions = null;

  function importShared() {
    if (!sharedSessions) return;
    for (const id of sharedSessions) starred.add(id);
    state.sessionIds = [...starred];
    writeState();
    pushUpdate();
    const banner = document.querySelector('[data-schedule-import]');
    if (banner) banner.hidden = true;
    paint();
  }

  function loadShared() {
    if (!sharedCode) return;
    // Arriving on your own claim link is not somebody sharing their picks with
    // you, and the strip that says so is the slot the arrival's own message
    // needs. The verify path owns this banner when a token is present.
    const ownArrival = Boolean(claimToken);
    fetch(SCHEDULES + '/' + encodeURIComponent(sharedCode), { headers: { accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('unknown code'))))
      .then((payload) => {
        sharedSessions = (payload.sessions ?? []).map((session) => session.id);
        if (fragmentKey) {
          // This device now edits the same code. The union is deliberate:
          // adopting a shared schedule must never silently delete a star this
          // device already had.
          state.code = sharedCode;
          state.writeKey = fragmentKey;
          for (const id of sharedSessions) starred.add(id);
          state.sessionIds = [...starred];
          writeState();
          pushUpdate();
          paint();
          // Binding two devices together is the more consequential of the two
          // arrivals, so it is the one that must not happen in silence.
          const banner = document.querySelector('[data-schedule-import]');
          const message = document.querySelector('[data-schedule-import-message]');
          const button = document.querySelector('[data-schedule-action="import"]');
          if (button) button.hidden = true;
          if (message) message.textContent = 'This device now shares schedule ' + sharedCode + ' — both devices can edit it, and your own stars were kept.';
          if (banner) banner.hidden = false;
          return;
        }
        if (ownArrival) return;
        const banner = document.querySelector('[data-schedule-import]');
        const message = document.querySelector('[data-schedule-import-message]');
        if (message) {
          message.textContent = sharedSessions.length === 1
            ? 'Someone shared a schedule with you — 1 session.'
            : 'Someone shared a schedule with you — ' + sharedSessions.length + ' sessions.';
        }
        if (banner) banner.hidden = sharedSessions.length === 0;
      })
      .catch(() => { /* a dead code is not worth a banner */ });
  }

  /* ── The claim: request, verify, unlink ────────────────────────────── */

  const CLAIM_BASE = () => SCHEDULES + '/' + encodeURIComponent(state.code);

  /**
   * Read what the server knows about this code. The write key is what makes
   * the answer ours: without it the same endpoint returns the schedule and
   * nothing about who owns it, which is exactly what a shared link should see.
   */
  /**
   * Set when a claim arrival adopted a code this device did not have. The
   * owner read is the authoritative list and always follows the verify, so the
   * union happens here rather than racing the shared-link fetch.
   */
  let adoptOnOwnerRead = false;

  function loadOwnerState() {
    if (!state.code || !state.writeKey) return Promise.resolve();
    return fetch(CLAIM_BASE(), { headers: { accept: 'application/json', 'x-schedule-write-key': state.writeKey } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload) return;
        claim = payload.claim ?? null;
        speaking = new Set(Array.isArray(payload.speakingSessionIds) ? payload.speakingSessionIds : []);
        if (payload.feedToken && payload.feedToken !== state.feedToken) {
          state.feedToken = payload.feedToken;
          writeState();
        }
        if (adoptOnOwnerRead) {
          // Union, never replace: recovering a schedule must not delete a star
          // this device already had. Only ever on the arrival that adopted it —
          // doing this on every read would resurrect a star just removed.
          adoptOnOwnerRead = false;
          const before = starred.size;
          for (const session of payload.sessions ?? []) starred.add(session.id);
          state.sessionIds = [...starred];
          writeState();
          if (starred.size !== before) pushUpdate(0);
        }
        paint();
        renderClaimRow();
      })
      .catch(() => {});
  }

  /**
   * Turnstile, loaded only when the sheet that needs it opens. The agenda is
   * the page people leave open all morning; it should not pay for a third-party
   * script because one row inside one sheet might accept an email. Exempt
   * conferences (demo mode) send no site key and mount nothing.
   */
  let turnstileToken = '';
  let turnstileMounted = false;
  function mountTurnstile() {
    const siteKey = config.turnstileSiteKey;
    const holder = document.querySelector('[data-schedule-turnstile]');
    if (!siteKey || !holder || turnstileMounted) return;
    turnstileMounted = true;
    const render = () => {
      if (!window.turnstile || typeof window.turnstile.render !== 'function') return;
      try {
        window.turnstile.render(holder, {
          sitekey: siteKey,
          callback: (token) => { turnstileToken = token; },
          'expired-callback': () => { turnstileToken = ''; },
          'error-callback': () => { turnstileToken = ''; },
        });
      } catch { /* the send still tries; the server is the gate */ }
    };
    if (window.turnstile) { render(); return; }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.addEventListener('load', render);
    document.head.append(script);
  }

  function claimRowElements() {
    return {
      row: document.querySelector('[data-schedule-claim-row]'),
      controls: document.querySelector('[data-schedule-claim-controls]'),
    };
  }

  function claimLine(text, quiet) {
    const line = document.createElement('div');
    line.className = 'claim-done' + (quiet ? ' quiet-state' : '');
    line.style.flex = '1 1 auto';
    const copy = document.createElement('span');
    copy.textContent = text;
    line.append(copy);
    return { line, copy };
  }

  function quietButton(label, hook) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet';
    button.textContent = label;
    button.dataset[hook] = 'true';
    return button;
  }

  /**
   * Every state of this row is the same height, because they replace each
   * other in place: the input, "check your email", "linked to …", and the
   * unlink confirmation. Nothing here jumps while somebody reads it.
   */
  function renderClaimRow(justUnlinked) {
    const { controls } = claimRowElements();
    if (!controls) return;
    // The row replaces itself wholesale on every state change, so a reader who
    // is not looking at it needs to be told what it now says.
    controls.setAttribute('role', 'status');
    controls.setAttribute('aria-live', 'polite');
    controls.textContent = '';

    if (justUnlinked) {
      // Two true sentences, because there are two situations. Removing a
      // verified claim gets the ruled wording exactly; cancelling a request
      // nobody has opened yet must not claim to have removed something from
      // records it never reached.
      const copy = justUnlinked === 'pending'
        ? 'Cancelled — that link no longer works, and your email was never shared.'
        : 'Unlinked — your email and picks are removed from the organizers' + String.fromCharCode(39) + ' records.';
      const { line } = claimLine(copy, true);
      controls.append(line);
      setTimeout(() => { if (!claim) renderClaimRow(); }, 3200);
      return;
    }

    if (claim && claim.status === 'verified') {
      const { line } = claimLine('', false);
      const copy = line.firstChild;
      copy.textContent = 'Linked to ' + claim.maskedEmail + ' — the organizers can see your picks.'
        + (speaking.size > 0 ? " You're speaking at " + speaking.size + ' session' + (speaking.size === 1 ? '' : 's') + ' — pinned in My schedule.' : '');
      const actions = document.createElement('span');
      actions.className = 'claim-actions';
      actions.append(quietButton('Resend', 'scheduleClaimResend'), quietButton('Unlink', 'scheduleClaimUnlink'));
      line.append(actions);
      controls.append(line);
      return;
    }

    if (claim && claim.status === 'pending') {
      const { line } = claimLine('Check your email — link sent to ' + claim.maskedEmail + '. Opening it is what links your picks.', false);
      const actions = document.createElement('span');
      actions.className = 'claim-actions';
      // A request has to be cancellable. The mail says the attendee can undo
      // this at any time, and "any time" has to include the window before they
      // open it — otherwise a typo'd address sits in a row they cannot reach.
      actions.append(quietButton('Resend', 'scheduleClaimResend'), quietButton('Cancel', 'scheduleClaimUnlink'));
      line.append(actions);
      controls.append(line);
      return;
    }

    if (config.claimEnabled === false) {
      // Not a disabled button and not a lie: the conference has not switched
      // mail on, and the way to move a schedule across devices is named.
      const { line } = claimLine('Email links are not switched on for this conference yet — use Open on your phone to carry your schedule across.', true);
      controls.append(line);
      return;
    }

    const input = document.createElement('input');
    input.className = 'claim-input';
    input.type = 'email';
    input.placeholder = 'you@example.com';
    input.setAttribute('aria-label', 'Your email address');
    input.dataset.scheduleClaimEmail = 'true';
    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'copy-btn';
    send.style.flexBasis = '96px';
    send.style.width = '96px';
    send.textContent = 'Send link';
    send.dataset.scheduleClaimSend = 'true';
    controls.append(input, send);
    if (config.turnstileSiteKey) {
      // The row is told it carries a challenge so it reserves that height in
      // EVERY state — the widget arriving late is not the only way this moves;
      // pressing Send swaps a 101px input row for a 36px sentence, and the
      // sheet's Done button would slide up under the finger.
      controls.classList.add('has-challenge');
      const holder = document.createElement('div');
      holder.dataset.scheduleTurnstile = 'true';
      holder.className = 'claim-turnstile';
      controls.append(holder);
      mountTurnstile();
    }
  }

  function claimError(message) {
    showError('share', message);
  }

  /**
   * An omitted email is a resend: the server keeps the address, the page keeps
   * only its masked form, and the write key is what says this is the same
   * person asking.
   */
  function sendClaim(email) {
    return ensureCode()
      .then(() => fetch(CLAIM_BASE() + '/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-schedule-write-key': state.writeKey },
        body: JSON.stringify({ email: email || undefined, turnstileToken: turnstileToken || undefined }),
      }))
      .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
      .then((result) => {
        if (!result.ok) {
          claimError(result.payload?.error?.message ?? 'That did not reach the server. Try again in a moment.');
          return;
        }
        claim = result.payload.claim ?? null;
        clearErrors();
        renderClaimRow();
        paint();
      })
      .catch(() => claimError('That did not reach the server. Your stars are safe on this device — try again when you have a signal.'));
  }

  function unlinkClaim() {
    if (!state.code || !state.writeKey) return;
    const wasPending = claim?.status === 'pending';
    fetch(CLAIM_BASE() + '/claim', {
      method: 'DELETE',
      headers: { 'x-schedule-write-key': state.writeKey },
    }).then((response) => {
      if (!response.ok) { claimError('That did not reach the server. Try again in a moment.'); return; }
      claim = null;
      speaking = new Set();
      state.feedToken = null;
      writeState();
      renderClaimRow(wasPending ? 'pending' : 'verified');
      paint();
    }, () => claimError('That did not reach the server. Try again in a moment.'));
  }

  /**
   * The verification. The mail's link carries the code and a one-use token, and
   * never the write key; the token is read once and taken out of the address
   * bar so a screenshot or a forwarded URL cannot carry it.
   *
   * The code is passed in rather than read from state, because the whole point
   * of a recovery mail is that it may arrive on a device that already has a
   * schedule of its own. Verifying against whatever this browser happened to be
   * holding would post the mail's token to a stranger's code and answer 404 —
   * on the one journey this feature exists for.
   */
  function verifyClaimToken(code, token) {
    if (!code || !token) return Promise.resolve();
    return fetch(SCHEDULES + '/' + encodeURIComponent(code) + '/claim/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
      .then((result) => {
        if (!result.ok) {
          // A link that has been superseded by a resend is the ordinary way
          // this fails, and the server has a sentence for it. Swallowing that
          // left the page anonymous with no explanation and no way forward —
          // and the token is already out of the address bar, so a refresh
          // cannot retry. Say what happened, and open the door back.
          claimArrivalError(result.payload?.error?.message
            ?? 'That link could not be checked just now. Ask for a new one from Subscribe / share.');
          return;
        }
        claim = result.payload.claim ?? null;
        speaking = new Set(Array.isArray(result.payload.speakingSessionIds) ? result.payload.speakingSessionIds : []);
        // Adopting the verified code, the way arriving with a write key in the
        // fragment used to: this device now edits THAT schedule. The union is
        // deliberate and matches the fragment path — recovering a schedule must
        // never silently delete a star this device already had.
        const switching = state.code !== code;
        state.code = code;
        // The mail deliberately does not carry the write key; verifying is how
        // this device earns it. Storing it is what makes "open it on any device
        // and keep editing" true.
        if (result.payload.writeKey) state.writeKey = result.payload.writeKey;
        else if (switching) state.writeKey = null;
        if (result.payload.feedToken) state.feedToken = result.payload.feedToken;
        if (switching) adoptOnOwnerRead = true;
        writeState();
        if (switching) {
          // The more consequential of the two arrivals, so it is the one that
          // must not happen in silence — the same rule the shared-link path
          // already follows.
          announceArrival('This device now edits schedule ' + code + ' — your own stars were kept.');
        }
        paint();
        renderClaimRow();
      })
      .catch(() => claimArrivalError('That link could not be checked just now — you may be offline. Your picks are safe on this device.'));
  }

  /**
   * An arrival that failed has nowhere to put an error yet: the share sheet is
   * closed and the claim row is not on screen. The import strip is the one slot
   * this page already reserves for "something happened when you arrived", so
   * the message lands there rather than in a sheet nobody opened.
   */
  function claimArrivalError(message) {
    // Deliberately NOT also showError('share', …): openSheet clears errors
    // unconditionally, so the copy telling somebody to open Subscribe / share
    // was wiped by the act of following it.
    announceArrival(message);
  }

  /** The strip this page already reserves for "something happened when you arrived". */
  function announceArrival(message) {
    const banner = document.querySelector('[data-schedule-import]');
    const copy = document.querySelector('[data-schedule-import-message]');
    const button = document.querySelector('[data-schedule-action="import"]');
    if (button) button.hidden = true;
    if (copy) copy.textContent = message;
    if (banner) banner.hidden = false;
  }

  /* ── Interaction ───────────────────────────────────────────────────── */

  /**
   * The demand beacon: anonymous, best-effort, and deliberately unawaited. A
   * star is a local act that must never wait on a network, and a signal that
   * failed to send is not a reason to tell somebody their star did not land.
   */
  function sendBeacon(id, starred) {
    if (!DEVICE) return;
    fetch('/api/v1/public/stars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventSlug: config.eventSlug, sessionId: id, deviceHash: DEVICE, starred }),
    }).catch(() => {});
  }

  function toggleStar(id, button) {
    const adding = !isStarred(id);
    if (adding) starred.add(id); else starred.delete(id);
    state.sessionIds = [...starred];
    writeState();
    pushUpdate();
    sendBeacon(id, adding);
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

    const block = event.target.closest?.('[data-schedule-block]');
    if (block) {
      const session = cardsById.get(block.dataset.scheduleBlock);
      if (session?.slug) {
        try { sessionStorage.setItem(ORIGIN_KEY, 'mine'); } catch { /* ignore */ }
        window.location.href = '/s/' + encodeURIComponent(session.slug) + '?event=' + encodeURIComponent(config.eventSlug);
      }
      return;
    }

    const close = event.target.closest?.('[data-schedule-close]');
    if (close) { closeSheets(); return; }

    const copy = event.target.closest?.('[data-schedule-copy]');
    if (copy) {
      const which = copy.dataset.scheduleCopy;
      const source = which === 'brief'
        ? document.querySelector('[data-schedule-brief]')?.textContent ?? ''
        : document.querySelector('[data-schedule-url="' + which + '"]')?.textContent ?? '';
      copyText(copy, source);
      return;
    }

    const send = event.target.closest?.('[data-schedule-claim-send]');
    if (send) {
      const field = document.querySelector('[data-schedule-claim-email]');
      const value = (field?.value ?? '').trim();
      if (!value || value.indexOf('@') < 1) { field?.focus(); return; }
      send.disabled = true;
      sendClaim(value).finally(() => { if (send.isConnected) send.disabled = false; });
      return;
    }

    const resend = event.target.closest?.('[data-schedule-claim-resend]');
    if (resend) {
      resend.disabled = true;
      resend.textContent = 'Sending';
      sendClaim(null).finally(() => {
        if (!resend.isConnected) return;
        resend.disabled = false;
        resend.textContent = 'Sent';
        setTimeout(() => { if (resend.isConnected) resend.textContent = 'Resend'; }, 1400);
      });
      return;
    }

    if (event.target.closest?.('[data-schedule-claim-unlink]')) {
      unlinkClaim();
      return;
    }

    const action = event.target.closest?.('[data-schedule-action]');
    if (action) {
      event.preventDefault();
      sheetOpener = action;
      runAction(action.dataset.scheduleAction, action);
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

  /**
   * The itinerary is the page an attendee leaves open on a phone all morning.
   * A NOW rule pinned to the moment the page loaded is worse than none, so the
   * clock keeps moving — only while the tab is actually being looked at.
   */
  if (MINE) {
    setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      const mine = mineSessions();
      paintNextChip(mine);
      paintGlance(mine);
    }, 60_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') return;
      const mine = mineSessions();
      paintNextChip(mine);
      paintGlance(mine);
    });
  }

  applyOrigin();
  paint();
  loadShared();
  renderClaimRow();
  /**
   * Arriving from the mail. The code has to be adopted before the verify call,
   * because a device that has never seen this schedule has nothing in
   * localStorage to address — that is the whole point of the recovery link. The
   * write key comes back from the verify itself.
   */
  if (claimToken) {
    verifyClaimToken(sharedCode || state.code, claimToken).then(loadOwnerState);
  } else {
    loadOwnerState();
  }
})();
`;
