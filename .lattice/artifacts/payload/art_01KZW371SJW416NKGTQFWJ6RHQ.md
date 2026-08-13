# Code Review: MRQ-156 — V2-7: public speakers, finished; and honest outbox copy

Reviewed at worktree `Marquee-worktrees/v2-7-public-speakers` @ `532d38a3`
(merge base `acc19c8a`, includes the MRQ-143 sequencing merge `7f367285`).

Verification performed:
- `npm test` — **pass**, 34.9s / 45s budget, hermetic.
- `npm run pr-gate` — **pass**, 62.5s / 120s budget, 0 uncovered ACs.
- Rendered `PublicSpeakerDirectoryPage` directly under vitest to inspect the emitted
  anchors (throwaway test, removed afterward).

---

### 1. Verdict

**FAIL (implementation-level)**

The plan is sound and three of the four ticket items land cleanly. One user-facing
control regressed (Clear no longer clears), and the bio disclosure renders its
"Show more" affordance above the text it expands. Both are on the attendee- and
judge-facing surfaces this ticket exists to polish.

### 2. Summary

Four scoped changes: a Gallery/List toggle on `/speakers` with a genuinely distinct
compact row layout and per-speaker session counts; a five-line bio clamp plus
`Sessions (N)` on the speaker profile; honest outbox chip copy; and suppression of
the contradictory future close date on a closed portal. The data layer, the search
interaction with `sessionCount`, and the no-JS progressive-enhancement story are all
handled with care, and the suite and gate are green.

The key finding is a regression introduced by the new `directoryHref` helper: the
**Clear** button on a filtered directory now links back to the *same filtered page*,
so it does nothing. The pre-existing contract test that guarded exactly this behavior
was rewritten to match the new (broken) href rather than the behavior it was written
to protect.

### 3. Issues

**[MAJOR] src/ui/public/agenda/PublicAgendaPage.tsx:1081 — the Clear button no longer clears the search**

`directoryHref()` (line 1040) unconditionally re-applies `data.filters.q`, so
`directoryHref(listView ? "list" : "gallery")` produces the URL the visitor is
already on. Confirmed by rendering the component with `filters: { q: "Public Co",
view: "list" }`:

```
<a class="public-button" href="/speakers?event=public-conf&amp;q=Public+Co&amp;view=list">Clear</a>
```

Before this change the href was `/speakers?event=<slug>` — it worked. The directory
has no client script, so this link is the only way back to the full list short of
manually emptying the input; a dead control on the public speaker directory is
precisely the kind of thing an attendee (or a judge) clicks first.

Compounding it: `tests/node/speaker-directory-search.test.mjs:29` was edited in
commit `532d38a3` ("test: follow directory clear-link helper") to assert the new
source text. Its own comment still reads *"A filtered directory needs a way back to
the whole list"* — the test now asserts the opposite of what it documents. The green
suite is not evidence here.

**Fix:** give the helper a way to drop the query, and keep the test asserting the
absence of `q`:

```tsx
const directoryHref = (view: "gallery" | "list", options: { keepSearch?: boolean } = {}): string => {
  const params = new URLSearchParams({ event: data.event.slug });
  if (options.keepSearch !== false && data.filters.q) params.set("q", data.filters.q);
  if (view === "list") params.set("view", "list");
  return `/speakers?${params.toString()}`;
};
```

then `href={directoryHref(listView ? "list" : "gallery", { keepSearch: false })}` for
Clear (the toggles keep the default). Restore the node test to assert the Clear href
carries no `q`, and add an integration assertion on the rendered Clear anchor so the
guard is behavioral rather than a source regex.

---

**[MAJOR] src/ui/public/agenda/PublicAgendaPage.tsx:1146 — "Show more" renders above the bio, not below it**

```tsx
<details class="public-bio" data-public-bio open><summary data-public-bio-toggle>Show more</summary><p data-public-bio-copy>{speaker.bio}</p></details>
```

`<summary>` must be the first child of `<details>`, and nothing in the CSS reorders
it (no `order`, no flex/grid on `.public-bio`). So the enhanced profile paints
`[Show more]` and *then* the five-line clamped bio underneath — the control sits above
the text it expands and reads as a stray label. The `margin-top: 8px` on
`.public-bio > summary` (line 147) is only meaningful for a control placed *below*
the copy, which suggests the intended layout is the conventional one and the DOM
order wasn't checked in a browser.

Related, same construct: the enhancement fights `<details>` rather than using it —
the element stays permanently `open` and the collapse is done entirely by
`data-collapsed` + `-webkit-line-clamp`, with `event.preventDefault()` (line 359)
suppressing the native toggle. Any path that flips `open` without a cancellable click
hides the bio completely.

**Fix:** drop `<details>` and use the flat markup the CSS already implies — it also
removes the `preventDefault` fight and the `aria-expanded`/implicit-details-state
conflict:

```tsx
<div class="public-bio" data-public-bio>
  <p data-public-bio-copy>{speaker.bio}</p>
  <button type="button" class="public-bio-toggle" data-public-bio-toggle hidden>Show more</button>
</div>
```

with the script unhiding the button (and setting `aria-expanded` / `aria-controls`)
only when `scrollHeight` exceeds five lines, exactly as it does today. No-JS readers
still get the whole bio, and the control lands under the text.

---

**[MINOR] src/ui/public/form/PublicForm.tsx:611 — a deadline-closed portal now shows no date at all**

The change replaces the `closed ? "Closed <date>" : "Closes <date>"` pair with a
single branch that hides the date whenever `state.state === "closed"`. That fixes the
manually-closed case the ticket named, but it also removes the *accurate* date from
a form that closed because its deadline passed — where `Closed Aug 1` was true and
useful to a speaker who arrived late. The ticket allowed "or nothing", so this is
within scope, but it discards real information rather than the contradiction.

**Fix (optional, if the honest date is wanted back):** keep the date when the deadline
is in the past, e.g.
`{state.form.closes_at && (state.state !== "closed" || Date.now() >= state.form.closes_at) && <span>{state.state === "closed" ? "Closed " : "Closes "}{…}</span>}`.
If "nothing" is the deliberate call, say so in the `closeLabel` comment block
(line 56) so the next reader doesn't re-add it.

Note the new test at `tests/integration/api/public-form.AC-25-42-155-157-231-234.test.ts:407`
asserts `not.toMatch(/>Closed\s+\d[^<]*<\/span>/)` — it would pass equally if the whole
`public-meta` row vanished. A positive assertion (that `Call for speakers · closed`
is present *and* no `Closes` string appears) pins it more tightly.

---

**[MINOR] src/ui/comms/CommsScreen.tsx:378 + src/ui/comms/comms.css:80 — the longer chip copy steals the subject line's width**

`.message-status` is `white-space: nowrap` with no `flex-shrink` control, and it is a
flex sibling of the subject block in a `.message-row summary`. The copy went from
21 characters to 45, so the chip's min-content width roughly doubles; the subject
block (`min-width: 0`, `text-overflow: ellipsis`) absorbs the whole loss. In the
two-column `.comms-grid` layout the subject will ellipsize noticeably earlier than
before. The copy itself is right — this is a layout consequence nobody sized for.

**Fix:** either give the suppressed chip a smaller type scale to match the meta row
(`.status-suppressed { font: 600 10px/1.2 var(--mono); }`), or let it wrap at narrow
widths (`white-space: normal; text-align: right; max-width: 22ch;`). Worth an eyes-on
pass in the running app either way — this one is only visible in a browser.

---

**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:138-145 — the "reuse the embed list layout" step became a parallel implementation**

The plan said the list view would reuse the embed's existing list treatment; the
result is a fresh `.public-speaker-directory-*` family alongside `.embed-speaker-row`.
That is defensible (different stylesheet, different density), but the two now drift
independently and the ticket's stated reuse didn't happen.

**Fix:** either note the deliberate divergence in a comment above line 138, or factor
the shared row rules so the embed and the public list share one source of truth.

---

**[TRIVIAL] src/ui/public/agenda/PublicAgendaPage.tsx:145 — dead declaration**

`.public-speaker-directory-row-count { flex: 0 0 auto; … }` — the parent
(`.public-speaker-directory-row`, line 139) is `display: grid`, so `flex` does
nothing here. Also line 144 sets `font-size: 10px` for the same selector, which line
145's `font` shorthand immediately resets.

**Fix:** drop `flex: 0 0 auto` and remove `.public-speaker-directory-row-count` from
the line-144 selector list (keep it only for its `color`, or move the color into 145).

---

**[TRIVIAL] tests/integration/public-site.AC-83-86-240-252-253.test.ts:468-472 — a few assertions test the script's source text**

`expect(profileBody).toContain("const maxLines = 5")` and
`toContain('data-public-bio="true" open')` assert implementation shape rather than
behavior; both break on a harmless refactor (and the second would need updating under
the fix suggested above). The surrounding assertions — `Show more`, `Sessions (2)`,
`data-public-bio` — already cover the contract.

**Fix:** drop the `const maxLines = 5` assertion; if the five-line number needs a
guard, assert on the CSS rule (`-webkit-line-clamp: 5`) instead.

### 4. Positive Observations

- **The search/`sessionCount` interaction is correct, and it is not obvious.**
  Because `sessionRowsQuery` is called with `speakerOnly: true`, a matching speaker's
  *entire* published session set survives the SQL filter, so the count shown in a
  searched list is the speaker's real total rather than a count of matching rows.
  Easy to get wrong; got right.
- **The no-JS story is genuinely thought through.** Rendering the bio open and letting
  the script add the clamp only after measuring `scrollHeight` — rather than shipping
  a collapsed bio that a scriptless reader can never open — is the right default, and
  the `Number.isFinite` guard correctly bails when `line-height` computes to `normal`.
  The comment at line 249 explains the *why*, not the *what*.
- **The toggle respects the no-jump rule properly.** Fixed 82px buttons, a
  `minmax(0, 1fr) auto` toolbar grid, `tabular-nums` on the session count, and
  responsive collapses at both 760px and 480px — the craft rule was applied, not just
  nodded at.
- **`aria-current="page"` on the active toggle link and the `aria-label`ed `<nav>`**
  are the correct semantics for a link-based view switch; using links rather than
  buttons also keeps the view shareable and back-button-friendly with zero JS.
- **The list view is genuinely distinct**, not a restyled card: no avatars (asserted),
  54px rows against 132px cards, different type treatment. That is what the rubric
  item asked for.
- **Suite and gate both green and comfortably inside budget**, with AC coverage intact.
