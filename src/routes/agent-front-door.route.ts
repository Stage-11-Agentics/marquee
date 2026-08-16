import { Hono } from "hono";

import type { Env } from "../index";
import {
  generatedLlmsFullText,
  generatedLlmsText,
  servedDocuments,
} from "../lib/agent-front-door";

export const agentFrontDoorRoutes = new Hono<{ Bindings: Env }>();

function markdownResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}

agentFrontDoorRoutes.get("/llms.txt", () => markdownResponse(generatedLlmsText));
agentFrontDoorRoutes.get("/llms-full.txt", () => markdownResponse(generatedLlmsFullText));

for (const document of servedDocuments) {
  agentFrontDoorRoutes.get(document.url, () => markdownResponse(document.content));
}
