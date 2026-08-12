import { Hono } from "hono";

import type { Env } from "../index";
import { ICON_LINKS } from "../lib/head-icons";

export const calendarRoutes = new Hono<{ Bindings: Env }>();

calendarRoutes.get("/i/:uid", async (context) => {
  const pathUid = context.req.param("uid");
  if (!pathUid.endsWith(".ics")) return context.notFound();
  const uid = pathUid.slice(0, -4);
  if (!uid || /[\r\n]/.test(uid)) return context.notFound();
  const row = await context.env.DB
    .prepare(
      `SELECT ics_body, ics_uid
       FROM outbox
       WHERE ics_uid = ? AND ics_body IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(uid)
    .first<{ ics_body: string; ics_uid: string }>();
  if (!row) return context.notFound();
  context.header("Cache-Control", "no-store");
  context.header("Content-Type", "text/calendar; charset=utf-8");
  context.header("Content-Disposition", `inline; filename="${encodeURIComponent(row.ics_uid)}.ics"`);
  return context.body(row.ics_body);
});

/** Minimal public resolver target used by the URL property in an invite. */
calendarRoutes.get("/s/:submissionId", async (context) => {
  const row = await context.env.DB
    .prepare(
      `SELECT submission.id, submission.title, agenda.starts_at, agenda.duration_min,
              room.name AS room_name, building.name AS building_name,
              event.name AS event_name, event.timezone
       FROM submissions submission
       JOIN events event ON event.id = submission.event_id
       JOIN agenda_items agenda ON agenda.submission_id = submission.id AND agenda.kind = 'session'
       JOIN rooms room ON room.id = agenda.room_id
       LEFT JOIN buildings building ON building.id = room.building_id
       WHERE submission.id = ? AND submission.is_published = 1 AND agenda.is_published = 1
       LIMIT 1`,
    )
    .bind(context.req.param("submissionId"))
    .first<{ event_name: string; room_name: string; building_name: string | null; title: string }>();
  if (!row) return context.notFound();
  const location = row.building_name ? `${row.room_name} · ${row.building_name}` : row.room_name;
  context.header("Cache-Control", "no-store");
  return context.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(row.title)} · ${escapeHtml(row.event_name)}</title>${ICON_LINKS}</head><body><main><h1>${escapeHtml(row.title)}</h1><p>${escapeHtml(location)}</p></main></body></html>`);
});

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
