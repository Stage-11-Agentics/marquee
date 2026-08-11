import { runStub } from "./lib/command.mjs";

const [command, owner, reason] = process.argv.slice(2);

if (!command || !owner || !reason) {
  throw new Error("stub-command requires command, owner, and reason arguments");
}

await runStub({ command, owner, reason });
