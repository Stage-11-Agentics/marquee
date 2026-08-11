/**
 * Per-request instrumentation of the bindings themselves.
 *
 * Two problems are solved here, and both are solved STRUCTURALLY — by wrapping
 * the binding rather than by asking every call site to remember something.
 *
 * CORRELATION ACROSS ASYNC BOUNDARIES. An acceptance becomes a queue message,
 * which becomes a mail send, which becomes a webhook: four invocations, four
 * sets of log lines, and — until the correlation id rides along inside the
 * message body — no way to tell which acceptance any of them belonged to.
 * Queue logs without it are orphans. Threading a request id through ten
 * producer call sites would work until the eleventh forgot; stamping it in the
 * binding means a route cannot forget, because a route is not involved.
 *
 * THE N+1 DETECTOR. `duration_ms` tells you a request was slow. The D1 query
 * COUNT tells you why, and it is the single most common answer: a loop that
 * queries once per row. Counting at the binding is the only place that sees
 * every query, including the ones inside helpers nobody remembers calling.
 *
 * Everything here is a `get`-trap proxy that binds and forwards. Any method
 * not named below reaches the real binding untouched.
 */

/** Query counters for one request, read back when the request line is emitted. */
export interface D1Meter {
  queries: number;
  totalMs: number;
}

export interface RequestMeter {
  requestId: string;
  d1: D1Meter;
}

/** The property the instrumented env carries its meter on. */
export const REQUEST_METER_KEY = "__marqueeRequestMeter";

export interface InstrumentedBindings {
  [REQUEST_METER_KEY]?: RequestMeter;
}

/** Host objects need their real receiver; a proxy as `this` is an illegal invocation. */
function forward<Target extends object>(target: Target, property: string | symbol): unknown {
  const value = Reflect.get(target, property) as unknown;
  return typeof value === "function" ? (value as (...args: never[]) => unknown).bind(target) : value;
}

function meterStatement(statement: D1PreparedStatement, meter: D1Meter): D1PreparedStatement {
  return new Proxy(statement, {
    get(target, property) {
      if (property === "bind") {
        return (...values: unknown[]) => meterStatement(target.bind(...values), meter);
      }
      if (property === "first" || property === "all" || property === "run" || property === "raw") {
        return async (...args: never[]) => {
          const startedAt = Date.now();
          meter.queries += 1;
          try {
            return await (forward(target, property) as (...a: never[]) => Promise<unknown>)(...args);
          } finally {
            meter.totalMs += Date.now() - startedAt;
          }
        };
      }
      return forward(target, property);
    },
  }) as D1PreparedStatement;
}

/** Count and time every query this request runs, wherever it is issued from. */
export function meterD1(database: D1Database, meter: D1Meter): D1Database {
  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => meterStatement(target.prepare(query), meter);
      }
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const startedAt = Date.now();
          // A batch is one round trip carrying many statements; counting the
          // statements is what makes an N+1 written as a batch still visible.
          meter.queries += statements.length;
          try {
            return await target.batch(statements);
          } finally {
            meter.totalMs += Date.now() - startedAt;
          }
        };
      }
      return forward(target, property);
    },
  }) as D1Database;
}

/**
 * Stamp the correlation id into every message this request enqueues, so the
 * consumer — running minutes later in a different invocation — logs under the
 * same id as the click that caused it.
 *
 * Only plain object bodies are stamped, and only when they do not already carry
 * one: a producer that sets its own `request_id` deliberately keeps it.
 */
export function correlateQueue(queue: Queue<unknown>, requestId: string): Queue<unknown> {
  const stamp = (body: unknown): unknown =>
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    !(body instanceof ArrayBuffer) &&
    (body as { request_id?: unknown }).request_id === undefined
      ? { ...(body as Record<string, unknown>), request_id: requestId }
      : body;

  return new Proxy(queue, {
    get(target, property) {
      if (property === "send") {
        return (body: unknown, options?: QueueSendOptions) => target.send(stamp(body), options);
      }
      if (property === "sendBatch") {
        return (messages: Iterable<MessageSendRequest<unknown>>, options?: QueueSendBatchOptions) =>
          target.sendBatch(
            [...messages].map((message) => ({ ...message, body: stamp(message.body) })),
            options,
          );
      }
      return forward(target, property);
    },
  }) as Queue<unknown>;
}

const QUEUE_BINDINGS = ["MAIL_QUEUE", "MIRROR_QUEUE", "OPERATIONS_QUEUE", "WEBHOOK_QUEUE"] as const;

/**
 * One per-request copy of the environment, with D1 metered and every queue
 * correlated. The copy is per-request on purpose: the real env object is shared
 * across every request the isolate serves, and mutating it would leak one
 * request's counters into another's.
 */
export function instrumentBindings<Bindings extends object>(
  env: Bindings,
  requestId: string,
): Bindings & InstrumentedBindings {
  const meter: RequestMeter = { requestId, d1: { queries: 0, totalMs: 0 } };
  const source = env as Record<string, unknown>;
  const instrumented: Record<string, unknown> = { ...source, [REQUEST_METER_KEY]: meter };
  const database = source.DB as D1Database | undefined;
  if (database && typeof database.prepare === "function") {
    instrumented.DB = meterD1(database, meter.d1);
  }
  for (const binding of QUEUE_BINDINGS) {
    const queue = source[binding] as Queue<unknown> | undefined;
    if (queue && typeof queue.send === "function") {
      instrumented[binding] = correlateQueue(queue, requestId);
    }
  }
  return instrumented as Bindings & InstrumentedBindings;
}

export function readRequestMeter(env: unknown): RequestMeter | undefined {
  return (env as InstrumentedBindings | undefined)?.[REQUEST_METER_KEY];
}
