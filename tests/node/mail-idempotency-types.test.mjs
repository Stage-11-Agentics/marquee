import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript-ast";

const root = resolve(import.meta.dirname, "../..");

test("CONTRACT · MRQ-226 · raw entity ids do not compile at the outbox boundary", async () => {
  const fixture = resolve(root, "tests/types/mail-idempotency-raw-string.ts");
  const config = {
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    types: ["@cloudflare/workers-types", "node"],
  };
  const program = ts.createProgram([fixture], config);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const messages = diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));

  assert.equal(diagnostics.length, 0, `the fixture's @ts-expect-error should consume the raw-string diagnostic:\n${messages.join("\n")}`);
});
