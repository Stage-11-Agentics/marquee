import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { ORG_HOME_ATTENTION_ORDER, ORG_HOME_ROUTE, ORG_HOME_RELATIONSHIP_ORDER } from "../../src/ui/org/OrganizationHomePage";
import { matchRoute, routesFor } from "../../src/ui/shell/route-table";

const pageSource = readFileSync(new URL("../../src/ui/org/OrganizationHomePage.tsx", import.meta.url), "utf8");

test("CONTRACT · Organization Home is an organization route before the event guard", () => {
  expect(matchRoute("/org/home")).toMatchObject({ id: "org-home", label: "Home", group: "organization", sidebar: true });
  expect(routesFor("organization")[0]?.id).toBe("org-home");
  expect(ORG_HOME_ROUTE).toBe("/api/v1/org/home");
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
});
