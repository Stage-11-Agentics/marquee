import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { REPOSITORY_ROOT, runStub } from "./lib/command.mjs";

const e2eDirectory = resolve(REPOSITORY_ROOT, "tests/e2e");
const specifications = await readdir(e2eDirectory).catch(() => []);

if (!specifications.some((name) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(name))) {
  await runStub({
    command: "e2e",
    owner: "MRQ-50",
    reason: "the deployed 11-step Playwright loop has not landed",
    replacement: "Add tests/e2e specs; this runner will then require MARQUEE_E2E_URL and execute both Playwright projects.",
  });
} else if (!process.env.MARQUEE_E2E_URL) {
  throw new Error("e2e requires MARQUEE_E2E_URL; local dev is not a substitute");
} else {
  await import("@playwright/test/cli");
}
