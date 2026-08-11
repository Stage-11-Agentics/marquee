import { env, SELF } from "cloudflare:test";
import { beforeAll, expect, test } from "vitest";

import type { DashboardSnapshot } from "../../src/api/dashboard";
import { loadLandingData } from "../../src/routes/landing.route";
import { reseedDemo } from "../../src/lib/reset-demo/reseed-demo";
import { FROZEN_NOW } from "../../scripts/seed/event";
import { SHIPPED_DEMO_EVENT_ID } from "../../src/lib/reset-demo/demo-fixture";
import { applyMigrations } from "./apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = SHIPPED_DEMO_EVENT_ID;

let organizerCookie = "";

async function request(path: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, { headers: { cookie: organizerCookie } });
}

async function loginOrganizer(): Promise<void> {
  const response = await SELF.fetch(`${ORIGIN}/api/v1/auth/demo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "organizer" }),
  });
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  organizerCookie = setCookie!.split(";", 1)[0]!;
}

async function listTotal(href: string): Promise<number> {
  const url = new URL(href, ORIGIN);
  url.searchParams.set("per_page", "1");
  const response = await request(`/api/v1/events/${EVENT_ID}/submissions${url.search}`);
  expect(response.status).toBe(200);
  return (await response.json<{ total: number }>()).total;
}

beforeAll(async () => {
  await applyMigrations();
  await reseedDemo(env.DB, FROZEN_NOW, env.MEDIA);
  await loginOrganizer();
}, 30_000);

test("CONTRACT · MRQ-76 every pipeline surface and its list destination share one stage cardinality", async () => {
  const [landing, dashboardResponse, boardResponse] = await Promise.all([
    loadLandingData(env.DB),
    request(`/api/v1/events/${EVENT_ID}/dashboard`),
    request(`/api/v1/events/${EVENT_ID}/board?per_page=1`),
  ]);
  expect(dashboardResponse.status).toBe(200);
  expect(boardResponse.status).toBe(200);
  const dashboard = await dashboardResponse.json<DashboardSnapshot>();
  const board = await boardResponse.json<{
    total: number;
    columns: Array<{ id: string; count: number }>;
  }>();
  const dashboardByStage = new Map(dashboard.pipeline.map((item) => [item.id, item]));
  const boardByStage = new Map(board.columns.map((column) => [column.id, column.count]));
  const landingByStage: Record<string, number> = {
    submitted: landing.counts.submitted,
    in_review: landing.counts.inReview,
    accepted: landing.counts.accepted,
    onboarding: landing.counts.onboarding,
    scheduled: landing.counts.scheduled,
    published: landing.counts.published,
  };

  for (const stage of ["submitted", "in_review", "waved", "accepted", "onboarding", "scheduled", "published"] as const) {
    const dashboardStage = dashboardByStage.get(stage);
    const boardCount = boardByStage.get(stage);
    expect(dashboardStage, `${stage} must be present on the dashboard`).toBeDefined();
    expect(boardCount, `${stage} must be present on the board`).toBeDefined();
    expect(dashboardStage!.count, `${stage} dashboard and board counts`).toBe(boardCount);
    const total = await listTotal(dashboardStage!.href);
    expect(total, `${stage} dashboard link and list total`).toBe(dashboardStage!.count);
    if (dashboardStage!.count > 0) expect(total).toBeGreaterThan(0);
    if (stage in landingByStage) expect(landingByStage[stage], `${stage} landing count`).toBe(dashboardStage!.count);
  }

  expect(boardByStage.get("declined")).toBeGreaterThan(0);
  expect(board.columns.reduce((sum, column) => sum + column.count, 0)).toBe(board.total);
});
