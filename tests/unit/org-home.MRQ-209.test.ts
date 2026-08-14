import { readFileSync } from "node:fs";

import type { D1Database } from "@cloudflare/workers-types";
import { expect, test } from "vitest";

import {
  ORG_HOME_ACTIVITY_HREF,
  ORG_HOME_CREATE_HREF,
  ORG_HOME_ORGANIZERS_HREF,
  ORG_HOME_OUTREACH_HREF,
  ORG_HOME_PEOPLE_HREF,
  ORG_HOME_RETURNING_PEOPLE_HREF,
  ORG_HOME_SERVER_HREF,
} from "../../src/api/org-home";
import { readOutreachAttention } from "../../src/routes/org-home.routes";
import { ORG_HOME_ATTENTION_ORDER, ORG_HOME_ROUTE, ORG_HOME_RELATIONSHIP_ORDER } from "../../src/ui/org/OrganizationHomePage";
import { matchRoute, routesFor } from "../../src/ui/shell/route-table";

const pageSource = readFileSync(new URL("../../src/ui/org/OrganizationHomePage.tsx", import.meta.url), "utf8");

test("CONTRACT · Organization Home is an organization route before the event guard", () => {
  expect(matchRoute("/org/home")).toMatchObject({ id: "org-home", label: "Home", group: "organization", sidebar: true });
  expect(routesFor("organization")[0]?.id).toBe("org-home");
  expect(ORG_HOME_ROUTE).toBe("/api/v1/org/home");
});

test("CONTRACT · Organization Home emits canonical sibling destinations", () => {
  expect(ORG_HOME_PEOPLE_HREF).toBe("/people");
  expect(matchRoute(ORG_HOME_PEOPLE_HREF)).toBeDefined();
  expect(ORG_HOME_RETURNING_PEOPLE_HREF).toBe("/people?filter=returning");
  expect(matchRoute("/people", "?filter=returning")).toBeDefined();
  expect(ORG_HOME_OUTREACH_HREF).toBe("/pipeline");
  expect(matchRoute(ORG_HOME_OUTREACH_HREF)).toBeDefined();
  expect(ORG_HOME_ORGANIZERS_HREF).toBe("/org/organizers");
  expect(matchRoute(ORG_HOME_ORGANIZERS_HREF)).toBeDefined();
  expect(ORG_HOME_SERVER_HREF).toBe("/org/server");
  expect(matchRoute(ORG_HOME_SERVER_HREF)).toBeDefined();
  expect(ORG_HOME_ACTIVITY_HREF).toBe("/org/activity");
  expect(matchRoute(ORG_HOME_ACTIVITY_HREF)).toBeDefined();
  expect(ORG_HOME_CREATE_HREF).toBe("/conferences/new");
  expect(matchRoute(ORG_HOME_CREATE_HREF)).toBeDefined();
});

test("CONTRACT · the page uses one snapshot request and preserves prototype composition", () => {
  expect(pageSource.match(/apiFetch</g)).toHaveLength(1);
  expect(ORG_HOME_ATTENTION_ORDER).toEqual(["overdue_outreach", "stale_seats", "server_status"]);
  expect(ORG_HOME_RELATIONSHIP_ORDER).toEqual(["people", "returning_speakers", "in_outreach", "organizers"]);
  expect(pageSource).toContain("Open People CRM");
  expect(pageSource).toContain("+ Create conference");
  expect(pageSource).toContain("The relationships");
  expect(pageSource).toContain("Recent activity");
  expect(pageSource).toContain("Full log →");
  expect(pageSource).not.toContain("/outreach");
  expect(pageSource).not.toContain("/org/settings?tab=");
});

test("CONTRACT · a missing MRQ-205 stage column stays honestly unavailable", async () => {
  const db = {
    prepare: () => {
      throw new Error("no such column: latest.next_touch_on");
    },
  } as unknown as D1Database;

  await expect(readOutreachAttention(db, "org-mrq209", "2026-08-14")).resolves.toMatchObject({
    state: "unavailable",
    active_count: null,
    overdue_count: null,
    overdue_item: null,
  });
});
