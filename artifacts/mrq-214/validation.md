# MRQ-214 — validation against the running artifact

**Driven by:** `agent:mrq-214-opus` · **Date:** 2026-08-14 (ET)
**Artifact:** the built Worker (`npx vite build` → `dist/marquee`), served by
`wrangler dev --local` on `127.0.0.1:8871` with `INSECURE_LOCAL_COOKIES:1` and
`LOCAL_UPLOAD_SHIM:1`, against a freshly migrated and seeded local D1.
**Browser:** the c11 embedded browser (WKWebView), `surface:395`.
`GET /health` → `{"service":"marquee","status":"ok","build":"e6939f53edbb"}`.

Every step below was performed in the browser against the real page unless it says
otherwise. This is the shipped bundle, not `vite dev`.

## 1. Magic-link entry lands on the sponsor portal — PASS

Typed `dana.okafor@example.com` into the **real sign-in form** and submitted it.
The demo instance returned the link on screen; exchanging it answered:

```
HTTP/1.1 302 Found
Location: /sponsor-portal
Set-Cookie: mq_session=…; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax
```

`Location: /sponsor-portal` is the whole point — a sponsorship contact holds no
membership, and before this ticket the same link landed them on the speaker
portal's honest "you have no speaker record", which is a dead end. No `Secure` on
the cookie, so the WKWebView session survives on `http://` (the trap this project
has paid for before).

**Local-dev note, not a defect:** the *on-screen* demo link is minted with the
production origin, because `wrangler dev` rewrites the inbound URL, Host and Origin
to the `custom_domain` route (README says so). Clicking it in the browser navigates
to `marquee.stage11.dev`, which correctly rejects a token it never minted. The
localhost form of the same exchange URL works, and that is what was driven.

## 2. The Gold view — PASS

Full page text: `gold-portal-as-dana.txt`. Present and correct:

- head: `3 of 7 deliverables done` · `4 still need you` — the cancelled deliverable
  is out of the figure, which is the ruling.
- hero: `GOLD SPONSOR · COMMITTED`, the company, the conference line, and the
  **derived** deal line `2 Sessions · Booth 214 · 6 conference passes`.
- organizer contact: `AIE Program Committee · Program lead ·
  program.committee@example.com` — read from the event's own staff membership, not
  a constant.
- booth card: booth `214 · 3 m × 3 m corner`, hall, building with its address, the
  load-in window, the dock instruction, the leave-by line, the venue map with its
  OpenStreetMap attribution, and `Directions ↗`.
- deliverables: eight rows, each naming its assignee (`yours` /
  `assigned to Grzegorz Włodarczyk-Ó Braonáin`), the overdue one carrying
  `OVERDUE · ACTION NEEDED` and a `1 OVERDUE` panel chip.
- cancelled block below its divider, reason stated **once**:
  *"The escalator-wall placement left the Gold package when the venue reassigned
  that space. Nothing else about your sponsorship changes."*
- Sessions: one scheduled and published; one reading
  `Lightning · Speaker not named yet` with `Not scheduled yet — the agenda team
  places Sessions once the program locks.`
- company profile with the contact roster, `PRIMARY` and `YOU` chips, and the
  "your organizer manages access" line.
- handbook: three chapters, including `Booth & load-in guide`.

## 3. Anyone-completes, with attribution — PASS

Signed in as **Dana**, completed **`Booth staff list & conference passes`, which is
assigned to Priya Raghunathan**. Afterwards that row reads:

```
✓ Booth staff list & conference passes
  COMPLETE · answer a form · due Oct 2, 2026
  completed by Dana Okafor
```

The assignee is unchanged in the record; the completer is the person who did it.
The meter moved `3 of 7` → `4 of 7`.

## 4. Name your speaker fills the Session — PASS

Clicked **Name your speaker** on the speakerless Session card. The URL became
`/sponsor-portal#deliverable-tsk_gold-name-your-speaker` and that deliverable's
row opened — one control, one act. Filled it with a deliberately awkward name,
`Íde Ní Chonaráin-Okwuosa`, and completed it. The Session card then read:

```
Building the Meridian data mesh: a live teardown
Lightning · Íde Ní Chonaráin-Okwuosa
Not scheduled yet — …
Scheduling follows once the program locks.
```

The action swapped to the honest sentence, and the database shows a real seat
rather than a string on a card:

```
name: Íde Ní Chonaráin-Okwuosa · speaker_memberships: 1 ·
speaker_participations: 1 · tasks: 2
```

Two tasks: `Hotel and Travel Reservations` and `Presentation Upload`. The
deliverable's own promise — *"They will hold their own speaker seat, with their
bio, headshot, and A/V tasks"* — is literally true.

## 5. The upload signer agrees with the completion route — PASS

The c11 browser cannot drive a file picker, so this was driven with `curl` against
the same running Worker:

- Dana presigning **Grzegorz's** overdue logo deliverable → **200**, signed.
- Mona (a contact of the *other* sponsorship) presigning the same → **403**.

Which is the point of sharing one predicate: a contact who could complete a file
deliverable but not presign its upload would meet a task that opens, validates,
and then fails at the PUT.

## 6. Company profile writes the org-level facts — PASS

Edited the blurb through the portal's own editor, then **reloaded the page**: the
new text is on the page, and `SELECT blurb FROM companies` shows it stored on the
`companies` row — org level, as the editor says it is.

## 7. The Silver view composes down — PASS

Full page text: `silver-portal-as-mona.txt`. Signed in as Mona through the same
door (via the already-signed-in guard's "Sign out and use this sign-in link",
which also got exercised):

- **no booth card at all**, and no booth chip: the deal line is
  `1 Session · 2 conference passes`.
- one contact, `PRIMARY` + `YOU`.
- `2 of 4 deliverables done`, `Nothing is overdue right now.`
- the Session is scheduled but carries `NOT YET PUBLIC`.
- handbook: **two** chapters — the load-in guide is absent, because a load-in guide
  shown to a sponsor with no booth makes them wonder what they missed.

Its absence is composition, not a special case (ruling 5), and nothing on the page
is a placeholder for the booth that does not exist.

## 8. Console and craft — PASS

`c11 browser console list` → **No console entries** across every step above.
No layout jump was observed on any action: the task action button is a fixed
124px, the owner/attribution line has a reserved `min-height` (so the swap from
`assigned to X` to `completed by Y` moves nothing), the deal-line row reserves its
height for a sponsorship with fewer chips, and the handbook's `+`/`−` glyph sits in
a fixed-width column.

## What could not be captured

`c11 browser screenshot` fails with `internal_error: Failed to capture snapshot` on
this c11 build — **including on `/health`**, so it is not this page. Evidence is
therefore the full rendered page text for both views (attached) plus the database
reads quoted above, which are checkable rather than merely visual.
