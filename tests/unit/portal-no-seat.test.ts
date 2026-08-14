/**
 * An organizer who clicks "Speaker portal" in their own sidebar is not looking
 * at a broken site. The server's 404 is a true answer — this account holds no
 * speaker or submitter record here — and the screen has to say that, and then
 * hand back a route to somewhere real.
 */
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import { NoSeatNotice } from "../../src/ui/portal/PortalPage";

const html = renderToString(h(NoSeatNotice, {}));

describe("CONTRACT · the speaker portal is not a dead end for an account without a seat", () => {
  test("CONTRACT · it names what is true instead of reporting a failure", () => {
    expect(html).toContain("You have no speaker record at this conference.");
    expect(html).not.toContain("We could not load");
    expect(html).not.toContain("conference not found");
  });

  test("CONTRACT · it tells an organizer where a speaker's portal actually opens", () => {
    expect(html).toContain("Speakers page");
    expect(html).toContain('href="/roster"');
  });

  test("CONTRACT · every state has a way out", () => {
    for (const destination of ['href="/roster"', 'href="/dashboard"', 'href="/"']) {
      expect(html).toContain(destination);
    }
  });
});
