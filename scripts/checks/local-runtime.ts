import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { REPOSITORY_ROOT } from "./lib/command.mjs";

const NODE = process.execPath;
const VITE = resolve(REPOSITORY_ROOT, "node_modules/.bin/vite");
const WRANGLER = resolve(REPOSITORY_ROOT, "node_modules/.bin/wrangler");
const GENERATED_WRANGLER_CONFIG = resolve(REPOSITORY_ROOT, "dist/marquee/wrangler.json");
const TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";

type Child = ReturnType<typeof spawn>;

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function commandEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: "1",
    NO_COLOR: "1",
    NO_UPDATE_NOTIFIER: "1",
    WRANGLER_SEND_METRICS: "false",
  };
}

function runCommand(binary: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(binary, args, {
      cwd: REPOSITORY_ROOT,
      env: options.env ?? commandEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolveResult({
        code: code ?? (signal ? 1 : 0),
        stdout,
        stderr,
      });
    });
  });
}

async function requireCommand(binary: string, args: string[], label: string): Promise<void> {
  const result = await runCommand(binary, args);
  if (result.code !== 0) {
    const detail = `${result.stdout}\n${result.stderr}`.trim().slice(-6_000);
    throw new Error(`${label} failed (exit ${result.code})${detail ? `\n${detail}` : ""}`);
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePort());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not allocate a local port");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitForHealth(baseUrl: string, child: Child): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError = "health endpoint did not answer";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited before health check (exit ${child.exitCode})`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = `health returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`local Wrangler runtime did not become ready: ${lastError}`);
}

async function stopChild(child: Child): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

export interface LocalRuntime {
  baseUrl: string;
  persistPath: string;
  query(command: string): Promise<Array<Record<string, unknown>>>;
  environment: {
    kind: "local-wrangler-dev";
    runtime: "wrangler dev/miniflare";
    deployed: false;
    seed: "scripts/seed/index.ts";
  };
}

/**
 * Build the production assets, apply migrations, seed a private D1 directory,
 * and run the real Worker locally. Each command gets a fresh directory so a
 * speed probe cannot inherit cache, queue, or mutation state from another run.
 */
export async function withLocalRuntime<T>(callback: (runtime: LocalRuntime) => Promise<T>): Promise<T> {
  const persistPath = await mkdtemp(join(tmpdir(), "marquee-mrq-23-"));
  let worker: Child | null = null;
  try {
    await requireCommand(VITE, ["build"], "production asset build");
    await requireCommand(WRANGLER, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistPath], "local D1 migrations");
    await requireCommand(NODE, ["scripts/seed/index.ts", "--persist-to", persistPath], "real seed");
    const config = await readFile(GENERATED_WRANGLER_CONFIG, "utf8").catch(() => "");
    if (!config) throw new Error(`Vite did not produce ${GENERATED_WRANGLER_CONFIG}`);
    const port = await freePort();
    worker = spawn(WRANGLER, [
      "dev",
      "--config", GENERATED_WRANGLER_CONFIG,
      "--local",
      "--persist-to", persistPath,
      "--local-protocol", "http",
      "--port", String(port),
    ], {
      cwd: REPOSITORY_ROOT,
      env: {
        ...commandEnvironment(),
        TURNSTILE_SITE_KEY,
        TURNSTILE_SECRET_KEY,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let workerStderr = "";
    worker.stderr?.on("data", (chunk) => { workerStderr += String(chunk); });
    await waitForHealth(`http://127.0.0.1:${port}`, worker).catch((error) => {
      const detail = workerStderr.trim().slice(-6_000);
      throw new Error(`${error instanceof Error ? error.message : String(error)}${detail ? `\n${detail}` : ""}`);
    });
    const query = async (command: string): Promise<Array<Record<string, unknown>>> => {
      const result = await runCommand(WRANGLER, [
        "d1", "execute", "DB", "--local", "--persist-to", persistPath,
        "--command", command, "--json",
      ]);
      if (result.code !== 0) {
        const detail = `${result.stdout}\n${result.stderr}`.trim().slice(-6_000);
        throw new Error(`local D1 query failed (exit ${result.code})${detail ? `\n${detail}` : ""}`);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(result.stdout) as unknown;
      } catch (error) {
        throw new Error(`local D1 query returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
      const first = Array.isArray(payload) ? payload[0] : null;
      if (!first || typeof first !== "object" || (first as { success?: unknown }).success !== true) {
        throw new Error(`local D1 query was not successful: ${command}`);
      }
      const rows = (first as { results?: unknown }).results;
      if (!Array.isArray(rows)) throw new Error(`local D1 query returned no result set: ${command}`);
      return rows as Array<Record<string, unknown>>;
    };

    return await callback({
      baseUrl: `http://127.0.0.1:${port}`,
      persistPath,
      query,
      environment: {
        kind: "local-wrangler-dev",
        runtime: "wrangler dev/miniflare",
        deployed: false,
        seed: "scripts/seed/index.ts",
      },
    });
  } finally {
    if (worker) await stopChild(worker);
    await rm(persistPath, { force: true, recursive: true });
  }
}
