/**
 * Correlation across async boundaries, and the N+1 detector.
 *
 * Both are wrapped at the binding rather than threaded through call sites,
 * because a rule enforced at ten call sites is a rule the eleventh will break.
 * These tests hold the wrapper to the two things that makes it worth having:
 * it must stamp and count everything, and it must be otherwise invisible.
 */
import { expect, test } from "vitest";

import {
  correlateQueue,
  instrumentBindings,
  meterD1,
  readRequestMeter,
} from "../../src/lib/observability/request-instrumentation";

function fakeDatabase(): { db: D1Database; issued: string[] } {
  const issued: string[] = [];
  const statement = (query: string, values: unknown[] = []): D1PreparedStatement =>
    ({
      bind: (...next: unknown[]) => statement(query, next),
      first: async () => { issued.push(`first:${query}:${values.length}`); return { ok: 1 }; },
      all: async () => { issued.push(`all:${query}`); return { results: [] }; },
      run: async () => { issued.push(`run:${query}`); return { success: true }; },
      raw: async () => { issued.push(`raw:${query}`); return []; },
    }) as unknown as D1PreparedStatement;
  const db = {
    prepare: (query: string) => statement(query),
    batch: async (statements: D1PreparedStatement[]) => {
      issued.push(`batch:${statements.length}`);
      return statements.map(() => ({ success: true }));
    },
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
  return { db, issued };
}

function fakeQueue(): { queue: Queue<unknown>; sent: unknown[] } {
  const sent: unknown[] = [];
  const queue = {
    send: async (body: unknown) => { sent.push(body); },
    sendBatch: async (messages: Iterable<{ body: unknown }>) => {
      for (const message of messages) sent.push(message.body);
    },
  } as unknown as Queue<unknown>;
  return { queue, sent };
}

test("CONTRACT · every query is counted, however it is issued", async () => {
  const { db, issued } = fakeDatabase();
  const meter = { queries: 0, totalMs: 0 };
  const metered = meterD1(db, meter);

  await metered.prepare("SELECT 1").first();
  await metered.prepare("SELECT ?").bind("x").all();
  // A bind chain is still one query, not one per bind.
  await metered.prepare("SELECT ?").bind("a").bind("b").run();
  await metered.batch([db.prepare("A"), db.prepare("B"), db.prepare("C")]);

  expect(meter.queries).toBe(6);
  expect(meter.totalMs).toBeGreaterThanOrEqual(0);
  // The wrapper is invisible: the real statements ran, in order, unchanged.
  expect(issued).toEqual(["first:SELECT 1:0", "all:SELECT ?", "run:SELECT ?", "batch:3"]);
});

test("CONTRACT · a query that throws is still counted and still throws", async () => {
  const db = {
    prepare: () => ({ first: async () => { throw new Error("D1_ERROR"); } }) as unknown as D1PreparedStatement,
  } as unknown as D1Database;
  const meter = { queries: 0, totalMs: 0 };
  await expect(meterD1(db, meter).prepare("SELECT 1").first()).rejects.toThrow("D1_ERROR");
  expect(meter.queries).toBe(1);
});

test("CONTRACT · methods the wrapper does not know about reach the real binding", async () => {
  const { db } = fakeDatabase();
  const metered = meterD1(db, { queries: 0, totalMs: 0 });
  await expect(metered.dump()).resolves.toBeInstanceOf(ArrayBuffer);
});

test("CONTRACT · every enqueued message carries the correlation id of the request that caused it", async () => {
  const { queue, sent } = fakeQueue();
  const correlated = correlateQueue(queue, "ray-8f2a4c");

  await correlated.send({ type: "mail", outbox_id: "out_1" });
  await correlated.sendBatch([{ body: { type: "mirror" } }, { body: { type: "mirror", n: 2 } }]);

  expect(sent).toEqual([
    { type: "mail", outbox_id: "out_1", request_id: "ray-8f2a4c" },
    { type: "mirror", request_id: "ray-8f2a4c" },
    { type: "mirror", n: 2, request_id: "ray-8f2a4c" },
  ]);
});

test("CONTRACT · a producer that sets its own id keeps it, and non-objects are left alone", async () => {
  const { queue, sent } = fakeQueue();
  const correlated = correlateQueue(queue, "ray-new");
  await correlated.send({ type: "mail", request_id: "ray-original" });
  await correlated.send("a bare string body");
  expect(sent).toEqual([{ type: "mail", request_id: "ray-original" }, "a bare string body"]);
});

test("CONTRACT · instrumenting an environment leaves the original untouched", async () => {
  const { db } = fakeDatabase();
  const { queue, sent } = fakeQueue();
  const env = { DB: db, MAIL_QUEUE: queue, CACHE: { marker: true } };
  const instrumented = instrumentBindings(env, "ray-1");

  expect(readRequestMeter(instrumented)?.requestId).toBe("ray-1");
  expect(instrumented.CACHE).toBe(env.CACHE);
  expect(instrumented.DB).not.toBe(env.DB);

  await instrumented.DB.prepare("SELECT 1").first();
  await instrumented.MAIL_QUEUE.send({ type: "mail" });
  expect(readRequestMeter(instrumented)?.d1.queries).toBe(1);
  expect(sent).toEqual([{ type: "mail", request_id: "ray-1" }]);

  // The shared env the isolate reuses across every request is not instrumented,
  // so one request's counters can never bleed into another's.
  await env.DB.prepare("SELECT 2").first();
  expect(readRequestMeter(instrumented)?.d1.queries).toBe(1);
  expect(readRequestMeter(env)).toBeUndefined();
});

test("CONTRACT · an environment missing a binding instruments what it has", () => {
  const instrumented = instrumentBindings({ CACHE: {} }, "ray-2");
  expect(readRequestMeter(instrumented)?.requestId).toBe("ray-2");
});
