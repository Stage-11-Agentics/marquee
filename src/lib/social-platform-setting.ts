import { readEnabledPlatforms, type SocialPlatformId } from "./social-links";

/**
 * Which social profiles a conference asks its speakers for.
 *
 * One key, one reader, one writer — the portal form, the organizer's settings
 * screen and any future surface all resolve the same way, including the
 * unset case, which means "every platform this build ships" rather than "none".
 */
export const SOCIAL_PLATFORMS_SETTING_KEY = "speaker_social_platforms";

export async function enabledSocialPlatformsFor(db: D1Database, eventId: string): Promise<SocialPlatformId[]> {
  const row = await db
    .prepare("SELECT value_json FROM event_settings WHERE event_id = ? AND key = ?")
    .bind(eventId, SOCIAL_PLATFORMS_SETTING_KEY)
    .first<{ value_json: string }>();
  return readEnabledPlatforms(row?.value_json ?? null);
}

export async function writeEnabledSocialPlatforms(db: D1Database, eventId: string, platforms: SocialPlatformId[], now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO event_settings (id, event_id, key, value_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .bind(`speaker-social-platforms-${eventId}`, eventId, SOCIAL_PLATFORMS_SETTING_KEY, JSON.stringify({ platforms }), now, now)
    .run();
}
