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
  let agendaVersion = 1;
  const adHocComposeKeys = new Set();
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
    if (request.method === "GET" && url.pathname === "/api/v1/submissions/sub_test/notes") {
      return jsonResponse(response, 200, { notes: [{ id: "note_test", submission_id: "sub_test", body: "Internal context", author_person_id: "person_test", author_name: "Test Organizer", created_at: 1 }] });
    }
    if (request.method === "POST" && url.pathname === "/api/v1/submissions/sub_test/notes") {
      return jsonResponse(response, 201, { note: { id: "note_new", submission_id: "sub_test", body: body.body, author_person_id: "person_test", author_name: "Test Organizer", created_at: 2 } });
    }
    if (request.method === "POST" && url.pathname === "/api/v1/events/evt_test/submissions/bulk") {
      return jsonResponse(response, 200, { operation_id: "op_test", selected: 1, action: body.action, selector: body.selector });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/events/evt_test/onboarding") {
      return jsonResponse(response, 200, { data: [{ person_id: "person_test", tasks: [] }], filter: url.searchParams.get("filter") });
    }
    if (request.method === "POST" && url.pathname === "/api/v1/events/evt_test/comms/send") {
      const key = request.headers["idempotency-key"];
      const duplicate = Boolean(body.subject && key && adHocComposeKeys.has(key));
      if (body.subject && key) adHocComposeKeys.add(key);
      return jsonResponse(response, 202, {
        selected: 1,
        queued: duplicate ? 0 : 1,
        duplicate: duplicate ? 1 : 0,
        outbox_ids: duplicate ? [] : ["outbox_test"],
        outbox_rows: [],
        received: body,
      });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/events/evt_test/agenda") {
      return jsonResponse(response, 200, {
        sessions: [{ id: "slot_test", title: "Test Session", room: "Room A", etag: `"slot_test:${agendaVersion}"` }],
        rooms: [],
        conflicts: [],
      });
    }
    if (request.method === "PATCH" && url.pathname === "/api/v1/events/evt_test") {
      return jsonResponse(response, 200, { data: { event: { id: "evt_test", ...body }, formats: [], tracks: [] } });
    }
    if (url.pathname === "/api/v1/events/evt_test/tracks") {
      if (request.method === "GET") return jsonResponse(response, 200, { data: [{ id: "trk_test", name: "Agents" }] });
      if (request.method === "POST") return jsonResponse(response, 201, { data: { id: "trk_new", ...body } });
    }
    if (request.method === "DELETE" && url.pathname === "/api/v1/events/evt_test/tracks/trk_test") {
      return jsonResponse(response, 200, { deleted: "trk_test" });
    }
    if (url.pathname === "/api/v1/events/evt_test/formats") {
      if (request.method === "GET") return jsonResponse(response, 200, { data: [{ id: "fmt_test", name: "Lightning" }] });
      if (request.method === "POST") return jsonResponse(response, 201, { data: { id: "fmt_new", ...body } });
    }
    if (request.method === "DELETE" && url.pathname === "/api/v1/events/evt_test/formats/fmt_test") {
      return jsonResponse(response, 200, { deleted: "fmt_test" });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/events/evt_test/search") {
      return jsonResponse(response, 200, { data: [{ id: "sub_test", kind: "session", title: "Test Session" }] });
    }
    if (request.method === "POST" && url.pathname === "/api/v1/events/evt_test/submissions/sub_test/schedule") {
      return jsonResponse(response, 200, { id: "sub_test", status: "accepted", scheduled: body });
    }
    if (request.method === "POST" && url.pathname === "/api/v1/events/evt_test/submissions/sub_test/publish") {
      return jsonResponse(response, 200, { id: "sub_test", status: "accepted", is_published: true });
    }
    if (request.method === "POST" && url.pathname === "/api/v1/events/evt_test/agenda/items") {
      return jsonResponse(response, 201, { id: "slot_new", ...body, etag: '"slot_new:1"' });
    }
    if (url.pathname === "/api/v1/events/evt_test/agenda/items/slot_test") {
      // The stub enforces the real precondition: only the agenda's current
      // version may write, and a stale tag is a 409 exactly as D1's CAS is.
      const ifMatch = request.headers["if-match"];
      if (ifMatch !== `"slot_test:${agendaVersion}"`) {
        return jsonResponse(response, 409, {
          error: { code: "conflict", message: "stale ETag: the resource changed since the supplied version" },
        });
      }
      agendaVersion += 1;
      if (request.method === "PATCH") {
        return jsonResponse(response, 200, { id: "slot_test", ...body, etag: `"slot_test:${agendaVersion}"` });
      }
      // The real route answers 204 with no body; the stub matches it so the
      // CLI's own removal summary is what the test actually exercises.
      if (request.method === "DELETE") { response.writeHead(204); return response.end(); }
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
    runs.push(await runCli(scopedArgs(api.url, "submissions", "notes", "sub_test"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "submissions", "note", "sub_test", "--set", "body=Internal follow-up"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "submissions", "accept", "evt_test", "--filter", "status=submitted"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "submissions", "reject", "evt_test", "--filter", "status=in_review"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "tasks", "list", "evt_test", "--overdue"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "remind", "evt_test", "--filter", "task_state=open", "--template", "task_overdue"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "remind", "evt_test", "--filter", "task_state=open", "--subject", "A nudge", "--body", "Please finish the Task."), api.url));
    const retryRuns = [
      await runCli(scopedArgs(api.url, "remind", "evt_test", "--filter", "task_state=open", "--subject", "A retryable nudge", "--body", "Please finish the Task again.", "--idempotency-key", "cli-compose-1"), api.url),
      await runCli(scopedArgs(api.url, "remind", "evt_test", "--filter", "task_state=open", "--subject", "A retryable nudge", "--body", "Please finish the Task again.", "--idempotency-key", "cli-compose-1"), api.url),
    ];
    runs.push(...retryRuns);
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
    const notesRead = api.requests.find((request) => request.path === "/api/v1/submissions/sub_test/notes" && request.method === "GET");
    assert.ok(notesRead, "notes read uses the submission-scoped route");
    const notesWrite = api.requests.find((request) => request.path === "/api/v1/submissions/sub_test/notes" && request.method === "POST");
    assert.deepEqual(notesWrite.body, { body: "Internal follow-up" });
    assert.equal(api.requests.filter((request) => request.path === "/api/v1/submissions/sub_test/notes").length, 2);
    const accept = api.requests.find((request) => request.path.endsWith("/submissions/bulk") && request.body?.action === "accept");
    assert.deepEqual(accept.body.selector, { filter: { status: "submitted" } });
    const template = api.requests.find((request) => request.path.endsWith("/comms/send") && request.body?.template_key);
    assert.deepEqual(template.body, { selector: { task_state: "open" }, template_key: "task_overdue" });
    const adHoc = api.requests.find((request) => request.path.endsWith("/comms/send") && request.body?.subject);
    assert.deepEqual(adHoc.body, { selector: { task_state: "open" }, subject: "A nudge", body: "Please finish the Task." });
    assert.match(adHoc.headers["idempotency-key"], /^[0-9a-f-]{36}$/);
    assert.deepEqual(JSON.parse(retryRuns[0].stdout).queued, 1);
    assert.deepEqual(JSON.parse(retryRuns[0].stdout).duplicate, 0);
    assert.deepEqual(JSON.parse(retryRuns[1].stdout).queued, 0);
    assert.deepEqual(JSON.parse(retryRuns[1].stdout).duplicate, 1);
    const retryRequests = api.requests.filter((request) => request.body?.subject === "A retryable nudge");
    assert.deepEqual(retryRequests.map((request) => request.headers["idempotency-key"]), ["cli-compose-1", "cli-compose-1"]);

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

test("AC-138 + AC-139 + AC-140 · the configure, schedule, publish and search verbs drive the loop with no raw request", async () => {
  const api = await startApi();
  try {
    const runs = [];
    runs.push(await runCli(scopedArgs(api.url, "event", "set", "evt_test", "--set", "name=AI Engineer NYC 2026", "--set", "timezone=America/New_York"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "tracks", "list", "evt_test"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "tracks", "add", "evt_test", "--set", "name=Agents", "--set", "color=#3B82F6"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "tracks", "remove", "evt_test", "trk_test"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "formats", "list", "evt_test"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "formats", "add", "evt_test", "--set", "name=Lightning", "--set", "default_duration_min=10", "--set", "min_duration_min=5", "--set", "max_duration_min=10"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "formats", "remove", "evt_test", "fmt_test"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "search", "evt_test", "--query", "retrieval"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "submissions", "schedule", "evt_test", "sub_test", "--set", "starts_at=1760000000000", "--set", "duration_min=30", "--set", "room_id=room_a"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "submissions", "publish", "evt_test", "sub_test"), api.url));
    runs.push(await runCli(scopedArgs(api.url, "agenda", "place", "evt_test", "--set", "submission_id=sub_test", "--set", "starts_at=1760000000000", "--set", "room_id=room_a"), api.url));

    for (const run of runs) {
      assert.equal(run.code, 0, run.stderr);
      assert.equal(run.stderr, "");
      assert.doesNotThrow(() => JSON.parse(run.stdout), run.stdout);
    }
    assert.ok(api.requests.every((request) => request.headers.authorization === `Bearer ${TOKEN}`));

    // AC-139's real content: --set coerces through JSON, so the API receives the
    // numbers and strings its schema declares rather than everything as text.
    const scheduled = api.requests.find((request) => request.path.endsWith("/schedule"));
    assert.deepEqual(scheduled.body, { starts_at: 1760000000000, duration_min: 30, room_id: "room_a" });
    const format = api.requests.find((request) => request.path.endsWith("/formats") && request.method === "POST");
    assert.deepEqual(format.body, { name: "Lightning", default_duration_min: 10, min_duration_min: 5, max_duration_min: 10 });
    const track = api.requests.find((request) => request.path.endsWith("/tracks") && request.method === "POST");
    assert.deepEqual(track.body, { name: "Agents", color: "#3B82F6" }, "an unparseable value stays the string it looks like");
    const settings = api.requests.find((request) => request.method === "PATCH" && request.path === "/api/v1/events/evt_test");
    assert.deepEqual(settings.body, { name: "AI Engineer NYC 2026", timezone: "America/New_York" });
    const search = api.requests.find((request) => request.path.endsWith("/search"));
    assert.equal(search.query.q, "retrieval");
    const publish = api.requests.find((request) => request.path.endsWith("/publish"));
    assert.equal(publish.method, "POST");
  } finally {
    await api.close();
  }
});

test("CONTRACT · agenda writes from the CLI carry the item's current ETag, and a stale one is refused", async () => {
  const api = await startApi();
  try {
    const move = await runCli(scopedArgs(api.url, "agenda", "move", "evt_test", "slot_test", "--set", "starts_at=1760003600000"), api.url);
    assert.equal(move.code, 0, move.stderr);
    const patch = api.requests.find((request) => request.method === "PATCH" && request.path.endsWith("/agenda/items/slot_test"));
    assert.equal(patch.headers["if-match"], '"slot_test:1"', "the CLI reads the tag off the agenda snapshot");
    assert.deepEqual(patch.body, { starts_at: 1760003600000 });

    // The move above advanced the stub's version. A caller holding the old tag
    // must be refused rather than silently overwriting the newer write.
    const stale = await runCli(scopedArgs(api.url, "agenda", "remove", "evt_test", "slot_test", "--if-match", '"slot_test:1"'), api.url);
    assert.equal(stale.code, 1, "a stale ETag fails");
    assert.match(stale.stderr, /stale ETag/);
    assert.equal(stale.stdout, "", "a failed command writes nothing to stdout");

    // Reading the tag fresh succeeds against the very same item.
    const fresh = await runCli(scopedArgs(api.url, "agenda", "remove", "evt_test", "slot_test"), api.url);
    assert.equal(fresh.code, 0, fresh.stderr);
    assert.deepEqual(
      JSON.parse(fresh.stdout),
      { removed: "slot_test", event_id: "evt_test" },
      "a 204 still yields one meaningful JSON value on stdout",
    );
    const removals = api.requests.filter((request) => request.method === "DELETE" && request.path.endsWith("/agenda/items/slot_test"));
    assert.deepEqual(
      removals.map((request) => request.headers["if-match"]),
      ['"slot_test:1"', '"slot_test:2"'],
      "the refused attempt carried the stale tag; the retry read the current one",
    );
  } finally {
    await api.close();
  }
});

test("CONTRACT · an unsupported --set key fails locally and names the legal ones", async () => {
  const api = await startApi();
  try {
    const run = await runCli(scopedArgs(api.url, "tracks", "add", "evt_test", "--set", "colour=#3B82F6"), api.url);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /unsupported --set key: colour/);
    assert.match(run.stderr, /legal keys: name, color, position/);
    assert.equal(api.requests.length, 0, "a bad key never reaches the API");
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
