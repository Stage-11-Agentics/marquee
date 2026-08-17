import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MIN_DURATION_SECONDS,
  MIN_VIDEO_HEIGHT,
  MIN_VIDEO_WIDTH,
  MediaValidationError,
  REPOSITORY_ROOT,
  SCENES,
  TIMELINE_END_SECONDS,
  assertExternalArtifactPath,
  assertLocalBaseUrl,
  createTimeline,
  pinArtifact,
  runInteraction,
  runScene,
  validateProbe,
} from "../../scripts/record-walkthrough.mjs";

function validProbe(overrides = {}) {
  return {
    streams: [
      { codec_type: "video", codec_name: "h264", width: MIN_VIDEO_WIDTH, height: MIN_VIDEO_HEIGHT, duration: "88.0" },
      { codec_type: "audio", codec_name: "aac", channels: 2, duration: "88.0" },
    ],
    format: { duration: "88.0" },
    ...overrides,
  };
}

test("CONTRACT · MRQ-253 · the recorder accepts staging loopback and rejects production", () => {
  assert.equal(assertLocalBaseUrl("http://localhost:5273").origin, "http://localhost:5273");
  assert.equal(assertLocalBaseUrl("http://127.0.0.1:9000/base").pathname, "/base");
  assert.throws(() => assertLocalBaseUrl("https://localhost:5273"), /staging\/local-only/);
  assert.throws(() => assertLocalBaseUrl("http://marquee.stage11.dev"), /non-loopback host/);
  assert.throws(() => assertLocalBaseUrl("http://user:pass@localhost:5273"), /credentials/);
});

test("CONTRACT · MRQ-253 · generated media is required to stay outside the repository", () => {
  assert.equal(assertExternalArtifactPath("/tmp/marquee-walkthrough").endsWith("/tmp/marquee-walkthrough"), true);
  assert.throws(() => assertExternalArtifactPath(join(REPOSITORY_ROOT, "artifacts/walkthrough")), /outside the repository/);
});

test("CONTRACT · MRQ-253 · the fixed camera path has eleven timed scenes", () => {
  assert.equal(SCENES.length, 11);
  assert.equal(TIMELINE_END_SECONDS, 88);
  assert.deepEqual(SCENES.map((scene) => scene.start), [0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80]);
  assert.deepEqual(SCENES.map((scene) => scene.id), [
    "organizer-door",
    "event-settings",
    "program-dashboard",
    "form-builder",
    "public-cfp",
    "speaker-portal",
    "evaluation-plan",
    "reviewer-queue",
    "accepted-agenda",
    "agenda-conflicts",
    "public-program",
  ]);
  assert.ok(SCENES.every((scene) => scene.end - scene.start === 8));
  assert.equal(new Set(SCENES.map((scene) => scene.id)).size, SCENES.length);
});

test("CONTRACT · MRQ-253 · demo-seat entry uses session-only auth before the next beat", async () => {
  const calls = [];
  const timeline = { until: async () => {} };
  const page = { goto: async () => {} };
  const context = {
    request: {
      post: async (url, options) => {
        calls.push({ url, options });
        return { ok: () => true };
      },
    },
    clearCookies: async () => {},
  };
  const result = await runScene({
    page,
    context,
    scene: SCENES[0],
    baseUrl: new URL("http://localhost:5273"),
    timeline,
    log: { warn() {} },
  });

  assert.equal(result.status, "captured");
  assert.deepEqual(calls, [{
    url: "http://localhost:5273/api/v1/auth/demo",
    options: { data: { role: "organizer" }, timeout: 5_000 },
  }]);
});

test("CONTRACT · MRQ-253 · a missed selector becomes a timed dwell instead of aborting the take", async () => {
  const timelineCalls = [];
  const timeline = { until: async (target) => timelineCalls.push(target) };
  const result = await runInteraction({
    label: "fault-injected selector",
    action: async () => {
      throw new Error("selector was intentionally removed");
    },
    timeline,
    dwellUntil: 8,
    log: { warn() {} },
  });

  assert.equal(result.status, "dwell");
  assert.match(result.reason, /intentionally removed/);
  assert.deepEqual(timelineCalls, [8]);
});

test("CONTRACT · MRQ-253 · a selector failure in a real scene leaves the scene result and next beat available", async () => {
  const timelineCalls = [];
  const timeline = { until: async (target) => timelineCalls.push(target) };
  const page = {
    goto: async () => {},
    locator: () => ({ click: async () => { throw new Error("missing organizer door"); } }),
  };
  const result = await runScene({
    page,
    context: { clearCookies: async () => {} },
    baseUrl: new URL("http://localhost:5273"),
    timeline,
    scene: {
      id: "fault-injected-scene",
      title: "Fault injected",
      start: 0,
      end: 8,
      path: "/signin",
      actions: [{ type: "click", label: "missing organizer door", selector: "#gone" }],
    },
    log: { warn() {} },
  });

  assert.equal(result.status, "dwell");
  assert.equal(result.interactions.at(-1).status, "dwell");
  assert.ok(timelineCalls.includes(8));
});

test("CONTRACT · MRQ-253 · ffprobe metadata accepts the pinned media contract", () => {
  const report = validateProbe(validProbe(), { meanVolumeDb: -18 });
  assert.equal(report.video.codec, "h264");
  assert.equal(report.audio.codec, "aac");
  assert.equal(report.duration_seconds, 88);
  assert.deepEqual(report.errors, []);
});

test("CONTRACT · MRQ-253 · ffprobe validation rejects truncated, low-resolution, and silent takes", () => {
  assert.throws(
    () => validateProbe(validProbe({ format: { duration: "2" } }), { meanVolumeDb: -18 }),
    (error) => error instanceof MediaValidationError && error.report.errors.some((message) => message.includes("duration")),
  );
  assert.throws(
    () => validateProbe(validProbe({ streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360, duration: "88" }, validProbe().streams[1]] }), { meanVolumeDb: -18 }),
    (error) => error instanceof MediaValidationError && error.report.errors.some((message) => message.includes("resolution")),
  );
  assert.throws(
    () => validateProbe(validProbe(), { meanVolumeDb: Number.NEGATIVE_INFINITY }),
    (error) => error instanceof MediaValidationError && error.report.errors.some((message) => message.includes("silent")),
  );
  assert.throws(
    () => validateProbe({ streams: [validProbe().streams[0]], format: { duration: "88" } }, { meanVolumeDb: -18 }),
    (error) => error instanceof MediaValidationError && error.report.errors.includes("missing audio stream"),
  );
  assert.equal(MIN_DURATION_SECONDS, 60);
});

test("CONTRACT · MRQ-253 · the external manifest pins bytes and SHA-256 beside the artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mrq-253-pin-"));
  try {
    const filePath = join(directory, "walkthrough.mp4");
    await writeFile(filePath, "validated-media");
    const pin = await pinArtifact(filePath, { duration_seconds: 88 }, { build_sha: "staging-sha" });
    assert.equal(pin.bytes, 15);
    assert.equal(pin.sha256, "5fe895a353a1195ccc74dd43a89a0d5511e754d1b3d4f473af396cd6a4277a47");
    assert.equal(pin.duration_seconds, 88);
    assert.equal(pin.source.build_sha, "staging-sha");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CONTRACT · MRQ-253 · the timeline waits only for the remaining beat budget", async () => {
  let current = 0;
  const waits = [];
  const timeline = createTimeline({ now: () => current, sleep: async (milliseconds) => { waits.push(milliseconds); current += milliseconds; } });
  await timeline.until(2);
  await timeline.until(1);
  assert.deepEqual(waits, [2_000]);
  assert.equal(timeline.elapsedSeconds(), 2);
});
