import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

/**
 * The one avatar renderer for organizer-side speaker surfaces. The same
 * event-scoped serve path powers the roster and the record, with initials as a
 * truthful fallback for an absent or unreadable photograph.
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

export function speakerHeadshotUrl(eventId: string, personId: string, attachmentId: string | null | undefined): string | null {
  if (!attachmentId) return null;
  return `/api/v1/events/${encodeURIComponent(eventId)}/people/${encodeURIComponent(personId)}/headshot?v=${encodeURIComponent(attachmentId)}`;
}

export function SpeakerAvatar({
  eventId,
  personId,
  name,
  attachmentId,
  size = 30,
}: {
  eventId: string;
  personId: string;
  name: string;
  attachmentId?: string | null;
  size?: number;
}): JSX.Element {
  const src = speakerHeadshotUrl(eventId, personId, attachmentId);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return (
    <span
      class="speaker-avatar"
      aria-label={`${name} headshot`}
      role="img"
      style={{ flexBasis: `${size}px`, height: `${size}px`, width: `${size}px`, fontSize: `${Math.round(size / 3.2)}px` }}
    >
      {src && !failed ? <img src={src} alt={`${name} headshot`} width={size} height={size} onError={() => setFailed(true)} /> : speakerInitials(name)}
    </span>
  );
}
