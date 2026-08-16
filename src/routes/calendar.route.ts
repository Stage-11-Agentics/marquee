import { Hono } from "hono";

import type { Env } from "../index";
import { resolveCalendarIcs } from "../jobs/calendar/resolver";
import { ICON_LINKS } from "../lib/head-icons";
import { publicPublicationPredicate } from "../lib/publication-truth";

export const calendarRoutes = new Hono<{ Bindings: Env }>();

calendarRoutes.get("/i/:uid", async (context) => {
  const pathUid = context.req.param("uid");
  if (!pathUid.endsWith(".ics")) return context.notFound();
  const uid = pathUid.slice(0, -4);
  if (!uid || /[\r\n]/.test(uid)) return context.notFound();
  const revision = await resolveCalendarIcs(context.env.DB, uid);
  if (!revision) return context.notFound();
  context.header("Cache-Control", "no-store");
  context.header("Content-Type", "text/calendar; charset=utf-8");
  context.header("Content-Disposition", `inline; filename="${encodeURIComponent(revision.uid)}.ics"`);
  return context.body(revision.body);
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
       JOIN agenda_items agenda
         ON agenda.submission_id = submission.id
        AND agenda.event_id = submission.event_id
        AND agenda.kind = 'session'
       JOIN rooms room ON room.id = agenda.room_id AND room.event_id = agenda.event_id
       LEFT JOIN buildings building ON building.id = room.building_id AND building.event_id = room.event_id
       WHERE submission.id = ?
         AND ${publicPublicationPredicate({ submission: "submission", agenda: "agenda", event: "event" })}
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
