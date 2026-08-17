#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parseArguments } from "./checks/lib/command.mjs";

const execFileAsync = promisify(execFile);
export const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
export const DEFAULT_BASE_URL = "http://localhost:5273";
export const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
export const SCENE_DURATION_SECONDS = 8;
export const MAX_RUNTIME_SECONDS = 600;
export const MIN_DURATION_SECONDS = 60;
export const MAX_DURATION_SECONDS = 600;
export const MIN_VIDEO_WIDTH = 1280;
export const MIN_VIDEO_HEIGHT = 720;
export const MIN_MEAN_VOLUME_DB = -60;

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const NAVIGATION_TIMEOUT_MS = 5_000;
const DEFAULT_NARRATION_PATH = resolve(REPOSITORY_ROOT, "scripts/walkthrough/narration.txt");

/**
 * The camera path is deliberately data, not a collection of unchecked awaits.
 * Each scene owns a fixed wall-clock interval, so a missing selector becomes a
 * visible dwell while the narration and the following beats retain alignment.
 */
export const SCENES = Object.freeze([
  {
    id: "organizer-door",
    title: "Land and choose an organizer seat",
    start: 0,
    end: SCENE_DURATION_SECONDS,
    path: "/signin",
    actions: [
      { type: "demoAuth", label: "enter organizer seat", role: "organizer" },
      { type: "goto", label: "open program home", path: "/dashboard" },
    ],
  },
  {
    id: "event-settings",
    title: "Configure event details",
    start: SCENE_DURATION_SECONDS,
    end: SCENE_DURATION_SECONDS * 2,
    path: "/settings",
  },
  {
    id: "program-dashboard",
    title: "See the program dashboard",
    start: SCENE_DURATION_SECONDS * 2,
    end: SCENE_DURATION_SECONDS * 3,
    path: "/dashboard",
  },
  {
    id: "form-builder",
    title: "Build a CFP form",
    start: SCENE_DURATION_SECONDS * 3,
    end: SCENE_DURATION_SECONDS * 4,
    path: "/forms",
  },
  {
    id: "public-cfp",
    title: "Open the CFP without a seat",
    start: SCENE_DURATION_SECONDS * 4,
    end: SCENE_DURATION_SECONDS * 5,
    path: "/f/cfp",
    clearSession: true,
  },
  {
    id: "speaker-portal",
    title: "Speaker portal",
    start: SCENE_DURATION_SECONDS * 5,
    end: SCENE_DURATION_SECONDS * 6,
    path: "/signin",
    actions: [
      { type: "demoAuth", label: "enter speaker seat", role: "speaker" },
      { type: "goto", label: "open speaker portal", path: "/portal" },
    ],
  },
  {
    id: "evaluation-plan",
    title: "Evaluation plan",
    start: SCENE_DURATION_SECONDS * 6,
    end: SCENE_DURATION_SECONDS * 7,
    path: "/signin",
    actions: [
      { type: "demoAuth", label: "return to organizer seat", role: "organizer" },
      { type: "goto", label: "open evaluation plan", path: "/evaluation" },
    ],
  },
  {
    id: "reviewer-queue",
    title: "Track-scoped reviewer queue",
    start: SCENE_DURATION_SECONDS * 7,
    end: SCENE_DURATION_SECONDS * 8,
    path: "/signin",
    actions: [
      { type: "demoAuth", label: "enter reviewer seat", role: "reviewer" },
      { type: "goto", label: "open reviewer queue", path: "/reviewer" },
    ],
  },
  {
    id: "accepted-agenda",
    title: "Push accepted sessions to the agenda",
    start: SCENE_DURATION_SECONDS * 8,
    end: SCENE_DURATION_SECONDS * 9,
    path: "/signin",
    actions: [
      { type: "demoAuth", label: "return to organizer seat", role: "organizer" },
      { type: "goto", label: "open agenda builder", path: "/agenda-builder" },
    ],
  },
  {
    id: "agenda-conflicts",
    title: "Build the agenda and catch conflicts",
    start: SCENE_DURATION_SECONDS * 9,
    end: SCENE_DURATION_SECONDS * 10,
    path: "/agenda-builder",
  },
  {
    id: "public-program",
    title: "View the public agenda and embed",
    start: SCENE_DURATION_SECONDS * 10,
    end: SCENE_DURATION_SECONDS * 11,
    path: "/agenda",
    clearSession: true,
    actions: [{ type: "goto", label: "open embed configuration", path: "/embed/config" }],
  },
]);

export const TIMELINE_END_SECONDS = SCENES.at(-1).end;

export class MediaValidationError extends Error {
  constructor(message, report) {
    super(message);
    this.name = "MediaValidationError";
    this.report = report;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

/** A monotonic fixed-timeline clock used by both the recorder and its tests. */
export function createTimeline({ now = () => performance.now(), sleep: sleepFn = sleep } = {}) {
  const startedAt = now();
  return {
    elapsedSeconds() {
      return (now() - startedAt) / 1_000;
    },
    async until(targetSeconds) {
      const remainingMs = targetSeconds * 1_000 - (now() - startedAt);
      if (remainingMs > 0) await sleepFn(Math.ceil(remainingMs));
    },
  };
}

/**
 * Run one interaction without allowing a missing selector to kill the take.
 * The caller owns the scene's end time, so a failed action turns into a dwell.
 */
export async function runInteraction({ label, action, timeline, dwellUntil, log = console }) {
  try {
    return { status: "ok", value: await action() };
  } catch (error) {
    const reason = errorMessage(error);
    log.warn?.(`[walkthrough] ${label} missed; dwelling until ${dwellUntil}s: ${reason}`);
    await timeline.until(dwellUntil);
    return { status: "dwell", reason };
  }
}

async function runSceneAction({ page, context, action, baseUrl, navigationTimeoutMs }) {
  if (action.type === "demoAuth") {
    const response = await context.request.post(new URL("/api/v1/auth/demo", baseUrl).toString(), {
      data: { role: action.role },
      timeout: navigationTimeoutMs,
    });
    if (!response.ok()) throw new Error(`demo ${action.role} seat refused HTTP ${response.status()}`);
    return;
  }
  if (action.type === "click") {
    await page.locator(action.selector).click({ timeout: navigationTimeoutMs });
    return;
  }
  if (action.type === "goto") {
    await page.goto(new URL(action.path, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMs,
    });
    return;
  }
  throw new Error(`Unknown walkthrough action type: ${action.type}`);
}

/** Drive one fixed scene. All navigation and selector work is dwell-safe. */
export async function runScene({
  page,
  context,
  scene,
  baseUrl,
  timeline,
  log = console,
  navigationTimeoutMs = NAVIGATION_TIMEOUT_MS,
}) {
  await timeline.until(scene.start);
  const interactions = [];

  if (scene.clearSession) {
    const clearResult = await runInteraction({
      label: `${scene.id}: clear demo session`,
      action: async () => {
        await context.clearCookies();
        await page.evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
        });
      },
      timeline,
      dwellUntil: scene.end,
      log,
    });
    interactions.push({ label: "clear demo session", status: clearResult.status, ...(clearResult.reason ? { reason: clearResult.reason } : {}) });
    if (clearResult.status === "dwell") {
      return { id: scene.id, title: scene.title, status: "dwell", interactions };
    }
  }

  const navigation = await runInteraction({
    label: `${scene.id}: navigate to ${scene.path}`,
    action: () => page.goto(new URL(scene.path, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMs,
    }),
    timeline,
    dwellUntil: scene.end,
    log,
  });
  interactions.push({ label: `navigate to ${scene.path}`, status: navigation.status, ...(navigation.reason ? { reason: navigation.reason } : {}) });
  if (navigation.status === "dwell") {
    return { id: scene.id, title: scene.title, status: "dwell", interactions };
  }

  for (const action of scene.actions ?? []) {
    const result = await runInteraction({
      label: `${scene.id}: ${action.label}`,
      action: () => runSceneAction({ page, context, action, baseUrl, navigationTimeoutMs }),
      timeline,
      dwellUntil: scene.end,
      log,
    });
    interactions.push({ label: action.label, status: result.status, ...(result.reason ? { reason: result.reason } : {}) });
    if (result.status === "dwell") {
      return { id: scene.id, title: scene.title, status: "dwell", interactions };
    }
  }

  await timeline.until(scene.end);
  return { id: scene.id, title: scene.title, status: "captured", interactions };
}

export function assertLocalBaseUrl(value = DEFAULT_BASE_URL) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`walkthrough URL is invalid: ${value}`);
  }
  if (parsed.protocol !== "http:") {
    throw new Error(`walkthrough is staging/local-only; refusing ${parsed.protocol}//${parsed.host}`);
  }
  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(`walkthrough is staging/local-only; refusing non-loopback host ${parsed.hostname}`);
  }
  if (parsed.username || parsed.password) throw new Error("walkthrough URL must not contain credentials");
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

export function assertExternalArtifactPath(value) {
  const outputPath = resolve(value);
  const relativePath = relative(REPOSITORY_ROOT, outputPath);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    throw new Error(`walkthrough artifacts must stay outside the repository: ${outputPath}`);
  }
  return outputPath;
}

async function runExternal(command, args, options = {}) {
  return execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
}

export async function readBuildStamp(baseUrl, fetchImpl = fetch) {
  const response = await fetchImpl(new URL("/health", baseUrl));
  if (!response.ok) throw new Error(`staging health returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.status !== "ok" || typeof payload.build !== "string" || payload.build.length === 0) {
    throw new Error("staging health did not return a build SHA");
  }
  return { sha: payload.build, built_at: payload.built_at ?? null };
}

export async function probeMediaFile(filePath, runCommand = runExternal) {
  const { stdout } = await runCommand("ffprobe", [
    "-v", "error",
    "-show_streams",
    "-show_format",
    "-of", "json",
    filePath,
  ]);
  return JSON.parse(stdout);
}

export async function measureMeanVolume(filePath, runCommand = runExternal) {
  const { stderr } = await runCommand("ffmpeg", [
    "-hide_banner",
    "-i", filePath,
    "-af", "volumedetect",
    "-f", "null",
    "-",
  ]);
  const match = stderr.match(/mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/i);
  if (!match) return Number.NEGATIVE_INFINITY;
  if (match[1].toLowerCase() === "inf") return Number.NEGATIVE_INFINITY;
  return Number(match[1]);
}

export function validateProbe(probe, {
  meanVolumeDb,
  minWidth = MIN_VIDEO_WIDTH,
  minHeight = MIN_VIDEO_HEIGHT,
  minDurationSeconds = MIN_DURATION_SECONDS,
  maxDurationSeconds = MAX_DURATION_SECONDS,
  minMeanVolumeDb = MIN_MEAN_VOLUME_DB,
} = {}) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const duration = Number(probe?.format?.duration ?? video?.duration ?? 0);
  const errors = [];

  if (!video) errors.push("missing video stream");
  else {
    if (video.codec_name !== "h264") errors.push(`video codec must be h264, got ${video.codec_name ?? "unknown"}`);
    if (Number(video.width) < minWidth || Number(video.height) < minHeight) {
      errors.push(`video resolution must be at least ${minWidth}x${minHeight}, got ${video.width ?? "?"}x${video.height ?? "?"}`);
    }
  }
  if (!audio) errors.push("missing audio stream");
  else {
    if (audio.codec_name !== "aac") errors.push(`audio codec must be aac, got ${audio.codec_name ?? "unknown"}`);
    if (Number(audio.channels) < 1) errors.push("audio stream has no channels");
    if (Number(audio.duration ?? 0) <= 0) errors.push("audio stream has no duration");
  }
  if (!Number.isFinite(duration) || duration < minDurationSeconds || duration > maxDurationSeconds) {
    errors.push(`duration must be between ${minDurationSeconds}s and ${maxDurationSeconds}s, got ${Number.isFinite(duration) ? `${duration}s` : "unknown"}`);
  }
  if (meanVolumeDb === undefined || !Number.isFinite(meanVolumeDb) || meanVolumeDb <= minMeanVolumeDb) {
    errors.push(`audio is silent or unmeasurable (mean volume ${meanVolumeDb ?? "unknown"} dB)`);
  }

  const report = {
    duration_seconds: Number.isFinite(duration) ? Number(duration.toFixed(3)) : null,
    video: video ? { codec: video.codec_name ?? null, width: Number(video.width), height: Number(video.height) } : null,
    audio: audio ? { codec: audio.codec_name ?? null, channels: Number(audio.channels), duration_seconds: Number(audio.duration ?? 0) } : null,
    mean_volume_db: Number.isFinite(meanVolumeDb) ? Number(meanVolumeDb.toFixed(2)) : null,
    bounds: { min_width: minWidth, min_height: minHeight, min_duration_seconds: minDurationSeconds, max_duration_seconds: maxDurationSeconds, min_mean_volume_db: minMeanVolumeDb },
    errors,
  };
  if (errors.length > 0) throw new MediaValidationError("walkthrough media validation failed", report);
  return report;
}

export async function validateMediaFile(filePath, {
  runCommand = runExternal,
  ...bounds
} = {}) {
  await access(filePath);
  const probe = await probeMediaFile(filePath, runCommand);
  const meanVolumeDb = await measureMeanVolume(filePath, runCommand);
  return validateProbe(probe, { meanVolumeDb, ...bounds });
}

async function renderNarration({ narrationPath, outputPath, voice, runCommand = runExternal }) {
  await access(narrationPath);
  const args = ["-f", narrationPath, "-o", outputPath];
  if (voice) args.unshift("-v", voice);
  await runCommand("say", args);
  return outputPath;
}

async function renderSilence({ outputPath, durationSeconds, runCommand = runExternal }) {
  await runCommand("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-t", String(durationSeconds),
    "-c:a", "pcm_s16le",
    outputPath,
  ]);
  return outputPath;
}

export async function muxMedia({ videoPath, audioPath, outputPath, runCommand = runExternal }) {
  await runCommand("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", videoPath,
    "-i", audioPath,
    "-filter_complex", "[1:a]apad[audio]",
    "-map", "0:v:0",
    "-map", "[audio]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-shortest",
    outputPath,
  ]);
  return outputPath;
}

export async function pinArtifact(filePath, validation, source) {
  const bytes = await readFile(filePath);
  const information = await stat(filePath);
  return {
    path: resolve(filePath),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: information.size,
    duration_seconds: validation.duration_seconds,
    source,
  };
}

async function gitCommit(runCommand = runExternal) {
  try {
    const { stdout } = await runCommand("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT });
    return stdout.trim();
  } catch {
    return null;
  }
}

function timestamp() {
  return new Date().toISOString().replaceAll(/[^0-9]/g, "").slice(0, 14);
}

function parsePositiveNumber(value, name, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

async function launchBrowser(headed) {
  const { chromium } = await import("@playwright/test");
  return chromium.launch({ headless: !headed });
}

export async function recordWalkthrough({
  baseUrl = DEFAULT_BASE_URL,
  outputDirectory = join(tmpdir(), `marquee-walkthrough-${timestamp()}`),
  narrationPath = DEFAULT_NARRATION_PATH,
  audioPath,
  voice,
  silent = false,
  headed = false,
  allowDwell = false,
  maxRuntimeSeconds = MAX_RUNTIME_SECONDS,
  fetchImpl = fetch,
  launch = launchBrowser,
  runCommand = runExternal,
  log = console,
} = {}) {
  const parsedBaseUrl = assertLocalBaseUrl(baseUrl);
  const outputDir = assertExternalArtifactPath(outputDirectory);
  if (maxRuntimeSeconds > MAX_RUNTIME_SECONDS) throw new Error(`max runtime must be <= ${MAX_RUNTIME_SECONDS}s`);
  await mkdir(outputDir, { recursive: true });
  let timedOut = false;
  const hardStop = setTimeout(() => {
    timedOut = true;
    process.stderr.write(`[walkthrough] hard runtime limit reached (${maxRuntimeSeconds}s); terminating\n`);
    process.exit(124);
  }, maxRuntimeSeconds * 1_000);
  try {
    const build = await readBuildStamp(parsedBaseUrl, fetchImpl);
    const recordingDirectory = join(outputDir, ".playwright-recording");
    await mkdir(recordingDirectory, { recursive: true });
    const sceneResults = [];
    let browser;
    let context;
    let page;
    let video;
    try {
      browser = await launch(headed);
      context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        recordVideo: { dir: recordingDirectory, size: VIEWPORT },
      });
      page = await context.newPage();
      page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);
      await page.emulateMedia({ reducedMotion: "reduce" }).catch(() => {});
      video = page.video();
      const timeline = createTimeline();
      for (const scene of SCENES) {
        sceneResults.push(await runScene({ page, context, scene, baseUrl: parsedBaseUrl, timeline, log }));
      }
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
    if (timedOut || !video) throw new Error("walkthrough browser did not produce a video");

    const generatedVideoPath = await video.path();
    const rawVideoPath = join(outputDir, "walkthrough.webm");
    await rename(generatedVideoPath, rawVideoPath);
    await rm(recordingDirectory, { recursive: true, force: true });

    const renderedAudioPath = audioPath ? resolve(audioPath) : join(outputDir, silent ? "silence.wav" : "narration.aiff");
    if (audioPath) await access(renderedAudioPath);
    else if (silent) await renderSilence({ outputPath: renderedAudioPath, durationSeconds: TIMELINE_END_SECONDS, runCommand });
    else await renderNarration({ narrationPath, outputPath: renderedAudioPath, voice, runCommand });

    const outputPath = join(outputDir, "marquee-walkthrough.mp4");
    await muxMedia({ videoPath: rawVideoPath, audioPath: renderedAudioPath, outputPath, runCommand });
    const validation = await validateMediaFile(outputPath, { runCommand });
    const source = { build_sha: build.sha, built_at: build.built_at, repository_commit: await gitCommit(runCommand), base_url: parsedBaseUrl.origin };
    const artifact = await pinArtifact(outputPath, validation, source);
    const dwellCount = sceneResults.filter((scene) => scene.status === "dwell").length;
    const manifest = {
      schema_version: 1,
      status: dwellCount > 0 ? "dwell" : "pass",
      artifact,
      capture: {
        viewport: VIEWPORT,
        timeline_seconds: TIMELINE_END_SECONDS,
        narration: silent ? null : resolve(narrationPath),
        audio_path: resolve(renderedAudioPath),
        scenes: sceneResults,
        dwell_count: dwellCount,
        app_data_mutations: 0,
        session_only_auth: true,
      },
    };
    const manifestPath = join(outputDir, "marquee-walkthrough.manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    if (dwellCount > 0 && !allowDwell) {
      throw new Error(`walkthrough completed with ${dwellCount} dwell scene(s); see ${manifestPath}, or rerun with --allow-dwell`);
    }
    return { ...manifest, manifest_path: manifestPath, raw_video_path: rawVideoPath };
  } finally {
    clearTimeout(hardStop);
  }
}

function usage() {
  return [
    "Usage:",
    "  node scripts/record-walkthrough.mjs --url http://localhost:5273 --output /tmp/marquee-walkthrough",
    "  node scripts/record-walkthrough.mjs --validate /tmp/marquee-walkthrough/marquee-walkthrough.mp4",
    "",
    "Options: --url, --output, --narration, --audio, --voice, --silent, --headed, --allow-dwell, --validate",
  ].join("\n");
}

async function main() {
  const args = parseArguments();
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.validate) {
    const filePath = resolve(String(args.validate));
    const validation = await validateMediaFile(filePath, {
      minDurationSeconds: parsePositiveNumber(args["min-duration-seconds"], "--min-duration-seconds", MIN_DURATION_SECONDS),
      maxDurationSeconds: parsePositiveNumber(args["max-duration-seconds"], "--max-duration-seconds", MAX_DURATION_SECONDS),
    });
    console.log(JSON.stringify({ status: "pass", artifact: await pinArtifact(filePath, validation, null), validation }, null, 2));
    return;
  }
  const result = await recordWalkthrough({
    baseUrl: args.url ?? args["base-url"] ?? process.env.MARQUEE_WALKTHROUGH_URL ?? DEFAULT_BASE_URL,
    outputDirectory: args.output ?? join(tmpdir(), `marquee-walkthrough-${timestamp()}`),
    narrationPath: args.narration ?? DEFAULT_NARRATION_PATH,
    audioPath: args.audio,
    voice: args.voice,
    silent: Boolean(args.silent),
    headed: Boolean(args.headed),
    allowDwell: Boolean(args["allow-dwell"]),
    maxRuntimeSeconds: parsePositiveNumber(args["max-runtime-seconds"], "--max-runtime-seconds", MAX_RUNTIME_SECONDS),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (error instanceof MediaValidationError) {
      console.error(JSON.stringify({ status: "fail", error: error.message, validation: error.report }, null, 2));
    } else {
      console.error(`[record-walkthrough] ${errorMessage(error)}`);
    }
    process.exitCode = 1;
  });
}
