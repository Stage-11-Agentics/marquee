import type { D1Database } from "@cloudflare/workers-types";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { expect, test, vi } from "vitest";

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
import { ORG_HOME_ATTENTION_ORDER, ORG_HOME_ROUTE, ORG_HOME_RELATIONSHIP_ORDER, OrganizationHomePage } from "../../src/ui/org/OrganizationHomePage";
import { matchRoute, routesFor } from "../../src/ui/shell/route-table";

class TestNode {
  nodeType: number;
  localName: string;
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  attributes: Array<{ name: string; value: string }> = [];
  style = { cssText: "", setProperty: (_name: string, _value: string) => {} };
  _listeners: Record<string, unknown> = {};
  data = "";

  constructor(nodeType: number, localName: string, data = "") {
    this.nodeType = nodeType;
    this.localName = localName;
    this.data = data;
  }

  get firstChild(): TestNode | null {
    return this.childNodes[0] ?? null;
  }

  get nextSibling(): TestNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return index >= 0 ? this.parentNode.childNodes[index + 1] ?? null : null;
  }

  get textContent(): string {
    return this.nodeType === 3 ? this.data : this.childNodes.map((child) => child.textContent).join("");
  }

  appendChild(child: TestNode): TestNode {
    return this.insertBefore(child, null);
  }

  insertBefore(child: TestNode, before: TestNode | null): TestNode {
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = before ? this.childNodes.indexOf(before) : -1;
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child);
    child.parentNode = this;
    return child;
  }

  removeChild(child: TestNode): TestNode {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name: string, value: unknown): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) existing.value = String(value);
    else this.attributes.push({ name, value: String(value) });
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  addEventListener(name: string, listener: unknown): void {
    this._listeners[name] = listener;
  }

  removeEventListener(name: string, _listener: unknown): void {
    delete this._listeners[name];
  }
}

function attributeText(node: TestNode): string {
  return [
    ...node.attributes.map((attribute) => `${attribute.name}=${attribute.value}`),
    ...node.childNodes.map(attributeText),
  ].join(" ");
}

function installTestDom(): { root: TestNode; restore: () => void } {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previousDocument = globals.document;
  const previousWindow = globals.window;
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const document = {
    createElementNS: (_namespace: string, name: string) => new TestNode(1, name),
    createTextNode: (data: string) => new TestNode(3, "#text", data),
  };
  globals.document = document;
  globals.window = { sessionStorage: storage, localStorage: storage };
  return {
    root: new TestNode(1, "div"),
    restore: () => {
      if (previousDocument === undefined) delete globals.document;
      else globals.document = previousDocument;
      if (previousWindow === undefined) delete globals.window;
      else globals.window = previousWindow;
    },
  };
}

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

test("CONTRACT · the rendered page uses one snapshot request and preserves prototype composition", async () => {
  expect(ORG_HOME_ATTENTION_ORDER).toEqual(["overdue_outreach", "stale_seats", "server_status"]);
  expect(ORG_HOME_RELATIONSHIP_ORDER).toEqual(["people", "returning_speakers", "in_outreach", "organizers"]);
  const snapshot = {
    data: {
      organization: { id: "org-mrq209", name: "MRQ-209" },
      seasons: [],
      next_season: null,
      create_conference_href: ORG_HOME_CREATE_HREF,
      relationships: {
        people: { value: 1, state: "ready", note: "across all conferences.", href: ORG_HOME_PEOPLE_HREF },
        returning_speakers: { value: 0, state: "ready", note: "spoke at 2+ conferences.", href: ORG_HOME_RETURNING_PEOPLE_HREF },
        in_outreach: { value: 0, state: "ready", note: "People being courted toward a slot.", href: ORG_HOME_OUTREACH_HREF },
        organizers: { value: 1, state: "ready", note: "organization staff seats.", href: ORG_HOME_ORGANIZERS_HREF },
      },
      attention: [
        { id: "overdue_outreach", label: "Overdue outreach", state: "empty", status: "ok", count: 0, title: "No outreach follow-ups overdue", detail: "The chase is clear.", href: ORG_HOME_OUTREACH_HREF, item: null, server: null },
        { id: "stale_seats", label: "Past-conference seats", state: "empty", status: "ok", count: 0, title: "No past-conference seats need review", detail: "No ended-conference seats are waiting for review.", href: ORG_HOME_ORGANIZERS_HREF, item: null, server: null },
        { id: "server_status", label: "Server status", state: "ready", status: "ok", count: null, title: "Server: all connections working", detail: "Email, uploads, spam protection, web address", href: ORG_HOME_SERVER_HREF, item: null, server: null },
      ],
      recent_activity: [],
    },
  };
  const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(snapshot), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const dom = installTestDom();
  try {
    await act(async () => {
      render(h(OrganizationHomePage, { navigate: () => {} }), dom.root as any);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(ORG_HOME_ROUTE);
    expect(dom.root.textContent).toContain("Open People CRM");
    expect(dom.root.textContent).toContain("+ Create conference");
    expect(dom.root.textContent).toContain("The relationships");
    expect(dom.root.textContent).toContain("Recent activity");
    expect(dom.root.textContent).toContain("Full log →");
    expect(attributeText(dom.root)).not.toContain("/outreach");
    expect(attributeText(dom.root)).not.toContain("/org/settings?tab=");
  } finally {
    await act(() => { render(null, dom.root as any); });
    dom.restore();
  }
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
