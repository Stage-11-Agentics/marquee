import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { COMMAND_REGISTRY, renderHelp } from "../../cli/registry.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const CLI = resolve(ROOT, "cli/marquee.mjs");
const TOKEN = "mq_test_scoped_token";

function jsonResponse(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(body);
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

async function startApi() {
  const requests = [];
  let resetRead = 0;
  let seeded = false;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const body = await readRequestBody(request);
    requests.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, headers: request.headers });
    if (request.headers.cookie) return jsonResponse(response, 400, { error: { message: "cookie auth was used" } });

    if (request.method === "POST" && url.pathname === "/api/v1/admin/reset-demo") {
      return jsonResponse(response, 202, { ok: true, job_id: "job_test", status: "queued" });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/admin/reset-demo/job_test") {
      resetRead += 1;
      seeded = true;
      return jsonResponse(response, 200, {
        id: "job_test",
        status: "done",
        created_at: 1,
        updated_at: 2,
        result: { event_id: "evt_test" },
      });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/auth/me") {
      return jsonResponse(response, 200, { kind: "api_token", demo_event_id: seeded ? "evt_test" : null });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/events/evt_test") {
      return jsonResponse(response, 200, { id: "evt_test", name: "Test conference", formats: [], tracks: [] });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/events/evt_test/submissions") {
      return jsonResponse(response, 200, { data: [{ id: "sub_test", kind: "session", title: "Test Session", status: "accepted" }], page: 1, per_page: 50, total: 1 });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/events/evt_test/submissions/sub_test") {
      return jsonResponse(response, 200, { id: "sub_test", kind: "session", title: "Test Session", status: "accepted" });
    }
    if (request.method === "POST" && url.pathname === "/api/v1/events/evt_test/submissions/bulk") {
      return jsonResponse(response, 200, { operation_id: "op_test", selected: 1, action: body.action, selector: body.selector });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/events/evt_test/onboarding") {
      return jsonResponse(response, 200, { data: [{ person_id: "person_test", tasks: [] }], filter: url.searchParams.get("filter") });
    }
    if (request.method === "POST" && url.pathname === "/api/v1/events/evt_test/comms/send") {
      return jsonResponse(response, 202, { selected: 1, queued: 1, duplicate: 0, outbox_ids: ["outbox_test"], outbox_rows: [], received: body });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/events/evt_test/agenda") {
      return jsonResponse(response, 200, { sessions: [{ id: "slot_test", title: "Test Session", room: "Room A" }], rooms: [], conflicts: [] });
    }
    return jsonResponse(response, 404, { error: { message: `unhandled ${request.method} ${url.pathname}` } });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    requests,
    get resetRead() { return resetRead; },
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

function runCli(arguments_, url) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [CLI, ...arguments_], {
      cwd: ROOT,
      env: { ...process.env, MARQUEE_URL: "", MARQUEE_TOKEN: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolveRun({ code, stdout, stderr, url }));
  });
}

function scopedArgs(url, ...arguments_) {
  return [...arguments_, "--url", url, "--token", TOKEN, "--json"];
}

test("AC-138 + AC-139 + AC-140 + AC-250 · every CLI workflow uses bearer auth, server filters, JSON output, and both reminder forms", async () => {
  const api = await startApi();
  try {
    const runs = [];
    runs.push(await runCli(scopedArgs(api.url, "event", "seed"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "event", "show", "evt_test"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "submissions", "list", "evt_test", "--filter", "status=accepted"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "submissions", "show", "evt_test", "sub_test"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "submissions", "accept", "evt_test", "--filter", "status=submitted"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "submissions", "reject", "evt_test", "--filter", "status=in_review"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "tasks", "list", "evt_test", "--overdue"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "remind", "evt_test", "--filter", "task_state=open", "--template", "task_overdue"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "remind", "evt_test", "--filter", "task_state=open", "--subject", "A nudge", "--body", "Please finish the Task."), api.url));
    runs.push(await runCli(scopedArgs(api.url, "agenda", "export", "evt_test"), api.url));

    for (const run of runs) {
      assert.equal(run.code, 0, run.stderr);
      assert.equal(run.stderr, "");
      assert.doesNotThrow(() => JSON.parse(run.stdout), run.stdout);
    }
    assert.ok(api.resetRead > 0, "seed polls the reset job");
    assert.ok(api.requests.every((request) => request.headers.authorization === `Bearer ${TOKEN}`));
    assert.ok(api.requests.every((request) => !request.headers.cookie), "the CLI never sends a session cookie");
    const list = api.requests.find((request) => request.path.endsWith("/submissions") && request.method === "GET");
    assert.equal(list.query.status, "accepted");
    const accept = api.requests.find((request) => request.path.endsWith("/submissions/bulk") && request.body?.action === "accept");
    assert.deepEqual(accept.body.selector, { filter: { status: "submitted" } });
    const template = api.requests.find((request) => request.path.endsWith("/comms/send") && request.body?.template_key);
    assert.deepEqual(template.body, { selector: { task_state: "open" }, template_key: "task_overdue" });
    const adHoc = api.requests.find((request) => request.path.endsWith("/comms/send") && request.body?.subject);
    assert.deepEqual(adHoc.body, { selector: { task_state: "open" }, subject: "A nudge", body: "Please finish the Task." });

    const secondApi = await startApi();
    try {
      const second = await runCli(scopedArgs(secondApi.url, "event", "show", "evt_test"), secondApi.url);
      assert.equal(second.code, 0, second.stderr);
      assert.notEqual(api.url, secondApi.url, "the token client can target distinct instances");
      assert.equal(secondApi.requests[0].headers.authorization, `Bearer ${TOKEN}`);
    } finally {
      await secondApi.close();
    }
  } finally {
    await api.close();
  }
});

test("AC-141 · root help enumerates the registry and every leaf command has successful help", async () => {
  const root = await runCli(["--help"], "unused");
  assert.equal(root.code, 0, root.stderr);
  assert.equal(root.stderr, "");
  for (const command of COMMAND_REGISTRY) {
    const usage = command.usage.replace(/^marquee\s+/, "");
    assert.match(root.stdout, new RegExp(usage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const help = await runCli([...command.path, "--help"], "unused");
    assert.equal(help.code, 0, `${command.path.join(" ")}: ${help.stderr}`);
    assert.equal(help.stdout, `${renderHelp(command.path)}\n`);
    assert.equal(help.stderr, "");
  }
});
