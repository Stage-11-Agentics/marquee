const EVENT_ID = "01SPKEVENT0000000000000000";
const FORM_ID = "01SPKFORM00000000000000000";
const WAVE_ID = "01SPKWAVE00000000000000000";
const DECIDER_ID = "01SPKPERSON000000000000000";
const MAX_ROWS = 1_000;
const MAX_BOUND_PARAMS = 90;
const FIXED_BINDINGS = 6;
const IDS_PER_CHUNK = MAX_BOUND_PARAMS - FIXED_BINDINGS;

function submissionId(index) {
  return `01SPK${String(index).padStart(21, "0")}`;
}

function generateSubmissions(count) {
  const createdAt = 1_786_249_200_000;
  return Array.from({ length: count }, (_, index) => {
    const id = submissionId(index);
    return {
      id,
      event_id: EVENT_ID,
      form_id: FORM_ID,
      kind: index % 17 === 0 ? "session" : "abstract",
      bypass_evaluation: index % 17 === 0 ? 1 : 0,
      title: `Deterministic submission ${index + 1}`,
      abstract: `Benchmark payload for submission ${index + 1}.`,
      status: "in_review",
      format_id: `format-${index % 4}`,
      primary_track_id: `track-${index % 8}`,
      origin: index % 5 === 0 ? "import" : "public",
      vendor_affiliation: "none",
      wave_id: null,
      submitter_person_id: `person-${String(index).padStart(4, "0")}`,
      submitted_at: createdAt + index,
      last_saved_at: createdAt + index,
      is_published: 0,
      external_ref: index % 5 === 0 ? `external-${index}` : null,
      search_blob: `deterministic submission ${index + 1} track-${index % 8}`,
      created_at: createdAt + index,
      updated_at: createdAt + index,
    };
  });
}

function json(data, status = 200) {
  return Response.json(data, { status });
}

function requireCount(url) {
  const count = Number(url.searchParams.get("rows"));
  if (!Number.isInteger(count) || count < 1 || count > MAX_ROWS) {
    throw new Error(`rows must be an integer from 1 through ${MAX_ROWS}`);
  }
  return count;
}

function metric(result) {
  return {
    changes: result.meta?.changes ?? null,
    duration_ms: result.meta?.duration ?? null,
    rows_read: result.meta?.rows_read ?? null,
    rows_written: result.meta?.rows_written ?? null,
  };
}

async function setup(db) {
  const rows = generateSubmissions(MAX_ROWS);
  const insertSql = `
    INSERT INTO submissions (
      id, event_id, form_id, kind, bypass_evaluation, title, abstract,
      status, format_id, primary_track_id, origin, vendor_affiliation,
      wave_id, submitter_person_id, submitted_at, last_saved_at,
      is_published, external_ref, search_blob, created_at, updated_at
    )
    SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.event_id'),
      json_extract(value, '$.form_id'),
      json_extract(value, '$.kind'),
      json_extract(value, '$.bypass_evaluation'),
      json_extract(value, '$.title'),
      json_extract(value, '$.abstract'),
      json_extract(value, '$.status'),
      json_extract(value, '$.format_id'),
      json_extract(value, '$.primary_track_id'),
      json_extract(value, '$.origin'),
      json_extract(value, '$.vendor_affiliation'),
      json_extract(value, '$.wave_id'),
      json_extract(value, '$.submitter_person_id'),
      json_extract(value, '$.submitted_at'),
      json_extract(value, '$.last_saved_at'),
      json_extract(value, '$.is_published'),
      json_extract(value, '$.external_ref'),
      json_extract(value, '$.search_blob'),
      json_extract(value, '$.created_at'),
      json_extract(value, '$.updated_at')
    FROM json_each(?)
  `;

  await db.prepare("DELETE FROM submissions").run();
  const inserted = await db.prepare(insertSql).bind(JSON.stringify(rows)).run();
  const count = await db.prepare("SELECT count(*) AS count FROM submissions").first("count");

  return {
    generated_rows: rows.length,
    persisted_rows: count,
    insert: metric(inserted),
  };
}

function trialValues(now) {
  return ["accepted", WAVE_ID, now, DECIDER_ID, now, EVENT_ID];
}

async function runChunked(db, ids, now) {
  const statements = [];
  const boundParamsPerStatement = [];
  for (let offset = 0; offset < ids.length; offset += IDS_PER_CHUNK) {
    const chunk = ids.slice(offset, offset + IDS_PER_CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    const sql = `
      UPDATE submissions
      SET status = ?, wave_id = ?, decided_at = ?,
          decided_by_person_id = ?, updated_at = ?
      WHERE event_id = ? AND id IN (${placeholders})
    `;
    statements.push(db.prepare(sql).bind(...trialValues(now), ...chunk));
    boundParamsPerStatement.push(FIXED_BINDINGS + chunk.length);
  }

  const startedAt = performance.now();
  const results = await db.batch(statements);
  const wallMs = performance.now() - startedAt;

  return {
    wall_ms: wallMs,
    write_query_count: results.length,
    bound_params_per_query: boundParamsPerStatement,
    metrics: results.map(metric),
  };
}

async function runJsonEach(db, ids, now) {
  const sql = `
    UPDATE submissions
    SET status = ?, wave_id = ?, decided_at = ?,
        decided_by_person_id = ?, updated_at = ?
    WHERE event_id = ?
      AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
  `;
  const statement = db
    .prepare(sql)
    .bind(...trialValues(now), JSON.stringify(ids));

  const startedAt = performance.now();
  const result = await statement.run();
  const wallMs = performance.now() - startedAt;

  return {
    wall_ms: wallMs,
    write_query_count: 1,
    bound_params_per_query: [FIXED_BINDINGS + 1],
    ids_json_bytes: new TextEncoder().encode(JSON.stringify(ids)).byteLength,
    metrics: [metric(result)],
  };
}

async function runTrial(db, count, pattern) {
  const ids = Array.from({ length: count }, (_, index) => submissionId(index));
  await db
    .prepare(`
      UPDATE submissions
      SET status = 'in_review', wave_id = NULL, decided_at = NULL,
          decided_by_person_id = NULL
      WHERE event_id = ?
    `)
    .bind(EVENT_ID)
    .run();

  const now = Date.now();
  const measured = pattern === "chunked"
    ? await runChunked(db, ids, now)
    : await runJsonEach(db, ids, now);
  const accepted = await db
    .prepare("SELECT count(*) AS count FROM submissions WHERE event_id = ? AND status = 'accepted'")
    .bind(EVENT_ID)
    .first("count");
  const changes = measured.metrics.reduce(
    (total, item) => total + (item.changes ?? 0),
    0,
  );

  if (accepted !== count || changes !== count) {
    throw new Error(`write mismatch: expected ${count}, accepted ${accepted}, changes ${changes}`);
  }

  return {
    pattern,
    selected_rows: count,
    accepted_rows: accepted,
    total_changes: changes,
    request_d1_query_count: measured.write_query_count + 2,
    ...measured,
  };
}

async function probeBoundLimit(db) {
  const makeStatement = (count) => {
    const ids = Array.from({ length: count }, (_, index) => submissionId(index));
    return db
      .prepare(`UPDATE submissions SET status = 'in_review' WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids);
  };

  const atCap = await makeStatement(100).run();
  let overCap;
  try {
    await makeStatement(101).run();
    overCap = { rejected: false, error: null };
  } catch (error) {
    overCap = { rejected: true, error: String(error) };
  }

  if (!overCap.rejected) {
    throw new Error("local D1 unexpectedly accepted 101 bound parameters");
  }

  return {
    exactly_100: { succeeded: true, ...metric(atCap) },
    exactly_101: overCap,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/setup") {
        return json(await setup(env.DB));
      }
      if (request.method === "POST" && url.pathname === "/probe-bound-limit") {
        return json(await probeBoundLimit(env.DB));
      }
      if (request.method === "POST" && url.pathname === "/trial") {
        const count = requireCount(url);
        const pattern = url.searchParams.get("pattern");
        if (pattern !== "chunked" && pattern !== "json_each") {
          throw new Error("pattern must be chunked or json_each");
        }
        return json(await runTrial(env.DB, count, pattern));
      }
      return json({ error: "not found" }, 404);
    } catch (error) {
      return json({ error: String(error), stack: error?.stack ?? null }, 500);
    }
  },
};
