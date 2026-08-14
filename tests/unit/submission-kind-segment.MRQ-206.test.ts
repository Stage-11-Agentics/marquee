import { renderToString } from "preact-render-to-string";
import { describe, expect, it, vi } from "vitest";
import type { VNode } from "preact";

import type { SubmissionColumnId } from "../../src/lib/submission-columns";
import { BoardKindNote } from "../../src/ui/board/ProgramBoardPage";
import {
  KindSegment,
  savedViewSearch,
  SubmissionsKindSegment,
  viewConfigFromParams,
} from "../../src/ui/submissions/SubmissionsPage";

function childSegment(control: VNode): VNode {
  return KindSegment(control.props as unknown as { kind: string; onChange: (value: string) => void }) as unknown as VNode;
}

describe("MRQ-206 submissions kind segment", () => {
  it("writes session to the existing URL when the Sessions button is clicked", () => {
    const navigate = vi.fn();
    const control = SubmissionsKindSegment({ search: "demo=organizer&kind=abstract", navigate }) as unknown as VNode;
    const segment = childSegment(control);
    const buttons = segment.props.children as unknown as VNode[];
    const sessionsButton = buttons[2]!;

    ((sessionsButton.props as unknown as { onClick: (event: unknown) => void }).onClick)({});

    expect(navigate).toHaveBeenCalledWith("/submissions?demo=organizer&kind=session");
  });

  it("reflects kind=session as the pressed Sessions button", () => {
    const html = renderToString(SubmissionsKindSegment({ search: "demo=organizer&kind=session", navigate: vi.fn() }));

    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Sessions<\/button>/);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Abstracts<\/button>/);
  });

  it("carries kind through saved-view serialization and restores the pressed segment", () => {
    const config = viewConfigFromParams(new URLSearchParams("q=distributed&kind=session&sort=title"), ["title"] as SubmissionColumnId[]);

    expect(config.filters.kind).toBe("session");

    const restoredSearch = savedViewSearch(config);
    expect(new URLSearchParams(restoredSearch).get("kind")).toBe("session");
    expect(renderToString(SubmissionsKindSegment({ search: restoredSearch, navigate: vi.fn() }))).toMatch(
      /<button[^>]*aria-pressed="true"[^>]*>Sessions<\/button>/,
    );
  });

  it("renders the board explanation only for the Sessions filter", () => {
    expect(BoardKindNote({ kind: "" })).toBeNull();
    expect(BoardKindNote({ kind: "abstract" })).toBeNull();
    expect(renderToString(BoardKindNote({ kind: "session" })!)).toContain(
      "Sessions are guaranteed — they skip evaluation and enter at Ready to place. The earlier columns are empty by design.",
    );
  });
});
