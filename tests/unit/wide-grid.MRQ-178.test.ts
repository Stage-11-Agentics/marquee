import { expect, test } from "vitest";

import { orderNewestFirst } from "../../src/ui/shell/wide-grid";

type GridItem = { id: string; position: number };

test("MRQ-178 · orderNewestFirst puts the highest authored position first", () => {
  const items: GridItem[] = [
    { id: "seeded", position: 0 },
    { id: "middle", position: 6 },
    { id: "newest", position: 8 },
  ];

  expect(orderNewestFirst(items, (item) => item.position).map((item) => item.id)).toEqual([
    "newest",
    "middle",
    "seeded",
  ]);
});

test("MRQ-178 · orderNewestFirst keeps authored order for equal positions", () => {
  const items: GridItem[] = [
    { id: "first-at-position", position: 8 },
    { id: "older", position: 2 },
    { id: "second-at-position", position: 8 },
  ];

  expect(orderNewestFirst(items, (item) => item.position).map((item) => item.id)).toEqual([
    "first-at-position",
    "second-at-position",
    "older",
  ]);
});
