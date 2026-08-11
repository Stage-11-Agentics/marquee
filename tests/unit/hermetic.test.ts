import { expect, test } from "vitest";

test("CONTRACT · the fast suite rejects outbound network access", () => {
  expect(() => fetch("https://example.com")).toThrowError(/outbound fetch is disabled/);
});
