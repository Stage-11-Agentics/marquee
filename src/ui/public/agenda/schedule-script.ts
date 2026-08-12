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
    paintNextChip(mine);
    paintGlance(mine);
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

    const at = new Map(mine.map((session) => [session.id, {
      start: zoneParts(session.start).minutes,
      end: zoneParts(session.end).minutes,
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
        block.className = 'glance-block' + (twin ? (earlier ? ' lane-a' : ' lane-b') : '') + (session.id === nextId ? ' is-next' : '');
        block.dataset.scheduleBlock = session.id;
        const bounds = at.get(session.id);
        block.style.top = pct(bounds.start) + '%';
        block.style.height = (Math.max(bounds.end - bounds.start, 30) / span * 100).toFixed(2) + '%';
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

  function closeSheets() {
    scrim?.classList.remove('open');
    for (const sheet of sheets.values()) sheet.classList.remove('open');
  }
  function openSheet(name) {
    const sheet = sheets.get(name);
    if (!sheet) return;
    closeSheets();
    scrim?.classList.add('open');
    sheet.classList.add('open');
    sheet.querySelector('button, [href], input')?.focus?.();
  }

  scrim?.addEventListener('click', closeSheets);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSheets(); });

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
        + (session.speakers ? ' (' + session.speakers + ')' : '');
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

  function liveUrls() {
    const origin = window.location.origin;
    const base = origin + '/api/v1/public/schedules/';
    return {
      program: origin + '/api/v1/public/agenda?event=' + encodeURIComponent(config.eventSlug),
      schedule: state.code ? base + state.code : null,
      webcal: state.code ? 'webcal://' + window.location.host + '/api/v1/public/schedules/' + state.code + '/calendar.ics' : null,
      ics: state.code ? base + state.code + '/calendar.ics' : null,
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

  function paint() {
    paintStars();
    paintMine();
  }

  /* ── One short code, every URL that matters ────────────────────────── */

  const SCHEDULES = '/api/v1/public/schedules';
  let pending = null;

  /**
   * The set is promoted to the server only when the attendee asks for
   * something that needs a server — a phone, a friend, a calendar. Starring
   * itself never waits on the network.
   */
  function ensureCode() {
    if (state.code) return Promise.resolve(state);
    if (pending) return pending;
    pending = fetch(SCHEDULES, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventSlug: config.eventSlug, sessionIds: [...starred] }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('sync failed'))))
      .then((payload) => {
        state.code = payload.code;
        state.writeKey = payload.writeKey;
        writeState();
        return state;
      })
      .finally(() => { pending = null; });
    return pending;
  }

  /** localStorage stays this device's source of truth; the code catches up. */
  let pushTimer = null;
  function pushUpdate() {
    if (!state.code || !state.writeKey) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      fetch(SCHEDULES + '/' + encodeURIComponent(state.code), {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-schedule-write-key': state.writeKey },
        body: JSON.stringify({ sessionIds: [...starred] }),
      }).catch(() => { /* the device already holds the truth; the feed catches up next time */ });
    }, 700);
  }

  function fillUrl(name, value) {
    const slot = document.querySelector('[data-schedule-url="' + name + '"]');
    if (slot) slot.textContent = value ?? '';
  }

  function failSheet(name) {
    const sheet = sheets.get(name);
    const hint = sheet?.querySelector('p');
    if (hint) hint.textContent = 'That did not reach the server. Your stars are safe on this device — try again in a moment.';
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
  if (fragmentKey) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
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
          return;
        }
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

  /* ── Interaction ───────────────────────────────────────────────────── */

  function toggleStar(id, button) {
    const adding = !isStarred(id);
    if (adding) starred.add(id); else starred.delete(id);
    state.sessionIds = [...starred];
    writeState();
    pushUpdate();
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

    const action = event.target.closest?.('[data-schedule-action]');
    if (action) {
      event.preventDefault();
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

  applyOrigin();
  paint();
  loadShared();
})();
`;
