import { h, type VNode } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";

import {
  hasPublicSpeakingParticipant,
  PublicationConfirmation,
  type PublicationConfirmationProps,
} from "../../src/ui/submissions/SubmissionRecordPage";

type TestVNode = VNode & { props: { children?: unknown; onClick?: unknown } };

function descendants(value: unknown): TestVNode[] {
  if (Array.isArray(value)) return value.flatMap(descendants);
  if (!value || typeof value !== "object") return [];
  const node = value as TestVNode;
  return [node, ...descendants(node.props?.children)];
}

function textContent(value: unknown): string {
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (value && typeof value === "object") return textContent((value as TestVNode).props?.children);
  return value == null ? "" : String(value);
}

function buttonWithLabel(vnode: VNode, label: string): TestVNode {
  const button = descendants(vnode).find((node) =>
    typeof node.props?.onClick === "function" && textContent(node.props.children) === label,
  );
  expect(button).toBeDefined();
  return button!;
}

describe("speaker attribution", () => {
  it("CONTRACT · warns for submitter-only records while recognizing public speaking roles", () => {
    expect(hasPublicSpeakingParticipant([{ role: "submitter" }])).toBe(false);
    expect(hasPublicSpeakingParticipant([{ role: "sponsor_contact" }])).toBe(false);
    expect(hasPublicSpeakingParticipant([{ role: "speaker" }])).toBe(true);
    expect(hasPublicSpeakingParticipant([{ role: "co_speaker" }])).toBe(true);
    expect(hasPublicSpeakingParticipant([{ role: "moderator" }])).toBe(true);
    expect(hasPublicSpeakingParticipant([{ role: "chairperson" }])).toBe(true);
  });

  it("CONTRACT · renders the speakerless publication warning and drives both confirmation actions", () => {
    const actions = { confirmed: 0, cancelled: 0 };
    const props: PublicationConfirmationProps = {
      publicationRequest: "publish",
      hasSpeakingParticipant: false,
      busy: "",
      onConfirm: () => { actions.confirmed += 1; },
      onCancel: () => { actions.cancelled += 1; },
    };

    const html = renderToString(h(PublicationConfirmation, props));
    expect(html).toContain("No speaking participant is attached");
    expect(html).toContain("Speaker to be announced");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Publish this session");

    const rendered = PublicationConfirmation(props) as VNode;
    const publishButton = buttonWithLabel(rendered, "Publish this session");
    const cancelButton = buttonWithLabel(rendered, "Cancel");
    (publishButton.props.onClick as () => void)();
    (cancelButton.props.onClick as () => void)();
    expect(actions).toEqual({ confirmed: 1, cancelled: 1 });

    expect(renderToString(h(PublicationConfirmation, { ...props, hasSpeakingParticipant: true }))).not.toContain("No speaking participant is attached");
  });
});
