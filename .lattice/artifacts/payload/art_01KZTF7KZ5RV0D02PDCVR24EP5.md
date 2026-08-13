# MRQ-115 validation — driven against a running Worker

**Commit:** `494e219` · **Runtime:** `npx vite dev` (the real Worker, Cloudflare plugin) on `:5241`, local D1 migrated + seeded (9,976 rows), local R2 via the `LOCAL_UPLOAD_SHIM` presign path. Untracked `.dev.vars` supplied the shim flag and dev-only upload secrets; nothing was committed.

Not a mock, not a seed function: the two uploads below went through the same `POST /api/v1/me/uploads/sign` → `PUT` → `POST /api/v1/me/uploads/{id}/complete` → `POST /api/v1/me/tasks/{id}/complete` sequence the portal's own upload client calls.

## 1. The write path — a speaker uploads the same deliverable twice (CNT-S2 steps 4 and 6)

```
$ curl -X POST /api/v1/auth/demo -d '{"role":"speaker"}'
{"ok":true,"role":"speaker","person":{"id":"per_aarush-selvan","name":"Aarush Selvan"}}

upload 1: PUT 200 complete 200 task 200
upload 2: PUT 200 complete 200 task 200
```

## 2. The speaker's own view — CNT-02's rescue (`GET /api/v1/me/portal`)

```
status done | version_count 2 | latest_source pointer
latest: slides.pdf v2 https://media.marquee.stage11.dev/api/v1/media/uploads/evt_aie-ny-2026/task_upload/45eccaf9-…-a1e4206693a54816967b0587ebe7d4e4.pdf
  v2 slides.pdf latest 69 B
  v1 slides.pdf prior  69 B
```

Before this change the same payload carried `attachment_id` and nothing else — the speaker saw a ✓ and no evidence of what the conference was holding. The portal row now names `slides.pdf` in the **collapsed** row, so the evidence needs no interaction to reach.

## 3. The organizer's view — CNT-13 and the organizer half of CNT-04 (`GET /api/v1/events/{id}/files?state=uploaded`)

```
metrics {'expected': 153, 'received': 1, 'missing': 152, 'overdue': 0}
uploaded | slides.pdf | v 2 | Aarush Selvan | Going deep on Gemini Deep Research
   v2 CURRENT https://media.marquee.stage11.dev/api/v1/media/uploads/evt_aie-ny-2026/task_up…
   v1 prior   https://media.marquee.stage11.dev/api/v1/media/uploads/evt_aie-ny-2026/task_up…
```

Filename, session, speaker, upload date, size, **version count of 2**, latest flagged, and the prior version holding its own distinct URL — retrievable without touching the current one.

## 4. The human half — 153 expected deliverables, not 1 arrived file

```
metrics {'expected': 153, 'received': 0, 'missing': 153, 'overdue': 0}   (before the uploads)
facets  [('Presentation Upload', 153)]
rows    153
  missing — Aarush Selvan   Going deep on Gemini Deep Research   v0
  missing — Ahmad Awais     —                                    v0
```

The library was already a working screen before a single file existed, which is the point: an AV lead opens it to find out **who has not sent a deck**. A row with no session prints "—" honestly rather than inventing one — verified against the seed, where those tasks genuinely carry `submission_id NULL`.

## 5. Two rules that only a running system can prove

- **A pending upload is not a version.** A first attempt at driving the write path left two presigned-but-never-completed `attachments` rows against this exact task. Both surfaces still report `version_count: 2`. The abandoned rows are invisible, as they must be — a count of 4 would have failed CNT-13 while looking healthy.
- **Latest is the pointer, not the clock.** `latest_source: pointer` on both surfaces, from one derivation. The organizer and the speaker are not two systems agreeing by luck.

## 6. Authorization, live

```
GET /api/v1/events/evt_aie-ny-2026/files                       → 401 (no session)
GET /api/v1/events/evt_aie-ny-2026/files  (speaker session)    → 403
GET /api/v1/events/evt_aie-ny-2026/files  (organizer session)  → 200
```

## 7. Speed (R7)

153 rows with full version history inline, measured while the box carried a 1-minute load average of 58: **28 ms / 49 ms / 58 ms** across three calls. The existing `/onboarding` board answers in 60 ms on the same data. The library is not the slow screen.

## Gap, stated plainly

The **visual** pass in the c11 embedded browser was attempted and could not complete: the WKWebView surface timed out on every command (`browser.url.get`, `browser.snapshot`, `browser.get.text` — all at the 10 s socket timeout) while the machine sat at a 1-minute load average of 58–150 with ~20 delegators building. The surface was closed rather than left stray. What is proven above is the API and the write path against a real Worker plus component rendering under test (`tests/unit/file-versions.MRQ-115.test.ts` asserts the rendered strings: "v2 of 2", "Current · v2 of 2", "Previous version", three Download controls, the capability-link caveat). What is **not** proven is the assembled page under a real layout engine. Worth a browser pass when the box is quiet.
