import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const prototypePath = new URL("../../prototypes/pipeline-v1.1/index.html", import.meta.url);
const prototype = await readFile(prototypePath, "utf8");

test("AC-243 · board cards open exact records without lifecycle controls while agenda drag remains legal", () => {
  const boardStart = prototype.indexOf("function boardCard");
  const boardEnd = prototype.indexOf("function boardView", boardStart);
  const boardCard = prototype.slice(boardStart, boardEnd);
  assert.ok(boardStart >= 0 && boardEnd > boardStart, "binding boardCard function is present");
  assert.doesNotMatch(boardCard, /draggable\s*=/i);
  assert.doesNotMatch(boardCard, /data-lifecycle|data-program-decision|showLifecycleTransition/);
  assert.match(boardCard, /data-board-record/);

  const boardViewStart = prototype.indexOf("function boardView");
  const boardViewEnd = prototype.indexOf("function onboardingCounts", boardViewStart);
  const boardView = prototype.slice(boardViewStart, boardViewEnd);
  assert.match(boardView, /data-board-record/);
  assert.match(boardView, /e\.key\s*===\s*"Enter"/);

  const agendaStart = prototype.indexOf("function agendaView");
  const agendaEnd = prototype.indexOf("function", agendaStart + "function agendaView".length);
  const agenda = prototype.slice(agendaStart, agendaEnd > agendaStart ? agendaEnd : undefined);
  assert.match(agenda, /draggable\s*=\s*["']true["']|data-drag/);
});
