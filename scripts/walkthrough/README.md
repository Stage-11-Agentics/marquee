# Walkthrough recorder

This directory owns the regenerable walkthrough-video build artifact. The
recorder drives the same eleven public and demo-seat stations described in
[`sequence/submission/JUDGE-QUICKSTART.md`](../../sequence/submission/JUDGE-QUICKSTART.md)
on a fixed 88-second timeline: sign-in, settings, dashboard, form builder,
logged-out CFP, speaker portal, evaluation plan, reviewer queue, accepted
sessions, agenda conflicts, and the public agenda/embed. A missed selector is
recorded as a dwell until the next beat, so one UI drift cannot tear down the
take or desynchronise the narration.

## Regenerate and validate

The one-line regeneration recipe is:

```sh
npm run record:walkthrough -- --url http://localhost:5273 --output /tmp/marquee-walkthrough
```

Prerequisites are Node 22+, a seeded local Worker or approved loopback
staging target, Playwright's installed Chromium, `ffmpeg`/`ffprobe` on `PATH`,
and macOS `say` for the default narration. Run `npm ci` in a clean checkout;
on non-macOS runners, provide an equivalent audio file with `--audio`.

The command is headless by default, uses macOS `say` with
[`narration.txt`](narration.txt), muxes with `ffmpeg`, and validates the MP4
with `ffprobe`. The second command rechecks the pinned output independently:

```sh
node scripts/record-walkthrough.mjs --validate /tmp/marquee-walkthrough/marquee-walkthrough.mp4
```

The output directory contains `marquee-walkthrough.mp4` and
`marquee-walkthrough.manifest.json`. The manifest records the staging build
SHA, absolute artifact path, SHA-256, byte count, duration, viewport, scene
results, and whether any dwell occurred. Keep the video and audio outside the
repository; do not commit a binary larger than 10 MB. The manifest is the
receipt to attach wherever an external artifact is published.

## Safety and failure proof

- The URL is loopback-only. Production and any non-loopback host are rejected
  before Playwright launches. `http://localhost:5273` is the approved staging
  target; a hermetic local Worker is also valid.
- The recorder only creates demo authentication session cookies. It does not
  submit a proposal, edit a conference, change a record, reset the demo, or
  publish anything. The run's `app_data_mutations` manifest field must remain
  zero.
- Headed mode is opt-in (`--headed`) and every run has a hard ten-minute
  self-termination limit. The recorder never requests fullscreen.
- `ffprobe`/`ffmpeg` validation requires H.264 video at least 1280×720, AAC
  audio with a measurable mean volume, and a duration between 60 and 600
  seconds. A truncated file, missing audio stream, or silent audio fails.
- To exercise the deliberate bad-take path, make a silent MP4 with
  `ffmpeg -f lavfi -i color=s=1280x720:r=24 -f lavfi -i anullsrc -t 2 -shortest /tmp/marquee-silent.mp4`, then run
  `node scripts/record-walkthrough.mjs --validate /tmp/marquee-silent.mp4 --min-duration-seconds 1 --max-duration-seconds 5`; it must exit 1.

The narration source uses macOS `say` markup (`[[slnc milliseconds]]`) for
scene-sized pauses. On another platform, provide an equivalent pre-rendered
audio file with `--audio /path/to/narration.aiff`.
