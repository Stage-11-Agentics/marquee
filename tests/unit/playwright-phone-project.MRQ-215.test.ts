import { expect, test } from "vitest";

import playwrightConfig from "../../playwright.config";

test("CONTRACT · MRQ-215 · Playwright declares an iPhone 13-sized project", () => {
  const mobile = playwrightConfig.projects?.find((project) => project.name === "mobile");

  expect(mobile).toBeDefined();
  expect(mobile?.use).toMatchObject({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
});
