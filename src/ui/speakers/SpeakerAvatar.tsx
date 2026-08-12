import type { JSX } from "preact";

/**
 * The one avatar renderer for organizer-side speaker surfaces.
 *
 * The roster row and the speaker record both draw through this component, so
 * the headshot arrives on both at once when MRQ-112 lands its serve path —
 * `attachmentId` is already carried on every speaker payload. Until then it
 * draws initials, which stays the honest fallback for the speakers who never
 * upload a photograph rather than a placeholder waiting to be replaced.
 */
export function speakerInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "SP";
}

export function SpeakerAvatar({
  name,
  attachmentId: _attachmentId,
  size = 30,
}: {
  name: string;
  attachmentId?: string | null;
  size?: number;
}): JSX.Element {
  return (
    <span
      class="speaker-avatar"
      aria-hidden="true"
      style={{ flexBasis: `${size}px`, height: `${size}px`, width: `${size}px`, fontSize: `${Math.round(size / 3.2)}px` }}
    >
      {speakerInitials(name)}
    </span>
  );
}
