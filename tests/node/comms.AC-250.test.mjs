import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("AC-250 · the comms module keeps one send route and no parallel messages endpoint or provider call", async () => {
  const source = await readFile(resolve(root, "src/routes/comms.routes.ts"), "utf8");
  const outboxSource = await readFile(resolve(root, "src/jobs/mail/outbox.ts"), "utf8");
  assert.equal((source.match(/path: \"\/api\/v1\/events\/\{eventId\}\/comms\/send\"/g) ?? []).length, 1);
  assert.doesNotMatch(source, /\/messages\/send/);
  assert.doesNotMatch(source, /fetch\(\"https:\/\/api\.resend\.com/);
  assert.equal((outboxSource.match(/insertOutbox\(input, \"always_live\"\)/g) ?? []).length, 2);
});
