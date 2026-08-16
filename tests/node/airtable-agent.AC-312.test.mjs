import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { promisify } from "node:util";
import { resolve } from "node:path";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const cli = resolve(repositoryRoot, "cli/marquee.mjs");

async function runCli(url, ...args) {
  const result = await execFileAsync(process.execPath, [cli, ...args, "--url", url, "--token", "mq_agent_marquee_token", "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return JSON.parse(result.stdout);
}

test("AC-312 · an agent completes connect, verify, map, and confirm through the API without opening a screen", async () => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const body = await new Promise((resolveBody) => {
      let value = "";
      request.on("data", (chunk) => { value += chunk; });
      request.on("end", () => resolveBody(value ? JSON.parse(value) : null));
    });
    requests.push({ method: request.method, path: request.url, body, authorization: request.headers.authorization });
    response.setHeader("content-type", "application/json");
    const payload = request.url === "/api/v1/mirror/connect"
      ? { data: { base_id: "app_agent", tables: [{ id: "tbl_people", name: "People", fields: [] }, { id: "tbl_submissions", name: "Submissions", fields: [] }, { id: "tbl_tasks", name: "Speaker tasks", fields: [] }] } }
      : request.url === "/api/v1/mirror/mapping"
      ? { data: { base_id: "app_agent", mapped: true, tables: [] } }
      : request.url === "/api/v1/mirror/status"
      ? { data: { base_id: "app_agent", mapped: true, configured: true, queued: 0, stuck: 0 } }
      : request.url === "/api/v1/mirror/sync"
      ? { data: { queued: true } }
      : { data: { disconnected: true, warning: null } };
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;

  try {
    const connect = await runCli(url, "mirror", "connect", "--base-id", "app_agent", "--airtable-token", "pat_agent_secret");
    const mapping = await runCli(url, "mirror", "map", "--set", "submissions=tbl_submissions", "--set", "speaker_tasks=tbl_tasks", "--set", "people=tbl_people", "--airtable-token", "pat_agent_secret");
    const status = await runCli(url, "mirror", "status");
    const sync = await runCli(url, "mirror", "sync");
    const disconnect = await runCli(url, "mirror", "disconnect");

    assert.equal(connect.data.base_id, "app_agent");
    assert.equal(mapping.data.mapped, true);
    assert.equal(status.data.mapped, true);
    assert.equal(sync.data.queued, true);
    assert.equal(disconnect.data.disconnected, true);
    assert.deepEqual(requests.map((request) => request.path), [
      "/api/v1/mirror/connect",
      "/api/v1/mirror/mapping",
      "/api/v1/mirror/status",
      "/api/v1/mirror/sync",
      "/api/v1/mirror/disconnect",
    ]);
    assert.ok(requests.every((request) => request.path.startsWith("/api/v1/mirror/")));
    assert.ok(requests.every((request) => request.authorization === "Bearer mq_agent_marquee_token"));
    assert.equal(requests[0].body.token, "pat_agent_secret");
    assert.notEqual(requests[0].body.token, "mq_agent_marquee_token");
    assert.deepEqual(requests[1].body, {
      submissions: "tbl_submissions",
      speaker_tasks: "tbl_tasks",
      people: "tbl_people",
      token: "pat_agent_secret",
      intent: "adopt",
      continuation: "submissions",
    });
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }

  const skill = await readFile(resolve(repositoryRoot, "SKILL.md"), "utf8");
  const gettingStarted = await readFile(resolve(repositoryRoot, "docs/GETTING-STARTED.md"), "utf8");
  assert.match(skill, /node cli\/marquee\.mjs mirror connect/);
  assert.match(skill, /MIRROR_CREDENTIAL_SECRET/);
  assert.match(gettingStarted, /mirror map/);
  assert.match(gettingStarted, /without opening a screen/);
});
