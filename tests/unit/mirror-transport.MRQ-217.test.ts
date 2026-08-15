import { expect, test } from "vitest";

import { createFetchAirtableTransport } from "../../src/jobs/mirror/transport";

test("CONTRACT · fetch transport sends the documented upsert contract", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const transport = createFetchAirtableTransport({
    apiKey: "pat_mrq217",
    baseId: "app_mrq217",
    apiOrigin: "https://airtable.test",
    fetcher: async (url, init) => {
      requests.push({ url: typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url, init: init ?? {} });
      return new Response("{}", { status: 200 });
    },
  });

  await transport.patchRecords({
    tableId: "tbl_submissions",
    records: [{ fields: { marquee_id: "sub_1", status: "submitted" } }],
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe("https://airtable.test/v0/app_mrq217/tbl_submissions");
  expect(requests[0]?.init.method).toBe("PATCH");
  expect(requests[0]?.init.headers).toMatchObject({
    Authorization: "Bearer pat_mrq217",
    "Content-Type": "application/json",
  });
  expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
    records: [{ fields: { marquee_id: "sub_1", status: "submitted" } }],
    performUpsert: { fieldsToMergeOn: ["marquee_id"] },
    typecast: false,
  });
});

test("CONTRACT · fetch transport resolves Airtable ids before deleting mirrored rows", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const transport = createFetchAirtableTransport({
    apiKey: "pat_mrq217",
    baseId: "app_mrq217",
    apiOrigin: "https://airtable.test",
    fetcher: async (url, init) => {
      requests.push({ url: typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url, init: init ?? {} });
      return new Response(init?.method === "GET" ? JSON.stringify({ records: [{ id: "rec_1" }] }) : "{}", { status: 200 });
    },
  });

  await transport.deleteRecords({ tableId: "tbl_people", marqueeIds: ["per_1"] });

  expect(requests.map((request) => request.init.method)).toEqual(["GET", "DELETE"]);
  expect(requests[0]?.url).toContain("filterByFormula=OR%28%7Bmarquee_id%7D+%3D+%27per_1%27%29");
  expect(requests[1]?.url).toContain("records%5B%5D=rec_1");
});
